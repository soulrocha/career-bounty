// Vínculo e-mail -> vaga por chave canônica de portal ("portal:requisição"), a mesma forma de core/dedup/keys.mjs.
// Sem chave, ou chave que não existe no tracker, fica "pendente de conferência": nunca por semelhança de cargo ou empresa.
// O portal do remetente manda: o mesmo número em portais diferentes é outra vaga. A data do e-mail não é tocada aqui.
import { chavesCanonicas, chaveDaUrl, PORTAL_DO_PROVEDOR } from '../dedup/keys.mjs';
import { portalDoDominio } from './portais.mjs';

// Remetente fora dos portais conhecidos (site próprio da empresa): vagas sem portal também caem aqui.
export const PORTAL_PROPRIO = 'proprio';

// "Job-48213" só vale com contexto (entre colchetes, ou colado por hífen) e com 4 ou mais dígitos: "Job 2024 summary" não é requisição.
const JOB_COLCHETES = /\[\s*job\s*-?\s*(\d{4,})\s*\]/gi;
const JOB_HIFEN = /(?<![\w-])job-(\d{4,})(?!\d)/gi;
const JOB_ROTULADO = /\bjob\s*(?:id|#|n[ºo.]?)\s*[:#]?\s*(\d{4,})(?!\d)/gi;
const GUPY_PREFIXO = /(?:^|[\s:\]])(\d{6,10})\s+-\s+\S/g;
const GUPY_SUFIXO = /\s-\s([A-Z]{2,5}\d{3,6})\b/g;
const URLS = /https?:\/\/[^\s<>"'`)\]]+/gi;

export function portalDoRemetente(dominio, extras = []) {
  const portal = portalDoDominio(dominio, extras);
  return portal && portal !== 'extra' ? portal : PORTAL_PROPRIO;
}

// Chaves de requisição citadas no texto, já no formato canônico e no portal do remetente.
export function extrairRequisicoes(texto, { portal = null } = {}) {
  const base = String(texto ?? '');
  const achadas = new Set();
  const remetente = portal ?? PORTAL_PROPRIO;
  for (const url of base.match(URLS) ?? []) {
    const chave = chaveDaUrl(url.replace(/[.,;]+$/, ''));
    if (chave && (portal === null || chave.startsWith(`${portal}:`))) achadas.add(chave.toLowerCase());
  }
  if (remetente !== 'gupy') for (const re of [JOB_COLCHETES, JOB_HIFEN, JOB_ROTULADO]) for (const m of base.matchAll(re)) achadas.add(`${remetente}:${m[1]}`);
  if (remetente === 'gupy') {
    for (const m of base.matchAll(GUPY_PREFIXO)) achadas.add(`gupy:${m[1]}`);
    for (const m of base.matchAll(GUPY_SUFIXO)) achadas.add(`gupy:${m[1].toLowerCase()}`);
  }
  return [...achadas];
}

const JOB_NA_VAGA = /^job\s*[-:]?\s*(\d{4,})$/i;
const SEM_REQUISICAO = { requisicao_id: undefined, id_requisicao: undefined };

// Todas as chaves pelas quais uma vaga do tracker pode ser reconhecida: as canônicas (URLs, aparições, requisição) e,
// para requisição "Job-N" / "job:N", o número no(s) portal(is) da própria vaga.
export function chavesDaVaga(vaga) {
  const j = vaga ?? {};
  const chaves = new Set(chavesCanonicas(j).filter(chave => !chave.startsWith('job:')).map(chave => chave.toLowerCase()));
  const portais = new Set(chavesCanonicas({ ...j, ...SEM_REQUISICAO }).map(chave => chave.split(':')[0]));
  const declarado = String(j.portal_origem ?? j.portal ?? '').toLowerCase();
  if (declarado) portais.add(PORTAL_DO_PROVEDOR[declarado] ?? declarado);
  const sociais = [...portais].filter(portal => portal !== 'linkedin');
  const alvo = sociais.length ? sociais : portais.size ? [...portais] : [PORTAL_PROPRIO];
  for (const bruto of [j.requisicao_id, j.id_requisicao]) {
    const numero = JOB_NA_VAGA.exec(String(bruto ?? '').trim())?.[1];
    if (numero) for (const portal of alvo) chaves.add(`${portal}:${numero}`);
  }
  return [...chaves];
}

const CLASSES_SEM_CANDIDATURA = new Set(['alerta', 'ruido']);

// classificado: { classe, ... }; item: { assunto, trecho, remetente_dominio }; corpo opcional (já sanitizado).
export function vincular({ classe, item, corpo, extras = [] }, vagas) {
  if (CLASSES_SEM_CANDIDATURA.has(classe)) return { status: 'sem_candidatura', motivo: classe };
  const portal = portalDoRemetente(item.remetente_dominio, extras);
  const citadas = extrairRequisicoes(`${item.assunto ?? ''}\n${item.trecho ?? ''}\n${corpo ?? ''}`, { portal: item.remetente_dominio ? portal : null });
  if (!citadas.length) return { status: 'pendente', motivo: 'sem_id', detalhe: 'sem ID de requisição: conferência manual' };
  const alvos = new Map();
  for (const vaga of vagas) {
    const dela = chavesDaVaga(vaga);
    const chave = citadas.find(citada => dela.includes(citada));
    if (chave) alvos.set(vaga.id, { chave, vaga });
  }
  if (alvos.size === 1) {
    const { chave, vaga } = [...alvos.values()][0];
    return { status: 'vinculado', vaga_id: vaga.id, requisicao: chave };
  }
  if (alvos.size > 1) return { status: 'pendente', motivo: 'ambigua', detalhe: 'a chave bate com mais de uma vaga' };
  return { status: 'pendente', motivo: 'id_sem_vaga', detalhe: 'chave de requisição sem vaga correspondente no tracker' };
}
