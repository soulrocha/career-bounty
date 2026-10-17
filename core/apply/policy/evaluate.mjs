// Avaliador de política (F7.2, seam S7): função pura. Só libera enviar_automatico quando TODAS as condições de uma regra
// ativa valem. Contexto com campo faltando nega (falha fechado). Sem regra ativa: pronto_para_enviar com aprovação nominal.
import { CONDICOES, regrasAtivas } from './schema.mjs';

export const CAMPOS_CONTEXTO = Object.keys(CONDICOES);

function confere(nome, esperado, atual) {
  if (nome === 'aderencia') return esperado.includes(atual) || (atual === 'boa' && esperado.includes('alta'));
  if (nome === 'portal') return esperado.includes(atual);
  if (nome === 'rascunhos_llm' || nome === 'respostas_novas_na_rodada') return Number.isInteger(atual) && atual <= esperado;
  return atual === esperado;
}

const descrever = (nome, esperado, atual) => `${nome}: precisa ${JSON.stringify(esperado)}, está ${JSON.stringify(atual)}`;

// contexto: { aderencia, portal, rascunhos_llm, respostas_novas_na_rodada, cv_gate, ja_aplicada }.
// Devolve { acao, regra?, limite_dia?, motivos: [] }.
export function avaliarPolitica({ regras = [], contexto }) {
  const faltando = CAMPOS_CONTEXTO.filter(c => contexto?.[c] === undefined || contexto?.[c] === null);
  if (faltando.length) return { acao: 'parar_antes_de_enviar', motivos: [`contexto incompleto (${faltando.join(', ')}): negado por padrão`] };
  const ativas = regrasAtivas(regras);
  if (!ativas.length) return { acao: 'pronto_para_enviar', motivos: ['sem regra ativa: envio só com aprovação nominal'] };
  const avaliacoes = ativas.map(regra => ({ regra, falhas: Object.entries(regra.quando).filter(([n, e]) => !confere(n, e, contexto[n])).map(([n, e]) => descrever(n, e, contexto[n])) }));
  const satisfeitas = avaliacoes.filter(a => !a.falhas.length).map(a => a.regra);
  if (!satisfeitas.length) {
    return { acao: 'parar_antes_de_enviar', motivos: avaliacoes.map(a => `${a.regra.id}: ${a.falhas.join('; ')}`) };
  }
  // Conflito entre regras satisfeitas: vale a mais restritiva (qualquer uma que pare vence; entre envios, o menor limite).
  const restritiva = satisfeitas.find(r => r.acao !== 'enviar_automatico');
  if (restritiva) return { acao: restritiva.acao, regra: restritiva.id, motivos: [`regra ${restritiva.id} pede ${restritiva.acao}`] };
  const menor = [...satisfeitas].sort((a, b) => a.limite_dia - b.limite_dia || a.id.localeCompare(b.id))[0];
  return { acao: 'enviar_automatico', regra: menor.id, limite_dia: menor.limite_dia, motivos: [] };
}

// Tabela de verdade de uma regra: o caso que passa e um caso negativo por condição (para teste e para o relatório).
export function tabelaVerdade(regra, base) {
  const linhas = [{ caso: 'todas as condições', contexto: base, resultado: avaliarPolitica({ regras: [regra], contexto: base }).acao }];
  const negativos = { aderencia: 'media', portal: 'gupy', rascunhos_llm: 1, respostas_novas_na_rodada: 1, cv_gate: 'bloqueado', ja_aplicada: true };
  for (const nome of Object.keys(regra.quando)) {
    const contexto = { ...base, [nome]: negativos[nome] };
    linhas.push({ caso: `${nome} = ${JSON.stringify(negativos[nome])}`, contexto, resultado: avaliarPolitica({ regras: [regra], contexto }).acao });
  }
  return linhas;
}
