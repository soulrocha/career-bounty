// Abas de candidatura e scripts permitidos nelas (F6.9/F6.10). A skill marca a aba antes de mexer no formulário; a partir
// daí o hook só deixa passar nessa aba os scripts do CareerBounty: o extrator, o preenchimento registrado pela CLI, o clique
// que recusa botão de envio e o envio, que exige aprovação nominal.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from '../store/atomicWrite.mjs';
import { withLock } from '../store/lock.mjs';

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
export const marcarAba = (dataRoot, { tabId, vagaId, tentativaId, cvAts, ts = new Date().toISOString() }) => alterar(dataRoot, s => ({
  ...s, abas: [...vivas(s.abas, ts).filter(a => a.tab_id !== String(tabId)), { tab_id: String(tabId), vaga_id: vagaId, ...(tentativaId ? { tentativa_id: tentativaId } : {}), ...(cvAts !== undefined ? { cv_ats: cvAts } : {}), expira_em: new Date(Date.parse(ts) + VALIDADE_ABA_MIN * 60000).toISOString() }],
}));
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
export const scriptDeEnvio = vagaId => `(()=>{/*cb-envio:${String(vagaId).replace(/[^A-Za-z0-9._-]/g, '')}*/const E=${ENVIO_TEXTO},N=s=>(s||'').replace(/\\s+/g,' ').trim();`
  + `const b=[...document.querySelectorAll('button,input[type=submit],[role=button]')].find(e=>e.offsetParent!==null&&E.test(N(e.innerText||e.value)));`
  + `if(!b)return{erro:'botão de envio não encontrado'};b.click();return{enviado:N(b.innerText||b.value)}})()`;
