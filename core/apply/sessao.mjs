// Abas de candidatura e scripts permitidos nelas (F6.9/F6.10). A skill marca a aba antes de mexer no formulário; a partir
// daí o hook só deixa passar nessa aba os scripts do CareerBounty: o extrator, o preenchimento registrado pela CLI, o clique
// que recusa botão de envio e o envio, que exige aprovação nominal.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from '../store/atomicWrite.mjs';
import { withLock } from '../store/lock.mjs';

export const VALIDADE_ABA_MIN = 180;
export const ENVIO_TEXTO = /^\s*(enviar|candidatar|candidatar-se|submit|apply|finalizar|concluir|send)\b/i;
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
export const marcarAba = (dataRoot, { tabId, vagaId, ts = new Date().toISOString() }) => alterar(dataRoot, s => ({
  ...s, abas: [...vivas(s.abas, ts).filter(a => a.tab_id !== String(tabId)), { tab_id: String(tabId), vaga_id: vagaId, expira_em: new Date(Date.parse(ts) + VALIDADE_ABA_MIN * 60000).toISOString() }],
}));
export const desmarcarAba = (dataRoot, { tabId, ts = new Date().toISOString() }) => alterar(dataRoot, s => ({ ...s, abas: vivas(s.abas, ts).filter(a => a.tab_id !== String(tabId)) }));

// Registra um script gerado pela CLI (preenchimento) para a vaga; o hook só o deixa passar na aba dessa vaga.
export const registrarScript = (dataRoot, { vagaId, script, ts = new Date().toISOString() }) => alterar(dataRoot, s => ({
  ...s, scripts: [...vivas(s.scripts, ts), { hash: hashScript(script), vaga_id: vagaId, expira_em: new Date(Date.parse(ts) + VALIDADE_ABA_MIN * 60000).toISOString() }],
}));

// Clique por texto visível que recusa botão de envio (o envio tem script próprio, com aprovação).
export const scriptDeClique = texto => `(()=>{const T=${JSON.stringify(String(texto))},E=${ENVIO_TEXTO},N=s=>(s||'').replace(/\\s+/g,' ').trim();`
  + `if(E.test(T))return{erro:'botão de envio: use o script de envio com aprovação'};`
  + `const b=[...document.querySelectorAll('button,a,[role=button],input[type=button],input[type=submit]')].find(e=>N(e.innerText||e.value)===N(T));`
  + `if(!b)return{erro:'botão não encontrado'};if(E.test(N(b.innerText||b.value)))return{erro:'botão de envio'};b.click();return{clicado:N(b.innerText||b.value)}})()`;

// Envio: clica no primeiro botão visível de envio da página. Só passa no hook com aprovação nominal válida da vaga.
export const scriptDeEnvio = vagaId => `(()=>{/*cb-envio:${String(vagaId).replace(/[^A-Za-z0-9._-]/g, '')}*/const E=${ENVIO_TEXTO},N=s=>(s||'').replace(/\\s+/g,' ').trim();`
  + `const b=[...document.querySelectorAll('button,input[type=submit],[role=button]')].find(e=>e.offsetParent!==null&&E.test(N(e.innerText||e.value)));`
  + `if(!b)return{erro:'botão de envio não encontrado'};b.click();return{enviado:N(b.innerText||b.value)}})()`;
