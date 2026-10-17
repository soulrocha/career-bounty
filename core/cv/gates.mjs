// Gates de fato e de formato do CV: o que não passa vira "CV bloqueado" e a vaga deixa de ser oferecida para candidatura.
// Confere cada bullet (afirmação existe, está liberada, texto fiel à afirmação ou a uma variante cadastrada, números com prova),
// o resumo e os cards (números só de afirmações ligadas), termos marcados para anonimizar e se o texto do PDF ATS é extraível.
import { createHash } from 'node:crypto';
import { removerMarcas } from '../kb/cvItems.mjs';
import { motivoInelegivel } from './elegibilidade.mjs';
import { verificarTexto } from './facts.mjs';

const normalizar = texto => removerMarcas(String(texto ?? '')).replace(/\s+/g, ' ').trim();
const minusculo = texto => normalizar(texto).toLowerCase();

// JSON com chaves ordenadas: o mesmo payload dá sempre a mesma versão.
const estavel = valor => Array.isArray(valor) ? `[${valor.map(estavel).join(',')}]`
  : valor && typeof valor === 'object' ? `{${Object.keys(valor).sort().map(k => `${JSON.stringify(k)}:${estavel(valor[k])}`).join(',')}}`
    : JSON.stringify(valor ?? null);

export const versaoDoCv = payload => createHash('sha256').update(estavel(payload)).digest('hex');

function conferirNumeros({ texto, ligadas, afirmacoes, onde }) {
  return verificarTexto({ texto, ligadas, afirmacoes }).problemas.map(p => ({ codigo: p.codigo, onde, numero: p.numero, motivo: `${onde}: ${p.motivo}` }));
}

function conferirItens(payload, porId, afirmacoes) {
  const motivos = [];
  const usadas = [];
  for (const exp of payload.experiencias) {
    exp.itens.forEach((item, i) => {
      const onde = `${exp.id}, item ${i + 1}`;
      const af = porId.get(item.afirmacao);
      if (!af) { motivos.push({ codigo: 'afirmacao_inexistente', onde, motivo: `${onde}: afirmação ${String(item.afirmacao).slice(0, 40)} não existe na base` }); return; }
      const barrada = motivoInelegivel(af);
      if (barrada) { motivos.push({ codigo: barrada.codigo, onde, motivo: `${onde}: ${barrada.motivo}` }); return; }
      usadas.push(af.id);
      const permitidos = [af.texto, ...(af.variantes ?? [])].map(normalizar);
      if (!permitidos.includes(normalizar(item.texto))) motivos.push({ codigo: 'texto_alterado', onde, motivo: `${onde}: o texto não é o de ${af.id} nem de uma variante cadastrada` });
      motivos.push(...conferirNumeros({ texto: item.texto, ligadas: [af.id], afirmacoes, onde }));
    });
  }
  return { motivos, usadas };
}

function conferirCards(payload, porId, afirmacoes) {
  const motivos = [];
  const ligadas = [];
  payload.cards.forEach((card, i) => {
    const onde = `card ${i + 1}`;
    const ids = (card.claim_ids ?? []).filter(id => porId.has(id));
    if (!ids.length) { motivos.push({ codigo: 'card_sem_afirmacao', onde, motivo: `${onde}: sem afirmação ligada que sustente "${normalizar(card.valor)}"` }); return; }
    for (const id of ids) {
      const barrada = motivoInelegivel(porId.get(id));
      if (barrada) motivos.push({ codigo: barrada.codigo, onde, motivo: `${onde}: ${barrada.motivo}` });
    }
    ligadas.push(...ids);
    motivos.push(...conferirNumeros({ texto: `${card.valor} ${card.rotulo}`, ligadas: ids, afirmacoes, onde }));
  });
  return { motivos, ligadas };
}

// Todo texto visível do CV, para procurar termo que devia ter sido anonimizado.
const textoVisivel = payload => minusculo([
  payload.titulo, payload.resumo, ...payload.palavras_chave,
  ...payload.cards.flatMap(c => [c.valor, c.rotulo]),
  ...payload.experiencias.flatMap(exp => [exp.empresa, exp.cargo, exp.intro, ...exp.itens.map(i => i.texto)]),
].filter(Boolean).join(' \n '));

function conferirAnonimizacao(payload, afirmacoes) {
  const texto = textoVisivel(payload);
  return afirmacoes.flatMap(af => (af.anonimizar ?? [])
    .filter(termo => termo.trim() && texto.includes(minusculo(termo)))
    .map(() => ({ codigo: 'termo_anonimizado', onde: 'cv', motivo: `um termo que ${af.id} manda anonimizar aparece no CV` })));
}

// O ATS precisa ler o que a pessoa vai enviar: resumo e cada bullet devem estar no texto extraído do PDF.
function conferirAts(payload, textoAts) {
  const extraido = minusculo(textoAts);
  if (!extraido) return [{ codigo: 'ats_nao_extraivel', onde: 'pdf ats', motivo: 'o PDF ATS não tem texto extraível' }];
  const esperados = [['resumo', payload.resumo], ...payload.experiencias.flatMap(exp => exp.itens.map((item, i) => [`${exp.id}, item ${i + 1}`, item.texto]))];
  return esperados.filter(([, texto]) => !extraido.includes(minusculo(texto)))
    .map(([onde]) => ({ codigo: 'ats_nao_extraivel', onde, motivo: `${onde}: texto ausente na extração do PDF ATS` }));
}

// { status: 'ok' | 'bloqueado', motivos: [{ codigo, onde, numero?, motivo }], versao }.
export function avaliarGate({ payload, afirmacoes, textoAts }) {
  const porId = new Map(afirmacoes.map(af => [af.id, af]));
  const itens = conferirItens(payload, porId, afirmacoes);
  const cards = conferirCards(payload, porId, afirmacoes);
  const usadas = afirmacoes.filter(af => itens.usadas.includes(af.id) || cards.ligadas.includes(af.id));
  const motivos = [
    ...itens.motivos,
    ...cards.motivos,
    ...conferirNumeros({ texto: payload.resumo, ligadas: [...new Set([...itens.usadas, ...cards.ligadas])], afirmacoes, onde: 'resumo' }),
    ...conferirAnonimizacao(payload, usadas),
    ...conferirAts(payload, textoAts),
  ];
  return { status: motivos.length ? 'bloqueado' : 'ok', motivos, versao: versaoDoCv(payload) };
}

// Evento do gate: um por vaga, versão do CV e resultado (avaliar de novo com o mesmo resultado não duplica; resultado novo grava).
// aprovada: hash da versão aprovada mais nova da vaga (pode ser anterior a esta), a que o painel oferece.
export function eventoGate({ vagaId, gate, tipoCv = 'adaptado', aprovada = null, ts }) {
  return {
    id: `cv-gate:${vagaId}:${gate.versao}:${createHash('sha256').update(estavel({ s: gate.status, m: gate.motivos, a: aprovada })).digest('hex').slice(0, 12)}`, ts, ator: 'cv', tipo: 'cv.gate', entidade: 'vaga', entidade_id: vagaId,
    dados: { status: gate.status, motivos: gate.motivos, versao: gate.versao, tipo_cv: tipoCv, ...(aprovada ? { aprovada } : {}) },
  };
}

// Vaga com CV bloqueado não é oferecida no painel nem na candidatura assistida, a menos que haja versão anterior aprovada.
export const podeCandidatar = vaga => vaga?.cv_gate?.status !== 'bloqueado' || Boolean(vaga.cv_gate.aprovada);
