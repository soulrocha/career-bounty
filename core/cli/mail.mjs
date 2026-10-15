// Subcomandos de `mail`: leitura de e-mail pelo conector Gmail (somente leitura) e reconciliação com o tracker.
import { readFile } from 'node:fs/promises';
import { loadSettings } from '../config.mjs';
import { itensDoCorpus, LIMIARES, replayItens } from '../mail/replay.mjs';
import { lerCursor } from '../mail/cursor.mjs';
import { buildQuery } from '../mail/query.mjs';

// Relógio simulado só com --teste (mesma regra do collect e do daily-run).
function agora(values) {
  if (!values['--now']) return new Date();
  if (!values['--teste']) throw new Error('--now só é aceito junto com --teste (relógio simulado, para testes).');
  const now = new Date(values['--now']);
  if (Number.isNaN(now.getTime())) throw new Error('Opção inválida: --now deve ser uma data ISO.');
  return now;
}

export async function mail(rest, { parseFlags }) {
  const [sub, ...flags] = rest;
  if (sub === 'query') {
    const values = parseFlags(flags, { allowed: ['--now', '--teste', '--so-portais', '--janela-dias'], withValue: ['--now', '--janela-dias'] });
    const now = agora(values);
    const settings = await loadSettings();
    const config = { ...settings.mail, ...(values['--so-portais'] ? { so_portais: true } : {}) };
    if (values['--janela-dias'] !== undefined) {
      const dias = Number(values['--janela-dias']);
      if (!Number.isInteger(dias) || dias < 1 || dias > 60) throw new Error('Opção inválida: --janela-dias deve ficar entre 1 e 60.');
      config.janela_dias = dias;
    }
    const cursor = await lerCursor(settings.dataRoot, { now });
    const consulta = buildQuery({ mail: config, cursor, now });
    return { result: consulta, text: `${consulta.query}\n(limite ${consulta.limite}${consulta.avisos.length ? `; avisos: ${consulta.avisos.join('; ')}` : ''})` };
  }
  if (sub === 'replay') {
    const values = parseFlags(flags, { allowed: ['--days', '--corpus', '--labels', '--now', '--teste'], withValue: ['--days', '--corpus', '--labels', '--now'] });
    const now = agora(values);
    if (!values['--corpus'] && !values['--labels']) throw new Error('Informe --corpus sintetico ou --labels <arquivo>.');
    if (values['--corpus'] && values['--corpus'] !== 'sintetico') throw new Error('Opção inválida: --corpus aceita só "sintetico".');
    const dias = values['--days'] !== undefined ? Number(values['--days']) : 30;
    if (!Number.isInteger(dias) || dias < 1 || dias > 365) throw new Error('Opção inválida: --days deve ficar entre 1 e 365.');
    const settings = await loadSettings();
    let itens;
    let vagas;
    if (values['--labels']) {
      const golden = JSON.parse(await readFile(values['--labels'], 'utf8'));
      itens = golden.itens;
      vagas = golden.vagas ?? [];
    } else {
      const { makeCorpus } = await import('../../tests/fixtures/mail/make-corpus.mjs');
      const corpus = makeCorpus();
      itens = itensDoCorpus(corpus);
      vagas = corpus.vagas;
      if (!values['--now']) now.setTime(Date.parse(`${corpus.hoje}T20:00:00-03:00`));
    }
    const result = await replayItens({ itens, vagas, config: settings.mail, now, dias, limiteFaseB: Math.max(settings.mail.limite_fase_b, 50) });
    const linhas = [`concordância: ${result.geral.concordancia === null ? 'n/d' : `${(result.geral.concordancia * 100).toFixed(1)}%`} (${result.geral.acertos}/${result.geral.total}); meta ${LIMIARES.geral * 100}%`,
      ...result.por_regra.map(l => `  ${l.regra}: ${(l.precisao * 100).toFixed(1)}%`), ...result.falhas.map(f => `falha: ${f}`), result.ok ? 'ok' : 'abaixo da meta'];
    return { result, text: linhas.join(String.fromCharCode(10)), exitCode: result.ok ? 0 : 1 };
  }
  throw new Error(`Subcomando mail desconhecido: ${sub ?? ''}`.trim());
}
