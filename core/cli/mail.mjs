// Subcomandos de `mail`: leitura de e-mail pelo conector Gmail (somente leitura) e reconciliação com o tracker.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunner } from '../llm/runner.mjs';
import { loadIdentityValues } from '../privacy/redact.mjs';
import { sincronizarEmail } from '../mail/sync.mjs';
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
  if (sub === 'sync') {
    const values = parseFlags(flags, { allowed: ['--live', '--dry-run', '--salvar-em', '--janela-dias', '--so-portais', '--fase-b', '--now', '--teste'], withValue: ['--salvar-em', '--janela-dias', '--fase-b', '--now'] });
    const now = agora(values);
    if (!values['--live']) throw new Error('mail sync lê o Gmail pelo Claude real (chamada cobrada): passe --live para confirmar.');
    const settings = await loadSettings();
    const mailConfig = { ...settings.mail, ...(values['--so-portais'] ? { so_portais: true } : {}) };
    for (const [flag, chave, max] of [['--janela-dias', 'janela_dias', 60], ['--fase-b', 'limite_fase_b', 50]]) {
      if (values[flag] === undefined) continue;
      const n = Number(values[flag]);
      if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`Opção inválida: ${flag} deve ficar entre 1 e ${max}.`);
      mailConfig[chave] = n;
    }
    const dryRun = Boolean(values['--dry-run']);
    const raiz = fileURLToPath(new URL('../../', import.meta.url));
    const salvarEm = values['--salvar-em'] ? path.resolve(values['--salvar-em']) : null;
    const relativo = salvarEm ? path.relative(raiz, salvarEm) : null;
    if (salvarEm && !relativo.startsWith('..') && !path.isAbsolute(relativo)) throw new Error('--salvar-em não pode apontar para dentro do repositório (o resultado real fica fora do git).');
    if (salvarEm && !dryRun) throw new Error('--salvar-em só vale junto com --dry-run.');
    const ledgerRoot = dryRun ? (salvarEm ? path.join(salvarEm, 'ledger') : await mkdtemp(path.join(tmpdir(), 'cb-mail-'))) : settings.dataRoot;
    try {
      const runner = createRunner({ modo: 'live', dataRoot: ledgerRoot, identity: await loadIdentityValues(), env: { ...process.env, CAREER_BOUNTY_LIVE: '1' }, timeoutMs: 300000, now: () => now });
      const result = await sincronizarEmail({ dataRoot: settings.dataRoot, ledgerRoot, settings: { ...settings, mail: mailConfig }, runner, now, dryRun, salvarEm });
      const texto = result.ok
        ? [`itens: ${result.itens}; novos: ${result.novos}; abertos na fase B: ${result.abertos}; ${dryRun ? 'simulação (nada gravado)' : 'gravado'}`, ...result.avisos].join(String.fromCharCode(10))
        : [`e-mail não conferido: ${result.falha.erro}`, result.falha.instrucao].filter(Boolean).join(String.fromCharCode(10));
      return { result, text: texto, exitCode: result.ok ? 0 : 1 };
    } finally { if (dryRun && !salvarEm) await rm(ledgerRoot, { recursive: true, force: true }); }
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
