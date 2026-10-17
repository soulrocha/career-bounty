// Abas de candidatura e scripts permitidos nelas (F6.9/F6.10). A skill marca a aba antes de mexer no formulário; a partir
// daí o hook só deixa passar nessa aba os scripts do CareerBounty: o extrator, o preenchimento registrado pela CLI, o clique
// que recusa botão de envio e o envio, que exige aprovação nominal.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from '../store/atomicWrite.mjs';
import { withLock } from '../store/lock.mjs';
import { SCRIPT_ETAPA_GUPY, classificarEtapa } from './gupyFlow.mjs';

export const VALIDADE_ABA_MIN = 180;
export const ENVIO_TEXTO = /^\s*(enviar|candidatar|candidatar-se|submit|apply|finalizar|concluir|send|confirmar|inscrever|registrar|finish|complete)\b/i;
const arquivo = dataRoot => path.join(dataRoot, 'state', 'sessao-candidatura.json');
const trava = dataRoot => path.join(dataRoot, 'state', 'sessao-candidatura.lock');
const VAZIO = { versao: 1, abas: [], scripts: [] };
export const hashScript = texto => createHash('sha256').update(String(texto).trim()).digest('hex');

export async function lerSessao(dataRoot) {
  try { return { ...VAZIO, ...JSON.parse(await readFile(arquivo(dataRoot), 'utf8')) }; } catch (e) {
    if (e.code === 'ENOENT') return { ...VAZIO };
    throw new Error('Estado da sessão de candidatura ilegível.');
  }
}

async function alterar(dataRoot, mudar) {
  return withLock(trava(dataRoot), {}, async () => {
    const atual = await lerSessao(dataRoot);
    const novo = mudar(atual);
    await atomicJson(arquivo(dataRoot), novo);
    return novo;
  });
}

const vivas = (lista, ts) => lista.filter(item => Date.parse(item.expira_em) > Date.parse(ts));

// Marca a aba (id da ferramenta do navegador) como formulário de candidatura da vaga.
export const marcarAba = (dataRoot, { tabId, vagaId, tentativaId, cvAts, rota = null, ts = new Date().toISOString() }) => alterar(dataRoot, s => ({
  ...s, abas: [...vivas(s.abas, ts).filter(a => a.tab_id !== String(tabId)), { tab_id: String(tabId), vaga_id: vagaId, rota, ...(tentativaId ? { tentativa_id: tentativaId } : {}), ...(cvAts !== undefined ? { cv_ats: cvAts } : {}), expira_em: new Date(Date.parse(ts) + VALIDADE_ABA_MIN * 60000).toISOString() }],
}));

// Etapa da Gupy observada (F6.14): o PreToolUse registra a chamada do script de etapa; o PostToolUse lê a resposta dessa
// mesma chamada e grava a etapa classificada na aba. O modelo não tem como declarar a etapa por arquivo.
export const registrarEtapaPendente = (dataRoot, { tabId, toolUseId, ts = new Date().toISOString() }) => alterar(dataRoot, s => {
  const aba = vivas(s.abas, ts).find(a => a.tab_id === String(tabId));
  if (!aba || typeof toolUseId !== 'string' || !toolUseId) throw new Error('Aba de candidatura ou chamada inválida para a etapa.');
  return { ...s, abas: s.abas.map(a => (a === aba ? { ...a, etapa_pendente: toolUseId } : a)) };
});

export async function observarEtapa(dataRoot, entrada, ts = new Date().toISOString()) {
  if (!/__javascript_tool$/.test(String(entrada?.tool_name ?? '')) || String(entrada?.tool_input?.text ?? '').trim() !== SCRIPT_ETAPA_GUPY) return false;
  const tab = String(entrada.tool_input.tabId ?? entrada.tool_input.tab_id ?? '');
  return alterar(dataRoot, s => {
    const aba = s.abas.find(a => a.tab_id === tab && a.etapa_pendente === entrada.tool_use_id);
    if (!aba) return s;
    let resposta = entrada.tool_response;
    try {
      if (Array.isArray(resposta?.content)) resposta = resposta.content.length === 1 && resposta.content[0]?.type === 'text' ? JSON.parse(resposta.content[0].text) : null;
    } catch { resposta = null; }
    const etapa = resposta && !entrada.tool_response?.isError ? classificarEtapa(resposta) : { etapa: 'desconhecida', motivo: 'resposta ilegível' };
    return { ...s, abas: s.abas.map(a => (a === aba ? { ...a, etapa_pendente: null, etapa: { ...etapa, tool_use_id: entrada.tool_use_id, observada_em: ts } } : a)) };
  });
}
export const desmarcarAba = (dataRoot, { tabId, ts = new Date().toISOString() }) => alterar(dataRoot, s => ({ ...s, abas: vivas(s.abas, ts).filter(a => a.tab_id !== String(tabId)) }));

// Mantém o vínculo sob lock até persistir o desfecho; falhas conservam a proteção.
export async function finalizarAbaDaTentativa(dataRoot, { tabId, vagaId, tentativaId, manter, ts }, concluir) {
  return withLock(trava(dataRoot), {}, async () => {
    const sessao = await lerSessao(dataRoot);
    const aba = sessao.abas.find(a => a.tab_id === String(tabId));
    if (!tentativaId || !aba || aba.vaga_id !== vagaId || aba.tentativa_id !== tentativaId || !(Date.parse(aba.expira_em) > Date.parse(ts))) throw new Error('Aba sem vínculo válido com esta tentativa e vaga.');
    const resultado = await concluir();
    if (!manter) await atomicJson(arquivo(dataRoot), { ...sessao, abas: sessao.abas.filter(a => a !== aba) });
    return resultado;
  });
}

// Registra um script gerado pela CLI (preenchimento) para a vaga; o hook só o deixa passar na aba dessa vaga.
export const registrarScript = (dataRoot, { vagaId, script, ts = new Date().toISOString() }) => alterar(dataRoot, s => ({
  ...s, scripts: [...vivas(s.scripts, ts), { hash: hashScript(script), vaga_id: vagaId, expira_em: new Date(Date.parse(ts) + VALIDADE_ABA_MIN * 60000).toISOString() }],
}));

// Só navegação explícita: um rótulo desconhecido ou submit, mesmo implícito, exige ação humana.
export const scriptDeClique = texto => `(()=>{const T=${JSON.stringify(String(texto))},E=${ENVIO_TEXTO},N=s=>(s||'').replace(/\\s+/g,' ').trim();`
  + `if(E.test(T))return{erro:'botão de envio: use o script de envio com aprovação'};`
  + `if(!/^(próximo|próxima|avançar|continuar|seguinte|voltar|anterior|next|continue|back)$/i.test(N(T)))return{erro:'navegação não reconhecida: ação humana necessária'};`
  + `const candidatos=[...document.querySelectorAll('button,input,a,[role=button]')].filter(e=>e.offsetParent!==null&&getComputedStyle(e).visibility!=='hidden'&&N(e.innerText||e.value)===N(T));`
  + `if(candidatos.length!==1)return{erro:'alvo de navegação ausente ou ambíguo'};const b=candidatos[0];`
  + `if(!['BUTTON','INPUT'].includes(b.tagName)||b.getAttribute('type')?.toLowerCase()!=='button'||b.disabled||b.getAttribute('aria-disabled')==='true')return{erro:'controle não autorizado: ação humana necessária'};`
  + `b.click();return{clicado:N(b.innerText||b.value)}})()`;

// Envio: clica no primeiro botão visível de envio da página. Só passa no hook com aprovação nominal válida da vaga.
// A rota vai no script: página da Gupy só envia pela rota Gupy (aceite, etapa e cota) e a rota Gupy só envia na Gupy.
export const scriptDeEnvio = (vagaId, rota = null) => `(()=>{/*cb-envio:${String(vagaId).replace(/[^A-Za-z0-9._-]/g, '')}:${rota === 'gupy' ? 'gupy' : 'outra'}*/const E=${ENVIO_TEXTO},N=s=>(s||'').replace(/\\s+/g,' ').trim();`
  + `const G=/(^|\\.)gupy\\.io$/.test(location.hostname);`
  + (rota === 'gupy' ? `if(!G)return{erro:'rota Gupy fora de página da Gupy'};` : `if(G)return{erro:'página da Gupy: use a rota Gupy (aceite, etapa e cota)'};`)
  + `const b=[...document.querySelectorAll('button,input[type=submit],[role=button]')].find(e=>e.offsetParent!==null&&E.test(N(e.innerText||e.value)));`
  + `if(!b)return{erro:'botão de envio não encontrado'};b.click();return{enviado:N(b.innerText||b.value)}})()`;
