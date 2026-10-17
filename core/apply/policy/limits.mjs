// Limite diário do envio automático (F7.3): por regra e global, no dia civil de São Paulo, contado a partir do log de
// eventos (reinício não zera). A reserva é gravada sob lock antes do envio; bloqueado ou falho libera a vaga do dia,
// enviado consome. Dois processos no limite: só um reserva.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { appendEvents, readEvents } from '../../store/events.mjs';
import { withLock } from '../../store/lock.mjs';
import { localDay } from '../../store/schema.mjs';

// Reservas do dia que contam: concluídas como "enviou" ou ainda sem conclusão (em voo).
export function reservasDoDia(eventos, dia) {
  const concluidas = new Map(eventos.filter(e => e.tipo === 'envio.concluido').map(e => [e.dados.reserva_id, e.dados.resultado]));
  return eventos.filter(e => e.tipo === 'envio.reservado' && e.dados.dia === dia).filter(e => {
    const r = concluidas.get(e.dados.reserva_id);
    return r === undefined || r === 'enviou';
  });
}

export async function reservarEnvio(dataRoot, { regraId, limiteRegra, limiteGlobal = null, vagaId, ts = new Date().toISOString() }) {
  if (!Number.isInteger(limiteRegra) || limiteRegra < 1) throw new Error('Limite da regra ausente: negado por padrão.');
  return withLock(path.join(dataRoot, 'state', 'envio.lock'), { busyMessage: 'Outro envio está reservando; tente de novo.' }, async () => {
    const dia = localDay(ts);
    const contam = reservasDoDia((await readEvents(dataRoot)).eventos, dia);
    const daRegra = contam.filter(e => e.dados.regra === regraId).length;
    if (daRegra >= limiteRegra) return { ok: false, motivo: `limite diário da regra ${regraId} atingido (${limiteRegra})` };
    if (limiteGlobal !== null && contam.length >= limiteGlobal) return { ok: false, motivo: `limite diário global atingido (${limiteGlobal})` };
    const reservaId = `reserva-${createHash('sha256').update(`${regraId}|${vagaId}|${ts}|${contam.length}`).digest('hex').slice(0, 16)}`;
    await appendEvents(dataRoot, [{ id: reservaId, ts, ator: 'driver', tipo: 'envio.reservado', entidade: 'vaga', entidade_id: vagaId, dados: { reserva_id: reservaId, regra: regraId, dia } }], { now: ts });
    return { ok: true, reserva_id: reservaId, restantes: limiteRegra - daRegra - 1 };
  });
}

export async function concluirEnvio(dataRoot, { reservaId, vagaId, resultado, ts = new Date().toISOString() }) {
  if (!['enviou', 'bloqueou', 'falhou'].includes(resultado)) throw new Error(`Resultado de envio inválido: ${resultado}`);
  await appendEvents(dataRoot, [{ id: `${reservaId}:${resultado}`, ts, ator: 'driver', tipo: 'envio.concluido', entidade: 'vaga', entidade_id: vagaId, dados: { reserva_id: reservaId, resultado } }], { now: ts });
}
