// Decisão do hook PreToolUse para as ferramentas de navegador (F6.9). Função pura: o script do hook lê o estado, chama esta
// função e, quando ela pede, consome a aprovação. Fora de aba de candidatura não decide nada (null). Dentro dela, falha
// fechado: clique por coordenada, Enter, espaço e script desconhecido são negados; o envio exige aprovação nominal.
import { SCRIPT_EXTRATOR } from './extrator.mjs';
import { aprovacaoValida } from './approval.mjs';
import { hashScript, scriptDeClique, scriptDeEnvio } from './sessao.mjs';

export const NAVEGADOR = /^mcp__(?:remote-devices__)?(claude-in-chrome|Claude_Browser)__(.+)$/;
const LIVRES = new Set(['navigate', 'find', 'read_page', 'get_page_text', 'tabs_context', 'tabs_context_mcp', 'tabs_create', 'tabs_create_mcp', 'tabs_select',
  'tabs_close', 'tabs_close_mcp', 'read_console_messages', 'read_network_requests', 'resize_window', 'list_connected_browsers', 'select_browser', 'form_input', 'preview_list']);
const ACOES_LIVRES = new Set(['screenshot', 'scroll', 'scroll_to', 'hover', 'zoom', 'wait', 'type']);
const TECLAS_DE_ENVIO = /(^|[\s+])(enter|return|kp_enter|space)($|[\s+])/i;

const nega = motivo => ({ decisao: 'negar', motivo });
const vivas = (lista, agora) => (lista ?? []).filter(item => Date.parse(item.expira_em) > Date.parse(agora));

// Qual aba de candidatura a chamada atinge. Sem tabId, com alguma aba marcada, vale a primeira (falha fechado).
function abaAlvo(input, abas) {
  if (!abas.length) return null;
  const tab = input?.tabId ?? input?.tab_id;
  if (tab === undefined || tab === null || tab === '') return abas[0];
  return abas.find(a => a.tab_id === String(tab)) ?? null;
}

function decidirScript(texto, aba, { sessao, aprovacoes, agora }) {
  const t = String(texto ?? '').trim();
  if (t === SCRIPT_EXTRATOR) return null;
  if (vivas(sessao.scripts, agora).some(s => s.vaga_id === aba.vaga_id && s.hash === hashScript(t))) return null;
  const clique = /^\(\(\)=>\{const T=("(?:[^"\\]|\\.)*"),/.exec(t);
  if (clique) {
    let alvo;
    try { alvo = JSON.parse(clique[1]); } catch { return nega('script de clique malformado'); }
    if (t === scriptDeClique(alvo).trim()) return null;
  }
  if (t === scriptDeEnvio(aba.vaga_id).trim()) {
    if (!aprovacoes || !aprovacaoValida(aprovacoes, aba.vaga_id, agora)) return nega(`envio sem aprovação: digite no chat a frase do lote ("enviar estas N: ...") para ${aba.vaga_id}`);
    return { decisao: 'permitir', consumir: aba.vaga_id, motivo: 'envio aprovado pela pessoa' };
  }
  return nega('aba de candidatura: só scripts do CareerBounty (extrator, preenchimento registrado, clique e envio aprovado)');
}

function decidirAcao(ferramenta, input, aba, ctx) {
  if (LIVRES.has(ferramenta)) return null;
  if (ferramenta === 'computer') {
    const acao = input?.action;
    if (ACOES_LIVRES.has(acao)) return null;
    if (acao === 'key') return TECLAS_DE_ENVIO.test(String(input?.text ?? '')) ? nega('aba de candidatura: Enter e espaço podem enviar o formulário') : null;
    return nega(`aba de candidatura: ${acao ?? 'ação'} por coordenada negado; use o script de clique do CareerBounty`);
  }
  if (ferramenta === 'javascript_tool') return decidirScript(input?.text, aba, ctx);
  return nega(`aba de candidatura: ferramenta ${ferramenta} não liberada`);
}

// entrada: JSON do Claude Code ao hook. ctx: { sessao, aprovacoes, agora }. Devolve null (não decide) ou { decisao, motivo, consumir? }.
export function decidirNavegador(entrada, ctx) {
  const m = NAVEGADOR.exec(String(entrada?.tool_name ?? ''));
  if (!m) return null;
  if (!ctx?.sessao) return nega('estado da sessão de candidatura indisponível: negado por padrão');
  const abas = vivas(ctx.sessao.abas, ctx.agora);
  const input = entrada.tool_input;
  if (m[2] === 'browser_batch') {
    const acoes = Array.isArray(input?.actions) ? input.actions : null;
    if (!acoes) return abas.length ? nega('lote de ações ilegível') : null;
    let consumir = null;
    for (const item of acoes) {
      const r = decidirNavegador({ tool_name: `mcp__${m[1]}__${item?.name}`, tool_input: item?.input ?? {} }, ctx);
      if (r?.decisao === 'negar') return r;
      if (r?.consumir) { if (consumir) return nega('mais de um envio no mesmo lote de ações'); consumir = r.consumir; }
    }
    return consumir ? { decisao: 'permitir', consumir, motivo: 'envio aprovado pela pessoa' } : null;
  }
  const aba = abaAlvo(input, abas);
  if (!aba) return null;
  return decidirAcao(m[2], input, aba, ctx);
}
