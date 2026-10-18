// Decisão do hook PreToolUse para as ferramentas de navegador (F6.9). Função pura: o script do hook lê o estado, chama esta
// função e, quando ela pede, consome a aprovação. Fora de aba de candidatura não decide nada (null). Dentro dela, falha
// fechado: clique por coordenada, Enter, espaço e script desconhecido são negados; o envio exige aprovação nominal.
import { SCRIPT_EXTRATOR } from './extrator.mjs';
import { SCRIPT_COMPROVANTE } from './receipt.mjs';
import { SCRIPT_ETAPA_GUPY } from './gupyFlow.mjs';
import { aprovacaoValida } from './approval.mjs';
import { hashScript, scriptDeClique, scriptDeEnvio } from './sessao.mjs';

export const NAVEGADOR = /^mcp__(?:remote-devices__)?(claude-in-chrome|Claude_Browser)__(.+)$/;
const LIVRES = new Set(['navigate', 'find', 'read_page', 'get_page_text', 'tabs_context', 'tabs_context_mcp', 'tabs_create', 'tabs_create_mcp', 'tabs_select',
  'tabs_close', 'tabs_close_mcp', 'read_console_messages', 'read_network_requests', 'resize_window', 'list_connected_browsers', 'select_browser', 'form_input', 'preview_list']);
const ACOES_LIVRES = new Set(['screenshot', 'scroll', 'scroll_to', 'hover', 'zoom', 'wait', 'type']);
const TECLAS_DE_ENVIO = /(^|[\s+])(enter|return|kp_enter|space)($|[\s+])/i;

const nega = (motivo, vagaId = null) => ({ decisao: 'negar', motivo, ...(vagaId ? { vagaId } : {}) });
// A etapa observada da Gupy vale para a página que estava aberta: navegar ou rodar script que pode mudar a página a apaga,
// e ela vence em VALIDADE_ETAPA_MIN. O envio exige etapa de perguntas observada depois da última mudança.
export const VALIDADE_ETAPA_MIN = 10;
const muda = aba => (aba.rota === 'gupy' ? { invalidarEtapa: [aba.tab_id] } : null);
const etapaVigente = (aba, agora) => aba.etapa?.etapa === 'perguntas' && Date.parse(agora) - Date.parse(aba.etapa.observada_em) <= VALIDADE_ETAPA_MIN * 60000;
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
  if (t === SCRIPT_EXTRATOR || t === SCRIPT_COMPROVANTE) return null;
  // Etapa da Gupy: a leitura é observada pelo PostToolUse (o modelo não declara a etapa); exige chamada individual.
  if (t === SCRIPT_ETAPA_GUPY) return { decisao: 'permitir', observarEtapa: { tabId: aba.tab_id }, motivo: 'leitura da etapa da Gupy' };
  if (vivas(sessao.scripts, agora).some(s => s.vaga_id === aba.vaga_id && s.hash === hashScript(t))) return muda(aba);
  const clique = /^\(\(\)=>\{const T=("(?:[^"\\]|\\.)*"),/.exec(t);
  if (clique) {
    let alvo;
    try { alvo = JSON.parse(clique[1]); } catch { return nega('script de clique malformado', aba.vaga_id); }
    if (t === scriptDeClique(alvo).trim()) return muda(aba);
  }
  // O script de envio carrega a rota da aba e confere o domínio da página: página da Gupy só pela rota Gupy.
  if (t === scriptDeEnvio(aba.vaga_id, aba.rota ?? null).trim()) {
    if (!aprovacoes || !aprovacaoValida(aprovacoes, aba.vaga_id, agora)) return nega(`envio sem aprovação: digite no chat a frase do lote ("enviar estas N: ...") para ${aba.vaga_id}`, aba.vaga_id);
    if (aba.rota === 'gupy' && !etapaVigente(aba, agora)) return nega(`Gupy: falta etapa observada de perguntas desde a última mudança da página (ou ela tem mais de ${VALIDADE_ETAPA_MIN} min); rode o script de etapa (chamada individual) antes de enviar`, aba.vaga_id);
    return { decisao: 'permitir', consumir: aba.vaga_id, motivo: 'envio aprovado pela pessoa' };
  }
  return nega('aba de candidatura: só scripts do CareerBounty (extrator, preenchimento registrado, clique e envio aprovado)', aba.vaga_id);
}

function decidirAcao(ferramenta, input, aba, ctx) {
  if (ferramenta === 'navigate') return muda(aba);
  if (LIVRES.has(ferramenta)) return null;
  if (ferramenta === 'computer') {
    const acao = input?.action;
    if (ACOES_LIVRES.has(acao)) return null;
    if (acao === 'key') return TECLAS_DE_ENVIO.test(String(input?.text ?? '')) ? nega('aba de candidatura: Enter e espaço podem enviar o formulário', aba.vaga_id) : null;
    return nega(`aba de candidatura: ${acao ?? 'ação'} por coordenada negado; use o script de clique do CareerBounty`, aba.vaga_id);
  }
  if (ferramenta === 'javascript_tool') return decidirScript(input?.text, aba, ctx);
  if (ferramenta === 'file_upload') {
    // Só o PDF ATS versionado da vaga da aba (artifacts/cv/<vaga>/<hash>/cv-ats.pdf); arquivo sem caminho não é conferível.
    const vaga = String(aba.vaga_id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cv = new RegExp(`[\\\\/]artifacts[\\\\/]cv[\\\\/]${vaga}[\\\\/][0-9a-f]{64}[\\\\/]cv-ats\\.pdf$`);
    const caminhos = Array.isArray(input?.paths) ? input.paths : [];
    if ('cv_ats' in aba && (!aba.cv_ats || caminhos.some(c => c !== aba.cv_ats))) return nega('aba de candidatura: use o PDF escolhido ao iniciar esta tentativa', aba.vaga_id);
    if (!caminhos.length || input?.files?.length || !caminhos.every(c => typeof c === 'string' && cv.test(c))) return nega('aba de candidatura: só o PDF ATS aprovado desta vaga pode ser anexado', aba.vaga_id);
    return null;
  }
  return nega(`aba de candidatura: ferramenta ${ferramenta} não liberada`, aba.vaga_id);
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
    const invalidar = [];
    for (const item of acoes) {
      const r = decidirNavegador({ tool_name: `mcp__${m[1]}__${item?.name}`, tool_input: item?.input ?? {} }, ctx);
      if (r?.decisao === 'negar') return r;
      if (r?.observarEtapa) return nega('o script de etapa da Gupy deve ser chamada individual (não em lote de ações)');
      if (r?.consumir) {
        if (consumir) return nega('mais de um envio no mesmo lote de ações');
        if (invalidar.length) return nega('envio no mesmo lote depois de mudar a página: a etapa observada já não vale');
        consumir = r.consumir;
      }
      for (const tab of r?.invalidarEtapa ?? []) if (!invalidar.includes(tab)) invalidar.push(tab);
    }
    const extra = invalidar.length ? { invalidarEtapa: invalidar } : {};
    return consumir ? { decisao: 'permitir', consumir, motivo: 'envio aprovado pela pessoa', ...extra } : invalidar.length ? extra : null;
  }
  const aba = abaAlvo(input, abas);
  if (!aba) return null;
  return decidirAcao(m[2], input, aba, ctx);
}
