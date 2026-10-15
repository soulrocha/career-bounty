// Vínculo e-mail -> vaga, só por ID de requisição. Sem ID, ou ID que não existe no tracker, fica "pendente de conferência":
// nunca por semelhança de cargo ou empresa. A data do e-mail não é tocada aqui.
const JOB = /\bjob\s*-?\s*(\d{3,})/gi;
const GUPY_PREFIXO = /(?:^|[\s:\]])(\d{6,10})\s+-\s+\S/g;
const GUPY_SUFIXO = /\s-\s([A-Z]{2,5}\d{3,6})\b/g;

// Extrai as chaves de requisição citadas no texto: { sistema: 'job' | 'gupy', id }.
export function extrairRequisicoes(texto) {
  const achadas = new Map();
  const base = String(texto ?? '');
  for (const m of base.matchAll(JOB)) achadas.set(`job:${m[1]}`, { sistema: 'job', id: m[1] });
  for (const m of base.matchAll(GUPY_PREFIXO)) achadas.set(`gupy:${m[1]}`, { sistema: 'gupy', id: m[1] });
  for (const m of base.matchAll(GUPY_SUFIXO)) achadas.set(`gupy:${m[1].toLowerCase()}`, { sistema: 'gupy', id: m[1].toLowerCase() });
  return [...achadas.values()];
}

// requisicao_id do tracker: "gupy:123", "inhire:abc", "job:31790", "Job-31790" ou só o número.
export function chaveDaVaga(requisicaoId) {
  const texto = String(requisicaoId ?? '').trim();
  if (!texto) return null;
  const job = /^job\s*-?\s*(\d+)$/i.exec(texto);
  if (job) return { portal: null, id: job[1] };
  const composto = /^([a-z][a-z0-9_]*):(.+)$/i.exec(texto);
  if (composto) return { portal: composto[1].toLowerCase() === 'job' ? null : composto[1].toLowerCase(), id: composto[2].toLowerCase() };
  return { portal: null, id: texto.toLowerCase() };
}

const confere = (email, vaga) => email.id.toLowerCase() === vaga.id && (email.sistema === 'gupy' ? vaga.portal === 'gupy' || vaga.portal === null : vaga.portal !== 'gupy');

const CLASSES_SEM_CANDIDATURA = new Set(['alerta', 'ruido']);

// classificado: { classe, ... }; item: { assunto, trecho }; corpo opcional (já sanitizado).
export function vincular({ classe, item, corpo }, vagas) {
  if (CLASSES_SEM_CANDIDATURA.has(classe)) return { status: 'sem_candidatura', motivo: classe };
  const citadas = extrairRequisicoes(`${item.assunto ?? ''}\n${item.trecho ?? ''}\n${corpo ?? ''}`);
  if (!citadas.length) return { status: 'pendente', motivo: 'sem_id', detalhe: 'sem ID de requisição: conferência manual' };
  const chaves = vagas.map(vaga => ({ vaga, chave: chaveDaVaga(vaga.requisicao_id ?? vaga.id_requisicao) })).filter(item => item.chave);
  const alvos = new Map();
  for (const email of citadas) for (const { vaga, chave } of chaves) if (confere(email, chave)) alvos.set(vaga.id, { email, vaga });
  if (alvos.size === 1) {
    const { email, vaga } = [...alvos.values()][0];
    return { status: 'vinculado', vaga_id: vaga.id, requisicao: `${email.sistema}:${email.id}` };
  }
  if (alvos.size > 1) return { status: 'pendente', motivo: 'ambigua', detalhe: 'o ID bate com mais de uma vaga' };
  return { status: 'pendente', motivo: 'id_sem_vaga', detalhe: 'ID de requisição sem vaga correspondente no tracker' };
}
