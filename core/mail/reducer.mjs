// Reducer do evento `email.recebido`: etapa da candidatura sobe e nunca desce; negativa encerra só aquela vaga.
// A data do e-mail vai para `ultimo_email_em`, nunca para a data de inscrição (`data`).
import { ETAPAS } from './effects.mjs';

export function aplicarEmailRecebido(vaga, dados) {
  const atual = vaga.candidatura_email ?? {};
  const mensagens = [...new Set([...(atual.mensagens ?? []), dados.message_id])];
  const ultimo = [atual.ultimo_email_em, dados.data_email].filter(Boolean).sort().at(-1);
  if (atual.encerrada) return { ...vaga, candidatura_email: { ...atual, mensagens, ultimo_email_em: ultimo } };
  if (dados.etapa === 'encerrada') return { ...vaga, candidatura_email: { ...atual, aplicada: true, encerrada: true, encerrada_em: dados.data_email, mensagens, ultimo_email_em: ultimo } };
  const sobe = dados.etapa && ETAPAS.indexOf(dados.etapa) > ETAPAS.indexOf(atual.etapa);
  const etapa = sobe ? dados.etapa : atual.etapa;
  return { ...vaga, candidatura_email: { ...atual, ...(etapa ? { aplicada: true, etapa } : {}), mensagens, ultimo_email_em: ultimo } };
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
