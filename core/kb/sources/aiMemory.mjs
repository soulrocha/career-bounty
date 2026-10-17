// Adaptador ai-memory: busca fatos recentes pela API JSON somente leitura (/api/v1) e os devolve como CANDIDATOS.
// Nada daqui vira afirmação: o resultado é relato pendente de confirmação. Só GET; sem método de escrita.
// Caminhos conferidos nas rotas do servidor: /api/v1/search (q, workspace, project, limit). O formato do envelope é lido de forma tolerante.
import { createHash } from 'node:crypto';
import { embrulhar, limparCampoCurto, limparTextoNaoConfiavel } from '../../privacy/untrusted.mjs';

const TEXTO_MAX = 600;
const FALLBACK = 'Dentro da sessão, use o MCP do ai-memory (memory_query); o resultado continua sendo candidato.';

const listaDe = corpo => {
  if (Array.isArray(corpo)) return corpo;
  if (corpo && typeof corpo === 'object') {
    for (const chave of ['results', 'hits', 'pages', 'items', 'data']) {
      if (Array.isArray(corpo[chave])) return corpo[chave];
      if (corpo[chave] && typeof corpo[chave] === 'object') { const interna = listaDe(corpo[chave]); if (interna) return interna; }
    }
  }
  return null;
};

function candidatoDe(pagina) {
  const caminho = limparCampoCurto(pagina.path ?? pagina.id ?? '', 300);
  const titulo = limparCampoCurto(pagina.title ?? '', 200);
  const corpo = String(pagina.snippet ?? pagina.body_markdown ?? pagina.summary ?? '');
  const { texto } = limparTextoNaoConfiavel([titulo, corpo].filter(Boolean).join(' — '), { max: TEXTO_MAX });
  if (!texto.trim()) return null;
  return { id: `cand:${createHash('sha1').update(caminho || texto).digest('hex').slice(0, 10)}`, origem: 'ai-memory', estado: 'candidato', nivel_prova: 'relato',
    titulo, caminho, atualizado_em: typeof pagina.updated_at === 'string' ? pagina.updated_at.slice(0, 40) : null, texto, texto_seguro: embrulhar(texto) };
}

export function createAiMemory({ url, token = null, workspace = null, project = null, limite = 10, timeoutMs = 5000, fetchImpl = globalThis.fetch }) {
  let base;
  try { base = new URL(url); } catch { throw new Error('ai-memory: URL inválida.'); }
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('ai-memory: a URL deve ser http ou https.');
  if (base.username || base.password) throw new Error('ai-memory: a URL não pode conter credenciais (use secrets/ai-memory.token).');
  const prefixo = base.pathname.replace(/\/+$/, '');

  async function candidatos({ consulta }) {
    const alvo = new URL(`${base.origin}${prefixo}/api/v1/search`);
    alvo.searchParams.set('q', String(consulta));
    if (workspace) alvo.searchParams.set('workspace', workspace);
    if (project) alvo.searchParams.set('project', project);
    alvo.searchParams.set('limit', String(limite));
    const falha = mensagem => ({ disponivel: false, candidatos: [], fallback: 'mcp', mensagem: `${mensagem} ${FALLBACK}` });
    let resposta;
    try {
      resposta = await fetchImpl(alvo, { method: 'GET', redirect: 'error', headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(timeoutMs) });
    } catch { return falha(`ai-memory fora do ar ou não respondeu em ${Math.round(timeoutMs / 1000)}s.`); }
    if ([404, 405].includes(resposta.status)) return falha(`API /api/v1 indisponível (HTTP ${resposta.status}): o servidor pode estar sem --enable-web ou --enable-api, ou o endereço base está errado.`);
    if ([401, 403].includes(resposta.status)) return falha('ai-memory recusou o acesso: token ausente ou inválido em secrets/ai-memory.token.');
    if (!resposta.ok) return falha(`ai-memory respondeu HTTP ${resposta.status}.`);
    let corpo;
    try { corpo = await resposta.json(); } catch { return falha('resposta inesperada do ai-memory (não é JSON).'); }
    const lista = listaDe(corpo);
    if (!lista) return falha('resposta inesperada do ai-memory (formato desconhecido).');
    return { disponivel: true, candidatos: lista.filter(p => p && typeof p === 'object').map(candidatoDe).filter(Boolean).slice(0, limite), mensagem: null };
  }

  return { candidatos };
}
