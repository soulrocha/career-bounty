import { executarComando } from './transacao.mjs';
import { invalido, naoEncontrado } from '../errors.mjs';
import { publicMarker, requisicaoKey } from '../rules.mjs';
import { localIso } from '../schema.mjs';

// Descartar ou restaurar uma vaga. Nunca apaga candidatura nem comprovante. Porta de mark_discard.
export async function descartar({ dataRoot, id, descartada, now, host }) {
  if (typeof id !== 'string' || typeof descartada !== 'boolean') throw invalido('Descarte inválido.');
  const instante = now ?? new Date().toISOString();
  return executarComando({
    dataRoot, host, now: instante,
    decide: ({ documento }) => {
      const vaga = documento.vagas.find(item => item.id === id);
      if (!vaga) throw naoEncontrado('Vaga não encontrada.');
      return {
        evento: { tipo: 'vaga.descartada', entidade: 'vaga', entidade_id: id, dados: { descartada, registrado_em: localIso(instante), requisicao: requisicaoKey(vaga) } },
        resultado: depois => publicMarker(depois.vagas.find(item => item.id === id)),
      };
    },
  });
}
