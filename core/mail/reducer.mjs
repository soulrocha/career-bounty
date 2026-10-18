// Reducer do evento `email.recebido`: etapa da candidatura sobe e nunca desce; negativa encerra só aquela vaga.
// A data do e-mail vai para `ultimo_email_em`, nunca para a data de inscrição (`data`).
import { ETAPAS } from './effects.mjs';
import { ORDEM_ETAPAS_PROCESSO } from '../store/rules.mjs';

const MAPA_ETAPAS_EMAIL = {
  inscrita: 'aplicada',
  etapa: 'teste',
  entrevista: 'entrevista_rh',
  oferta: 'proposta',
  negativa: 'encerrado',
  encerrada: 'encerrado',
};

export function normalizarEtapaEmail(etapa) {
  if (!etapa || typeof etapa !== 'string') return null;
  return MAPA_ETAPAS_EMAIL[etapa] ?? etapa;
}

export function aplicarEmailRecebido(vaga, dados) {
  const atual = vaga.candidatura_email ?? {};
  const mensagens = [...new Set([...(atual.mensagens ?? []), dados.message_id])];
  const ultimo = [atual.ultimo_email_em, dados.data_email].filter(Boolean).sort().at(-1);
  if (atual.encerrada) return { ...vaga, candidatura_email: { ...atual, mensagens, ultimo_email_em: ultimo } };

  const etapaNorm = normalizarEtapaEmail(dados.etapa);
  if (etapaNorm === 'encerrado' || dados.etapa === 'encerrada' || dados.etapa === 'negativa') {
    return {
      ...vaga,
      candidatura_email: {
        ...atual,
        aplicada: true,
        encerrada: true,
        encerrada_em: dados.data_email,
        mensagens,
        ultimo_email_em: ultimo,
      },
    };
  }

  const atualNorm = normalizarEtapaEmail(atual.etapa);
  const idxAtual = atualNorm ? ORDEM_ETAPAS_PROCESSO.indexOf(atualNorm) : -1;
  const idxNova = etapaNorm ? ORDEM_ETAPAS_PROCESSO.indexOf(etapaNorm) : -1;

  // Se ambas as etapas estiverem na ordem padronizada, compara índices; fallback para ETAPAS legado
  const sobe = (idxNova >= 0 && idxAtual >= 0)
    ? idxNova > idxAtual
    : (idxNova >= 0 && idxAtual === -1)
      ? true
      : (dados.etapa && ETAPAS.indexOf(dados.etapa) > ETAPAS.indexOf(atual.etapa));

  const etapa = sobe ? dados.etapa : atual.etapa;
  return {
    ...vaga,
    candidatura_email: {
      ...atual,
      ...(etapa ? { aplicada: true, etapa } : {}),
      mensagens,
      ultimo_email_em: ultimo,
    },
  };
}

const ausente = event => Object.assign(new Error(`Entidade ausente para o evento ${event.id}.`), { code: 'ENTIDADE_AUSENTE' });

export const reducersEmail = {
  'email.recebido': (state, event) => {
    const atual = state.vagas.get(event.entidade_id);
    if (!atual) throw ausente(event);
    state.vagas.set(event.entidade_id, aplicarEmailRecebido(atual, event.dados));
    return state;
  },
};
