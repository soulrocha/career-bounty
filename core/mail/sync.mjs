// Sincronização de e-mail: consulta restrita, fase A, regras, fase B só do que precisa, classificador, vínculo, efeitos.
// Em dry-run nada vai ao log de eventos, ao cursor ou ao estado. O relatório devolve só números agregados.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from '../store/atomicWrite.mjs';
import { appendEvents, readEvents } from '../store/events.mjs';
import { projectEvents } from '../store/project.mjs';
import { localDay } from '../store/schema.mjs';
import { loadAgent } from '../llm/agents.mjs';
import { classificarAmbiguos } from './classify.mjs';
import { confirmarCursor, avisoDeLimite, filtrarNovos, lerCursor } from './cursor.mjs';
import { buildQuery } from './query.mjs';
import { lerFaseA, lerFaseB, escreverSettingsLeitor, montarArgsLeitor } from './reader.mjs';
import { processarItens } from './process.mjs';
import { planejarLimiteFaseB, resumirRodadas } from './tokens.mjs';

export const INSTRUCAO_CONECTOR = 'Ative o conector Gmail no claude.ai (Configurações, Conectores, Gmail), confirme que a conta é a mesma do Claude Code e rode /email de novo. Nenhuma outra via de leitura é tentada.';
const PADRAO_CONECTOR = /conector|connector|\bmcp\b|gmail|authenticat|autoriza|not connected|no such tool|unknown tool|permission/i;

const estadoArquivo = dataRoot => path.join(dataRoot, 'state', 'mail-sync.json');

export async function lerEstado(dataRoot) {
  try { return JSON.parse(await readFile(estadoArquivo(dataRoot), 'utf8')); } catch { return null; }
}

// Linha para o digest diário quando a leitura de e-mail está ligada e hoje não houve conferência concluída.
export async function avisoEmailNaoConferido(dataRoot, { ativo, now = new Date() }) {
  if (!ativo) return null;
  const estado = await lerEstado(dataRoot);
  return estado?.ok === true && estado.dia === localDay(now) ? null : 'E-mail não conferido hoje.';
}

const contar = (lista, chave) => lista.reduce((acc, item) => ({ ...acc, [item[chave]]: (acc[item[chave]] ?? 0) + 1 }), {});

export async function sincronizarEmail({ dataRoot, ledgerRoot = dataRoot, settings, runner, now = new Date(), dryRun = false, salvarEm, claudeSettingsDir, cacheDir }) {
  const mail = settings.mail;
  const rodada = `mail-${now.toISOString()}`;
  const dia = localDay(now);
  const falhar = async (erro, etapa) => {
    const texto = String(erro?.message ?? erro).slice(0, 300);
    const conector = etapa === 'busca' && PADRAO_CONECTOR.test(texto);
    if (!dryRun) await atomicJson(estadoArquivo(dataRoot), { dia, ok: false, etapa, erro: texto, em: now.toISOString() });
    return { ok: false, dry_run: dryRun, falha: { etapa, erro: texto, ...(conector ? { codigo: 'conector_indisponivel', instrucao: INSTRUCAO_CONECTOR } : {}) }, rodada };
  };

  let argsA;
  let argsB;
  if (runner.modo === 'live') {
    const agente = await loadAgent('leitor-email');
    const settingsFile = await escreverSettingsLeitor({ dir: claudeSettingsDir ?? path.join(ledgerRoot, 'state') });
    argsA = montarArgsLeitor({ fase: 'A', modelo: agente.modelo, sistema: agente.sistema, settingsFile });
    argsB = montarArgsLeitor({ fase: 'B', modelo: agente.modelo, sistema: agente.sistema, settingsFile });
  }
  const guardar = async (nome, valor) => { if (salvarEm) { await mkdir(salvarEm, { recursive: true }); await writeFile(path.join(salvarEm, nome), `${JSON.stringify(valor, null, 2)}\n`); } };

  const cursor = await lerCursor(dataRoot, { now });
  const consulta = buildQuery({ mail, cursor, now });
  const avisos = [...consulta.avisos];
  let a;
  try { a = await lerFaseA({ runner, consulta, now, rodada, argsLive: argsA }); } catch (erro) { return falhar(erro, 'busca'); }
  await guardar(`${rodada.replace(/[:.]/g, '-')}-digest.json`, a.digest);
  avisos.push(...a.avisos);
  const aviso = avisoDeLimite({ itens: a.digest.itens.length, limite: consulta.limite });
  if (aviso) avisos.push(aviso);
  const { novos, repetidos } = filtrarNovos(a.digest.itens, cursor.vistos);

  const { eventos: historico } = await readEvents(dataRoot);
  const vagas = projectEvents(historico).vagas;
  const rodadasAnteriores = resumirRodadas((await readEvents(ledgerRoot)).eventos).rodadas.filter(r => r.rodada !== rodada);
  const plano = planejarLimiteFaseB({ limite: mail.limite_fase_b, orcamento: mail.orcamento_tokens, ultimaRodada: rodadasAnteriores.at(-1) });
  avisos.push(...plano.avisos);

  let r;
  try {
    r = await processarItens({ itens: novos, vagas, config: mail, now,
      abrir: async ids => { const b = await lerFaseB({ runner, ids, limite: plano.limite, rodada, argsLive: argsB }); await guardar(`${rodada.replace(/[:.]/g, '-')}-abertura.json`, b.itens); return b; },
      classificarLlm: async lote => (await classificarAmbiguos({ runner, cacheDir: cacheDir ?? path.join(dryRun ? ledgerRoot : dataRoot, 'cache'), itens: lote, rodada })).resultados });
  } catch (erro) { return falhar(erro, 'processamento'); }

  if (!dryRun) {
    await appendEvents(dataRoot, r.eventos, { now: now.toISOString() });
    await confirmarCursor(dataRoot, { itens: a.digest.itens, now });
    await atomicJson(estadoArquivo(dataRoot), { dia, ok: true, em: now.toISOString(), novos: novos.length });
  }
  const tokens = resumirRodadas((await readEvents(ledgerRoot)).eventos).rodadas.find(x => x.rodada === rodada) ?? null;
  return {
    ok: true, dry_run: dryRun, rodada, consulta: { janela_apos: consulta.after, limite: consulta.limite, cursor_usado: consulta.cursor_usado },
    itens: a.digest.itens.length, rejeitados: a.rejeitados.length, novos: novos.length, repetidos,
    por_classe: contar(r.classificados, 'classe'), por_origem: r.por_origem, por_regra: r.por_regra, precisa_abrir: r.precisa_abrir, abertos: r.abertos.length, adiados: r.adiados.length, enviados_ao_classificador: r.enviados_ao_llm,
    efeitos: r.resumo, eventos_por_tipo: contar(r.eventos.map(e => ({ tipo: e.tipo })), 'tipo'), avisos, limite_fase_b: plano.limite, tokens,
  };
}
