// Quadrantes dado x currículo. Determinístico: nenhuma chamada a LLM.
//   (a) dado e CV conferem     (c) CV sem dado (ou que não confere)
//   (b) dado fora do CV        (d) lacuna    -> acrescentados na F4.5
import { chaveNumero, numerosDaAfirmacao } from '../cv/numeros.mjs';
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
