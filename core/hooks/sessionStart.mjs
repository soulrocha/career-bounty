// Resumo de SessionStart (seam S9): o que depende da pessoa, em até ~300 tokens (1200 caracteres), sem URL nem identidade.
import { loadSettings } from '../config.mjs';
import { readState } from '../schedule/dailyRun.mjs';
import { AGENDA_PADRAO, horaLocal } from '../schedule/shouldRun.mjs';
import { diaUtil } from '../sources/plan.mjs';
import { readEvents } from '../store/events.mjs';
import { projectEvents } from '../store/project.mjs';
import { localDay } from '../store/schema.mjs';

export const MAX_CHARS = 1200;
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

export async function sessionSummary({ dataRoot, now = new Date() }) {
  const settings = await loadSettings({ dataRoot });
  const { eventos } = await readEvents(dataRoot);
  const rodadas = eventos.filter(evento => evento.tipo === 'radar.rodada').map(evento => evento.dados);
  const ultima = rodadas.at(-1) ?? {};
  const vagas = projectEvents(eventos).vagas;
  const itens = [];

  const perguntas = ultima.perguntas_pendentes ?? 0;
  if (perguntas) itens.push(`${plural(perguntas, 'pergunta pendente', 'perguntas pendentes')} para você responder`);
  const talvez = vagas.filter(vaga => vaga.triagem?.decisao === 'talvez' && !vaga.descarte_usuario?.descartada && !vaga.candidatura_usuario?.aplicada).length;
  if (talvez) itens.push(`${plural(talvez, 'vaga em "talvez"', 'vagas em "talvez"')} aguardam sua decisão`);
  const idsRodada = new Set([...(ultima.novas_ids ?? []), ...(ultima.avaliadas_ids ?? [])]);
  const boas = vagas.filter(vaga => idsRodada.has(vaga.id) && ['alta', 'media'].includes(vaga.aderencia)).length;
  if (boas) itens.push(`${plural(boas, 'vaga nova de alta ou média aderência', 'vagas novas de alta ou média aderência')} na última rodada`);
  const prazos = ultima.mudancas_prazo?.length ?? 0;
  if (prazos) itens.push(`${plural(prazos, 'prazo mudou', 'prazos mudaram')}`);

  const estado = await readState(dataRoot);
  const rodouHoje = estado?.dia === localDay(now) && estado.estado === 'concluida';
  const horaInicio = settings.radar.agenda?.hora_inicio ?? AGENDA_PADRAO.hora_inicio;
  const esperavaRodar = diaUtil(now) !== null && horaLocal(now) >= horaInicio;
  if (itens.length || (esperavaRodar && !rodouHoje)) itens.push(`rotina de hoje: ${rodouHoje ? 'rodou' : 'não rodou'}`);

  if (!itens.length) return null;
  return `CareerBounty, pendências:\n${itens.map(item => `- ${item}`).join('\n')}`.slice(0, MAX_CHARS);
}
