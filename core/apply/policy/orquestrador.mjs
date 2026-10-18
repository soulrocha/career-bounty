// Orquestrador de envio automático por política (F7.10, seams S7/S8).
// Encadeia: kill switch -> política -> origem do portal -> reserva/limites -> aprovação amarrada a hashes -> driver
// (com kill switch e consumo do token de novo logo antes do clique) -> conclusão do desfecho. Falha fechado: contexto
// ausente nega, desfecho incerto consome o limite e trava a vaga.
import { isEnvioPausado } from './killswitch.mjs';
import { avaliarPolitica } from './evaluate.mjs';
import { validarRegras } from './schema.mjs';
import { reservarEnvio, concluirEnvio } from './limits.mjs';
import { consumirAprovacao, emitirAprovacaoPolitica } from '../approval.mjs';
import { executarDriver, hashRespostas, origemPermitida } from '../drivers/base.mjs';
import { PORTAIS } from '../drivers/portais.mjs';
import { appendEvents } from '../../store/events.mjs';

const DESFECHO = { enviada: 'enviou', enviada_sem_comprovante: 'incerta', incerta: 'incerta', falhou: 'falhou', erro: 'falhou' };

// `portais` existe para os testes apontarem as origens para um servidor local; nenhum comando o expõe.
export async function orquestrarEnvio({
  dataRoot,
  regras = [],
  limiteGlobal = null,
  candidatura,
  respostas = {},
  cv = null,
  dryRun = true,
  ts = new Date().toISOString(),
  portais = PORTAIS,
  navegador,
  abrir,
  hoje,
  empresa = null,
  executarDriverFake
}) {
  const vagaId = candidatura.vaga_id ?? candidatura.id;
  let seq = 0;
  const negar = (dados, tipo = 'envio.negado') => appendEvents(dataRoot, [{
    id: `${tipo}-${vagaId}-${Date.parse(ts)}-${seq++}-${process.pid}`, ts, ator: 'orquestrador', tipo, entidade: 'vaga', entidade_id: vagaId, dados
  }], { now: ts });

  // 1. Kill switch
  if (await isEnvioPausado(dataRoot)) {
    await negar({ motivo: 'envio pausado pelo kill switch' });
    return { estado: 'blocked', motivo: 'envio_pausado' };
  }

  // 2. Política. O contexto vem da candidatura sem padrões: o que faltar nega (ver avaliarPolitica).
  const regrasNorm = validarRegras(regras);
  const avaliacao = avaliarPolitica({
    regras: regrasNorm,
    contexto: {
      aderencia: candidatura.aderencia,
      portal: candidatura.portal,
      rascunhos_llm: candidatura.rascunhos_llm,
      respostas_novas_na_rodada: candidatura.respostas_novas_na_rodada,
      cv_gate: candidatura.cv_gate,
      ja_aplicada: candidatura.ja_aplicada
    }
  });
  const regraId = avaliacao.regra ?? null;
  if (avaliacao.acao !== 'enviar_automatico') return { estado: 'parar_antes_de_enviar', motivos: avaliacao.motivos, regra: regraId };

  // 3. Portal com driver e URL só nas origens https dele.
  const portalDef = portais[String(candidatura.portal ?? '').toLowerCase()];
  if (!portalDef) return { estado: 'blocked', motivo: 'portal_sem_driver' };
  if (!origemPermitida(portalDef, candidatura.url)) {
    await negar({ regra: regraId, motivo: 'origem_nao_permitida' });
    return { estado: 'blocked', motivo: 'origem_nao_permitida', regra: regraId };
  }

  // 4. Limites e reserva. Regra sem limite já foi recusada na validação; aqui não existe valor padrão.
  const reserva = await reservarEnvio(dataRoot, { regraId, limiteRegra: avaliacao.limite_dia, limiteGlobal, vagaId, ts });
  if (!reserva.ok) {
    await negar({ regra: regraId, motivo: reserva.motivo });
    return { estado: 'blocked', motivo: reserva.motivo, regra: regraId };
  }

  // 5. Aprovação da política amarrada ao PDF e às respostas; só existe quando vai haver clique.
  const hashes = { hashPdf: cv?.sha256 ?? null, hashRespostas: hashRespostas(respostas) };
  if (!dryRun) await emitirAprovacaoPolitica(dataRoot, { vagaId, ts, ...hashes });

  // 6. Driver. Logo antes do clique: kill switch de novo e consumo do token (uso único, hashes conferidos).
  const antesDoClique = async recebidos => {
    if (await isEnvioPausado(dataRoot)) {
      await negar({ regra: regraId, motivo: 'envio pausado pelo kill switch (antes do clique)' });
      return { bloquear: 'envio_pausado' };
    }
    const consumo = await consumirAprovacao(dataRoot, { vagaId, ts, contexto: 'driver', hashPdf: recebidos?.hashPdf ?? null, hashRespostas: recebidos?.hashRespostas ?? null });
    if (!consumo.ok) {
      await negar({ regra: regraId, motivo: `aprovação recusada: ${consumo.motivo}` });
      return { bloquear: 'aprovacao_invalida', detalhe: consumo.motivo };
    }
    return undefined;
  };
  let resultado;
  try {
    resultado = await (executarDriverFake ?? executarDriver)({ portal: portalDef, url: candidatura.url, respostas, cv, hoje, empresa, dryRun, navegador, abrir, antesDoClique });
  } catch (erro) {
    resultado = { estado: 'incerta', motivo: String(erro.message).slice(0, 200) };
  }

  // 7. Desfecho. Dry-run e bloqueio devolvem a vaga ao dia; enviado, incerto e sem comprovante consomem.
  await concluirEnvio(dataRoot, { reservaId: reserva.reserva_id, vagaId, resultado: DESFECHO[resultado.estado] ?? 'bloqueou', ts });
  return { ...resultado, regra: regraId, reserva_id: reserva.reserva_id };
}
