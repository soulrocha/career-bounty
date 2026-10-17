// Sessão de candidatura assistida (F6.10): o que a skill aplicar chama pela CLI a cada vaga.
// iniciar: reserva a tentativa (antes de qualquer ação) e marca a aba. preparar: casa os campos extraídos com o answer bank,
// classifica o desconhecido, registra o script de preenchimento (sem resposta sensível) e cria as perguntas pendentes.
// encerrar: grava o desfecho e libera a aba. Captcha, login ou MFA: bloqueada:humano, a aba fica aberta para a pessoa.
import { lerRespostas } from './answers.mjs';
import { bloqueadaPorHumano, normalizarExtracao } from './extrator.mjs';
import { casarCampos } from './matcher.mjs';
import { classificarDesconhecidos } from './classify.mjs';
import { preenchaVoce, scriptDePreenchimento } from './preencher.mjs';
import { eventoPerguntaPendente } from './perguntas.mjs';
import { registrarDesfecho, reservarTentativa } from './attempts.mjs';
import { desmarcarAba, marcarAba, registrarScript } from './sessao.mjs';
import { rotaDe } from './route.mjs';
import { appendEvents } from '../store/events.mjs';

export async function iniciarCandidatura(dataRoot, { vaga, tabId, ts = new Date().toISOString() }) {
  const { rota, portal } = rotaDe(vaga);
  const tentativa = await reservarTentativa(dataRoot, { vaga, rota, ts });
  await marcarAba(dataRoot, { tabId, vagaId: vaga.id, ts });
  return { ...tentativa, rota, portal };
}

// Pura: decide o que fazer com a extração. Não grava nada.
export async function prepararPreenchimento({ extracao: bruta, respostas, vaga, portal = null, hoje, runner = null, identity = [] }) {
  const extracao = normalizarExtracao(bruta);
  if (bloqueadaPorHumano(extracao)) {
    const motivo = Object.entries(extracao.bloqueios).filter(([, v]) => v).map(([k]) => k).join(', ');
    return { bloqueada: true, motivo: `página pede ação humana (${motivo})` };
  }
  const casamento = casarCampos({ extracao, respostas, portal, empresa: vaga.empresa, hoje });
  const { campos, chamadas_llm } = await classificarDesconhecidos({ desconhecidos: casamento.desconhecidos, runner, identity });
  return {
    bloqueada: false,
    script: scriptDePreenchimento(casamento.preenchimentos),
    anexar_cv: casamento.preenchimentos.some(p => p.tipo === 'file'),
    preencha_voce: preenchaVoce(casamento),
    perguntas: campos.filter(c => c.decisao === 'pergunta'),
    rascunhos: campos.filter(c => c.decisao === 'rascunho'),
    pronta: campos.length === 0,
    chamadas_llm,
  };
}

// Grava o efeito da preparação: script registrado para o hook e perguntas pendentes (rascunho também vira pergunta,
// com o texto sugerido, para a pessoa aprovar na aba Perguntas antes de qualquer uso).
export async function registrarPreparacao(dataRoot, { vaga, preparo, portal = null, rascunhosSugeridos = {}, ts = new Date().toISOString() }) {
  if (preparo.bloqueada) return { perguntas: 0 };
  await registrarScript(dataRoot, { vagaId: vaga.id, script: preparo.script, ts });
  const eventos = [...preparo.perguntas, ...preparo.rascunhos].map(campo => {
    const e = eventoPerguntaPendente({ vaga, campo, portal, ts });
    if (rascunhosSugeridos[campo.ref]) e.dados.sugestao = rascunhosSugeridos[campo.ref];
    return e;
  });
  if (eventos.length) await appendEvents(dataRoot, eventos, { now: ts });
  return { perguntas: eventos.length };
}

export async function encerrarCandidatura(dataRoot, { tentativa, vaga, tabId, estado, comprovante = null, motivo = null, ts = new Date().toISOString() }) {
  await registrarDesfecho(dataRoot, { ...tentativa, vagaId: vaga.id, estado, comprovante, motivo, ts });
  // Bloqueada por humano: a aba continua marcada (e protegida) para a pessoa resolver ali.
  if (estado !== 'bloqueada:humano') await desmarcarAba(dataRoot, { tabId, ts });
  return { estado };
}

export { lerRespostas };
