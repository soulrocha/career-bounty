import { executarComando } from './transacao.mjs';
import { invalido, naoEncontrado } from '../errors.mjs';
import { checkMarcacao, publicMarker } from '../rules.mjs';
import { localIso } from '../schema.mjs';

// "Já me candidatei": marca ou desmarca a candidatura da pessoa. Porta de mark_application.
export async function marcarCandidatura({ dataRoot, id, aplicada, data, now, host }) {
  if (typeof id !== 'string' || typeof aplicada !== 'boolean') throw invalido('Marcação inválida.');
  const instante = now ?? new Date().toISOString();
  return executarComando({
    dataRoot, host, now: instante,
    decide: ({ documento }) => {
      const vaga = documento.vagas.find(item => item.id === id);
      if (!vaga) throw naoEncontrado('Vaga não encontrada.');
      const motivo = checkMarcacao(vaga, { aplicada, data }, instante);
      if (motivo) throw invalido(motivo);
      return {
        evento: { tipo: 'candidatura.marcada', entidade: 'vaga', entidade_id: id, dados: { aplicada, data: aplicada ? data : null, registrado_em: localIso(instante) } },
        resultado: depois => publicMarker(depois.vagas.find(item => item.id === id)),
      };
    },
  });
}
