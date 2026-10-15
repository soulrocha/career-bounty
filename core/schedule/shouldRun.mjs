// Gatilho da rotina diária (seam S11): relógio injetado, fuso America/Sao_Paulo, sem I/O.
import { diaUtil } from '../sources/plan.mjs';
import { localDay, TIMEZONE } from '../store/schema.mjs';

const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hourCycle: 'h23', hour: '2-digit' });
export const horaLocal = now => Number(hourFormat.format(now));

export const AGENDA_PADRAO = { hora_inicio: 18, feriados: [], host_agendador: null };

// Decide se a rotina roda agora. `ultima`: último marcador gravado ({ dia, estado, retomadas }) ou null.
// Antes do horário nada é consumido: quem chama não grava marcador quando run é falso.
export function shouldRun({ now, ultima, config = {}, host }) {
  const agenda = { ...AGENDA_PADRAO, ...config };
  if (agenda.host_agendador && agenda.host_agendador !== host) return { run: false, motivo: 'outro_host' };
  const hoje = localDay(now);
  if (diaUtil(now) === null) return { run: false, motivo: 'fim_de_semana' };
  if (agenda.feriados.includes(hoje)) return { run: false, motivo: 'feriado' };
  if (horaLocal(now) < agenda.hora_inicio) return { run: false, motivo: 'antes_do_horario' };
  if (ultima?.dia === hoje) {
    if (ultima.estado === 'concluida') return { run: false, motivo: 'ja_rodou_hoje' };
    if ((ultima.retomadas ?? 0) >= 1) return { run: false, motivo: 'retomada_esgotada' };
    return { run: true, motivo: 'retomada', retomada: true };
  }
  return { run: true, motivo: 'no_horario', retomada: false };
}
