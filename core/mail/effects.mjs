// Efeitos do e-mail classificado e vinculado: etapa da candidatura, proposta de evento de Calendar e aviso de prazo.
// Função pura: devolve eventos para o log. O Calendar nunca é tocado por script; a criação real fica na sessão, com confirmação.
import { fold } from '../dedup/keys.mjs';
import { sanitizarCampo } from './sanitize.mjs';

export const ETAPAS = ['inscrita', 'etapa', 'entrevista', 'oferta'];
const ETAPA_DA_CLASSE = { confirmacao: 'inscrita', etapa_liberada: 'etapa', entrevista_agendada: 'entrevista', oferta: 'oferta' };
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const pad = n => String(n).padStart(2, '0');
const somaDias = (dia, n) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const diaValido = (ano, mes, dia) => { const d = new Date(Date.UTC(ano, mes - 1, dia)); return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia; };

// Data, hora e local de uma entrevista no texto. O ano vem do e-mail; data já passada vira a do ano seguinte.
export function extrairEntrevista(texto, dataEmail) {
  const t = fold(texto);
  let dia = null;
  let mes = null;
  const numerica = /\b(?:dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(t);
  const extenso = new RegExp(`\\b(\\d{1,2}) de (${MESES.join('|')})`).exec(t);
  let ano = Number(dataEmail.slice(0, 4));
  if (numerica) { dia = Number(numerica[1]); mes = Number(numerica[2]); if (numerica[3]) ano = Number(numerica[3].length === 2 ? `20${numerica[3]}` : numerica[3]); }
  else if (extenso) { dia = Number(extenso[1]); mes = MESES.indexOf(extenso[2]) + 1; }
  if (!dia || !diaValido(ano, mes, dia)) return null;
  let data = `${ano}-${pad(mes)}-${pad(dia)}`;
  if (data < somaDias(dataEmail, -1) && !(numerica?.[3])) {
    if (!diaValido(ano + 1, mes, dia)) return null;
    data = `${ano + 1}-${pad(mes)}-${pad(dia)}`;
  }
  const h = /\b(\d{1,2})(?:h|:)(\d{2})?(?!\d)/.exec(t.replace(/\d{1,2}\/\d{1,2}(\/\d+)?/g, ' '));
  const hora = h && Number(h[1]) < 24 && Number(h[2] ?? 0) < 60 ? `${pad(Number(h[1]))}:${pad(Number(h[2] ?? 0))}` : null;
  const local = /google meet/.test(t) ? 'videochamada (Google Meet)' : /zoom/.test(t) ? 'videochamada (Zoom)' : /teams/.test(t) ? 'videochamada (Teams)' : /videochamada|video chamada|online/.test(t) ? 'videochamada' : /presencial/.test(t) ? 'presencial' : null;
  return { data, hora, local };
}

// Prazo ("em até N dias" ou "N horas"): data limite a partir do dia do e-mail.
export function extrairPrazo(texto, dataEmail) {
  const t = fold(texto);
  const dias = /\bem ate (\d{1,2}) dias?/.exec(t) ?? /\bprazo de (\d{1,2}) dias?/.exec(t) ?? /\bwithin (\d{1,2}) days?/.exec(t);
  if (dias) return somaDias(dataEmail, Number(dias[1]));
  const horas = /\bem ate (\d{1,3}) horas?/.exec(t) ?? /\bwithin (\d{1,3}) hours?/.exec(t);
  return horas ? somaDias(dataEmail, Math.max(1, Math.ceil(Number(horas[1]) / 24))) : null;
}

const base = (tipo, id, entidade, entidadeId, ts, dados) => ({ id: `${tipo}:${id}`, ts, ator: 'email', tipo, entidade, entidade_id: entidadeId, dados });

// itens: [{ item, classificacao: { classe, confianca, origem }, vinculo, corpo }]; vagas: projeção atual do tracker.
export function aplicarEfeitos({ itens, vagas, now = new Date() }) {
  const ts = now.toISOString();
  const eventos = [];
  const resumo = { recebidos: 0, avancaram: 0, pendentes: 0, revisar: 0, propostas: 0, prazos: 0, ignorados: 0 };
  const porId = new Map(vagas.map(v => [v.id, v]));
  const etapaDe = new Map();
  const encerradas = new Set();
  const etapaAtual = id => etapaDe.get(id) ?? porId.get(id)?.candidatura_email?.etapa ?? null;
  const encerrada = id => encerradas.has(id) || porId.get(id)?.candidatura_email?.encerrada === true;
  const ordenados = [...itens].sort((a, b) => a.item.data.localeCompare(b.item.data) || a.item.message_id.localeCompare(b.item.message_id));
  for (const entrada of ordenados) {
    const { item, classificacao, vinculo, corpo } = entrada;
    const comum = { message_id: item.message_id, classe: classificacao.classe, data_email: item.data, remetente_dominio: item.remetente_dominio, assunto: sanitizarCampo(item.assunto, 160) };
    if (vinculo.status === 'sem_candidatura') { resumo.ignorados += 1; continue; }
    if (classificacao.classe === 'pendente' || !classificacao.classe) { resumo.pendentes += 1; eventos.push(base('email.pendente', item.message_id, 'email', item.message_id, ts, { ...comum, motivo: 'classe_incerta' })); continue; }
    if (vinculo.status === 'pendente') { resumo.pendentes += 1; eventos.push(base('email.pendente', item.message_id, 'email', item.message_id, ts, { ...comum, motivo: vinculo.motivo })); continue; }
    if (classificacao.confianca !== 'alta') { resumo.revisar += 1; eventos.push(base('email.revisar', item.message_id, 'email', item.message_id, ts, { ...comum, vaga_id: vinculo.vaga_id, motivo: 'dominio_nao_confere' })); continue; }
    const vaga = porId.get(vinculo.vaga_id);
    const etapa = ETAPA_DA_CLASSE[classificacao.classe] ?? null;
    const encerra = classificacao.classe === 'negativa';
    const atual = etapaAtual(vinculo.vaga_id);
    const avanca = !encerrada(vinculo.vaga_id) && ((etapa && ETAPAS.indexOf(etapa) > ETAPAS.indexOf(atual)) || encerra);
    if (avanca && etapa) etapaDe.set(vinculo.vaga_id, etapa);
    if (avanca && encerra) encerradas.add(vinculo.vaga_id);
    resumo.recebidos += 1;
    if (avanca) resumo.avancaram += 1;
    eventos.push(base('email.recebido', item.message_id, 'vaga', vinculo.vaga_id, ts, { ...comum, vaga_id: vinculo.vaga_id, requisicao: vinculo.requisicao, etapa: encerra ? 'encerrada' : etapa, avancou: avanca }));
    if (encerrada(vinculo.vaga_id) && !encerra) continue;
    const texto = `${item.assunto}\n${item.trecho}\n${corpo ?? ''}`;
    if (classificacao.classe === 'entrevista_agendada') {
      const quando = extrairEntrevista(texto, item.data);
      if (quando) {
        resumo.propostas += 1;
        eventos.push(base('calendario.proposto', item.message_id, 'vaga', vinculo.vaga_id, ts, { message_id: item.message_id, vaga_id: vinculo.vaga_id, status: 'proposto', titulo: `Entrevista - ${vaga?.empresa ?? 'empresa'} - ${vaga?.cargo ?? 'vaga'}`.slice(0, 160), data: quando.data, hora: quando.hora, local: quando.local }));
      }
    }
    if (classificacao.classe === 'etapa_liberada') {
      const ate = extrairPrazo(texto, item.data);
      if (ate) { resumo.prazos += 1; eventos.push(base('aviso.prazo', item.message_id, 'vaga', vinculo.vaga_id, ts, { message_id: item.message_id, vaga_id: vinculo.vaga_id, ate, motivo: 'etapa_liberada' })); }
    }
  }
  return { eventos, resumo };
}
