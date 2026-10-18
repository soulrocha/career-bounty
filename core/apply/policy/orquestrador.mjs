// Orquestrador de envio automático por política (F7.10, seams S7/S8).
// Encadeia: Kill switch -> Avaliador de política -> Limites diários/Reserva -> Driver -> Conclusão de desfecho.
import { isEnvioPausado } from './killswitch.mjs';
import { avaliarPolitica } from './evaluate.mjs';
import { validarRegras } from './schema.mjs';
import { reservarEnvio, concluirEnvio } from './limits.mjs';
import { emitirAprovacaoPolitica } from '../approval.mjs';
import { executarDriver } from '../drivers/base.mjs';
import { PORTAIS } from '../drivers/portais.mjs';
import { appendEvents } from '../../store/events.mjs';

export async function orquestrarEnvio({
  dataRoot,
  regras = [],
  candidatura,
  respostas = {},
  cv = null,
  dryRun = false,
  ts = new Date().toISOString(),
  navegador,
  abrir,
  executarDriverFake
}) {
  const vagaId = candidatura.vaga_id ?? candidatura.id;

  // 1. Kill switch
  if (await isEnvioPausado(dataRoot)) {
    await appendEvents(dataRoot, [{
      id: `negado-${Date.now()}`,
      ts,
      ator: 'orquestrador',
      tipo: 'envio.negado',
      entidade: 'vaga',
      entidade_id: vagaId,
      dados: { motivo: 'envio pausado pelo kill switch' }
    }], { now: ts });
    return { estado: 'blocked', motivo: 'envio_pausado' };
  }

  // 2. Avaliar política
  const regrasNorm = validarRegras(regras);
  const contexto = {
    aderencia: candidatura.aderencia,
    portal: candidatura.portal,
    rascunhos_llm: candidatura.rascunhos_llm ?? 0,
    respostas_novas_na_rodada: candidatura.respostas_novas_na_rodada ?? 0,
    cv_gate: candidatura.cv_gate ?? 'ok',
    ja_aplicada: Boolean(candidatura.ja_aplicada)
  };
  const avaliacao = avaliarPolitica({ regras: regrasNorm, contexto });
  const regraId = avaliacao.regra ?? avaliacao.regra_id ?? null;
  if (avaliacao.acao !== 'enviar_automatico') {
    return { estado: 'parar_antes_de_enviar', motivos: avaliacao.motivos, regra: regraId };
  }

  const portalNome = String(candidatura.portal ?? '').toLowerCase();
  const portalDef = PORTAIS[portalNome];
  if (!portalDef) {
    return { estado: 'blocked', motivo: 'portal_sem_driver' };
  }

  // 3. Limite diário / Reserva
  const regra = regras.find(r => r.id === regraId);
  const reserva = await reservarEnvio(dataRoot, {
    regraId,
    limiteRegra: regra?.limite_dia ?? avaliacao.limite_dia ?? 5,
    vagaId,
    ts
  });

  if (!reserva.ok) {
    await appendEvents(dataRoot, [{
      id: `negado-${Date.now()}`,
      ts,
      ator: 'orquestrador',
      tipo: 'envio.negado',
      entidade: 'vaga',
      entidade_id: vagaId,
      dados: { regra: regraId, motivo: reserva.motivo }
    }], { now: ts });
    return { estado: 'blocked', motivo: reserva.motivo, regra: regraId };
  }

  // 4. Emitir aprovação política
  await emitirAprovacaoPolitica(dataRoot, {
    vagaId,
    hashPdf: cv?.sha256 ?? null,
    ts
  });

  // 5. Executar driver (ou fake em testes)
  const driverFn = executarDriverFake ?? executarDriver;
  const resultado = await driverFn({
    portal: portalDef,
    url: candidatura.url,
    respostas,
    cv,
    dryRun,
    navegador,
    abrir,
    antesDoClique: async () => {}
  });

  // 6. Concluir reserva com base no resultado
  let desfecho = 'bloqueou';
  if (resultado.estado === 'enviada' || resultado.estado === 'enviada_sem_comprovante') {
    desfecho = 'enviou';
  } else if (resultado.estado === 'falhou' || resultado.estado === 'incerta' || resultado.estado === 'erro') {
    desfecho = 'falhou';
  }
  await concluirEnvio(dataRoot, {
    reservaId: reserva.reserva_id,
    vagaId,
    resultado: desfecho,
    ts
  });

  return {
    ...resultado,
    regra: regraId,
    reserva_id: reserva.reserva_id
  };
}
