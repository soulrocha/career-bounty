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
import { ESTADOS, chaveTentativa, projetarTentativas, registrarDesfecho, reservarTentativa } from './attempts.mjs';
import { finalizarAbaDaTentativa, marcarAba, registrarScript } from './sessao.mjs';
import { registrarComprovante } from './receipt.mjs';
import { rotaDe } from './route.mjs';
import { appendEvents, readEvents } from '../store/events.mjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cvDoPainel, lerManifesto } from '../cv/artifacts.mjs';

export async function iniciarCandidatura(dataRoot, { vaga, tabId, ts = new Date().toISOString() }) {
  const { rota, portal } = rotaDe(vaga);
  const atual = cvDoPainel(await lerManifesto(dataRoot, vaga.id))?.atual;
  const cv = atual ? { hash: atual.hash, ats: atual.ats, pdf_sha256: createHash('sha256').update(await readFile(path.join(dataRoot, atual.ats))).digest('hex') } : null;
  const tentativa = await reservarTentativa(dataRoot, { vaga, rota, cv, ts });
  await marcarAba(dataRoot, { tabId, vagaId: vaga.id, tentativaId: tentativa.tentativa_id, cvAts: cv ? path.join(dataRoot, cv.ats) : null, rota, ts });
  return { ...tentativa, rota, portal };
}

// Pura: decide o que fazer com a extração. Não grava nada.
export async function prepararPreenchimento({ extracao: bruta, respostas, vaga, portal = null, hoje, runner = null, identity = [], meta, aoPreparar }) {
  const extracao = normalizarExtracao(bruta);
  if (bloqueadaPorHumano(extracao)) {
    const motivo = Object.entries(extracao.bloqueios).filter(([, v]) => v).map(([k]) => k).join(', ');
    const resumo = { campos: extracao.campos.length, desconhecidos: 0, ignorados: 0, todos_conhecidos: false };
    await aoPreparar?.(resumo);
    return { bloqueada: true, motivo: `página pede ação humana (${motivo})`, resumo };
  }
  const casamento = casarCampos({ extracao, respostas, portal, empresa: vaga.empresa, hoje });
  const resumo = { campos: extracao.campos.length, desconhecidos: casamento.desconhecidos.length, ignorados: casamento.ignorados.length,
    todos_conhecidos: extracao.campos.length > 0 && casamento.desconhecidos.length === 0 && casamento.ignorados.length === 0 };
  await aoPreparar?.(resumo);
  const { campos, chamadas_llm } = await classificarDesconhecidos({ desconhecidos: casamento.desconhecidos, runner, identity, meta });
  return {
    bloqueada: false,
    resumo,
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
export async function registrarPreparacao(dataRoot, { vaga, preparo, portal = null, tentativa_id, rascunhosSugeridos = {}, ts = new Date().toISOString() }) {
  if (tentativa_id && preparo.resumo) await registrarResumoPreparacao(dataRoot, { vaga, tentativa_id, resumo: preparo.resumo, ts });
  if (preparo.bloqueada) return { perguntas: 0 };
  await registrarScript(dataRoot, { vagaId: vaga.id, script: preparo.script, ts });
  const eventos = [...preparo.perguntas, ...preparo.rascunhos].map(campo => {
    const e = eventoPerguntaPendente({ vaga, campo, portal, ts });
    if (rascunhosSugeridos[campo.ref]) e.dados.sugestao = rascunhosSugeridos[campo.ref];
    return e;
  });
  const perguntas = eventos.length;
  if (eventos.length) await appendEvents(dataRoot, eventos, { now: ts });
  return { perguntas };
}

export async function registrarResumoPreparacao(dataRoot, { vaga, tentativa_id, resumo, ts = new Date().toISOString() }) {
  const hash = createHash('sha256').update(JSON.stringify([resumo.campos, resumo.desconhecidos, resumo.ignorados, resumo.todos_conhecidos])).digest('hex').slice(0, 16);
  return appendEvents(dataRoot, [{ id: `candidatura.preparada:${tentativa_id}:${ts}:${hash}`, ts, ator: 'aplicar', tipo: 'candidatura.preparada', entidade: 'vaga', entidade_id: vaga.id,
    dados: { vaga_id: vaga.id, tentativa_id, ...resumo } }], { now: ts });
}

export async function encerrarCandidatura(dataRoot, { tentativa, vaga, tabId, estado, bruto = null, motivo = null, ts = new Date().toISOString() }) {
  if (!ESTADOS.includes(estado) || estado === 'em_andamento') throw new Error(`Desfecho inválido: ${estado}`);
  return finalizarAbaDaTentativa(dataRoot, { tabId, vagaId: vaga.id, tentativaId: tentativa.tentativa_id, manter: estado === 'bloqueada:humano', ts }, async () => {
    const chave = chaveTentativa(vaga);
    const atual = projetarTentativas((await readEvents(dataRoot)).eventos).get(chave);
    if (tentativa.chave !== chave || atual?.tentativa_id !== tentativa.tentativa_id || atual.vaga_id !== vaga.id || atual.estado !== 'em_andamento') throw new Error('Tentativa sem vínculo atual com esta vaga.');
    let comprovante = null;
    if (['enviada', 'enviada_sem_comprovante'].includes(estado)) ({ estado, comprovante } = await registrarComprovante(dataRoot, { vaga, bruto, ts }));
    await registrarDesfecho(dataRoot, { ...tentativa, vagaId: vaga.id, estado, comprovante, motivo, ts });
    return { estado, comprovante };
  });
}

export { lerRespostas };
