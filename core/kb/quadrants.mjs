// Quadrantes dado x currículo. Determinístico: nenhuma chamada a LLM.
//   (a) dado e CV conferem     (c) CV sem dado (ou que não confere)
//   (b) dado fora do CV        (d) lacuna (fila com peso e pergunta sugerida)
import { chaveNumero, numerosDaAfirmacao } from '../cv/numeros.mjs';
import { calcularLacunas } from './gaps.mjs';
import { NIVEIS_COM_PROVA } from './schema.mjs';

const COM_PROVA = new Set(NIVEIS_COM_PROVA);
const resumoItem = item => ({ modelo: item.modelo, secao: item.secao, linha: item.linha, texto: item.texto });

// Classifica cada item de CV em (a) ou (c). `itens` vêm de extrairItensCv; `afirmacoes` da base.
export function classificarItens({ afirmacoes, itens }) {
  const porId = new Map(afirmacoes.map(af => [af.id, af]));
  const chaves = new Map(afirmacoes.map(af => [af.id, new Set(numerosDaAfirmacao(af).map(chaveNumero))]));
  const a = [];
  const c = [];
  for (const item of itens) {
    const base = { ...resumoItem(item), claim_ids: item.claim_ids };
    if (item.sem_marca) { c.push({ ...base, codigo: 'sem_marca', motivo: 'bullet sem marca de afirmação (mapeie a uma afirmação ou remova)' }); continue; }
    const ligadas = item.claim_ids.map(id => porId.get(id));
    const semProva = ligadas.filter(af => !COM_PROVA.has(af.nivel_prova));
    if (semProva.length) {
      c.push({ ...base, codigo: 'afirmacao_sem_prova', motivo: `${semProva.map(af => `${af.id} (${af.nivel_prova})`).join(', ')} usada como fato; só verificado ou entregue sustenta número e fato no CV` });
      continue;
    }
    const problemas = [];
    let codigo = null;
    for (const numero of item.numeros) {
      const chave = chaveNumero(numero);
      if (ligadas.some(af => chaves.get(af.id).has(chave))) continue;
      const outra = afirmacoes.find(af => !item.claim_ids.includes(af.id) && chaves.get(af.id).has(chave));
      const esperados = [...new Set(ligadas.flatMap(af => numerosDaAfirmacao(af).map(n => n.bruto)))];
      if (outra) {
        codigo ??= 'numero_orfao';
        problemas.push(`número ${numero.bruto} só existe em ${outra.id} (afirmação não ligada a este bullet)`);
      } else if (esperados.length) {
        codigo ??= 'numero_divergente';
        problemas.push(`número ${numero.bruto} diverge de ${item.claim_ids.join(', ')} (${esperados.join(', ')})`);
      } else {
        codigo ??= 'numero_orfao';
        problemas.push(`número ${numero.bruto} sem afirmação que o sustente`);
      }
    }
    if (problemas.length) c.push({ ...base, codigo, motivo: problemas.join('; ') });
    else a.push({ ...base, afirmacoes: ligadas.map(af => ({ id: af.id, nivel_prova: af.nivel_prova })) });
  }
  return { a, c };
}

const FORCA = { verificado: 2, entregue: 1 };
const resumo = (texto, max = 140) => (texto.length > max ? `${texto.slice(0, max - 1).trimEnd()}…` : texto);

// (b) dado fora do CV: afirmação com uso CV, com prova e publicável que nenhum bullet cita; e arco ou história sem afirmação ligada.
export function classificarForaDoCv({ afirmacoes, itens, historias = [], arcos = [], cvCarregado }) {
  const avisos = [];
  const b = [];
  if (cvCarregado) {
    const citadas = new Set(itens.flatMap(item => item.claim_ids));
    const candidatas = afirmacoes.filter(af => af.uso?.includes('CV') && COM_PROVA.has(af.nivel_prova) && af.publicavel !== 'nao' && !citadas.has(af.id));
    candidatas.sort((x, y) => FORCA[y.nivel_prova] - FORCA[x.nivel_prova] || numerosDaAfirmacao(y).length - numerosDaAfirmacao(x).length || x.id.localeCompare(y.id, 'pt-BR', { numeric: true }));
    for (const af of candidatas) b.push({ tipo: 'afirmacao', id: af.id, nivel_prova: af.nivel_prova, texto: resumo(af.texto), motivo: 'afirmação liberada para CV que nenhum bullet cita' });
  } else avisos.push('nenhum modelo de CV carregado: o (b) de afirmações não foi calculado.');
  for (const arco of [...historias, ...arcos]) {
    if ((arco.afirmacoes ?? []).length === 0) b.push({ tipo: 'arco', id: arco.id, titulo: arco.titulo ?? null, motivo: 'arco ou história sem afirmação ligada' });
  }
  return { b, avisos };
}

export function calcularQuadrantes({ afirmacoes, evidencias = [], historias = [], arcos = [], itens = [], cvCarregado = itens.length > 0, vagas = [], hoje, buracoMeses, freqMinima }) {
  const { a, c } = classificarItens({ afirmacoes, itens });
  const { b, avisos } = classificarForaDoCv({ afirmacoes, itens, historias, arcos, cvCarregado });
  const d = calcularLacunas({ afirmacoes, evidencias, vagas, hoje, buracoMeses, freqMinima });
  return { a, b, c, d, contagem: { a: a.length, b: b.length, c: c.length, d: d.length }, avisos };
}
