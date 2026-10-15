#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { loadConfig } from '../core/config.mjs';
import { migrateLegacy, projectLegacy, verifyMigration, exportRollback } from '../core/migration/legacy.mjs';
import { commands as extraCommands } from '../core/cli/commands.mjs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const args = process.argv.slice(2);
const json = args.includes('--json');
const command = args.filter(arg => arg !== '--json');

function parseFlags(rest, { allowed, withValue = [] }) {
  const values = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!allowed.includes(flag) || Object.hasOwn(values, flag)) throw new Error(`Opção inválida: ${flag}`);
    if (withValue.includes(flag)) {
      if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(`Valor ausente: ${flag}`);
      values[flag] = rest[++i];
    } else values[flag] = true;
  }
  return values;
}

function fail(error) {
  if (json) console.log(JSON.stringify({ error }));
  else console.error(error);
  process.exitCode = 2;
}

const legacyCommands = ['migrate', 'project', 'verify', 'panel'];

if (command.length === 1 && command[0] === '--version') {
  console.log(json ? JSON.stringify({ version }) : version);
} else if (legacyCommands.includes(command[0])) {
  try {
    const name = command[0];
    const allowed = name === 'migrate' ? ['--dry-run', '--diff', '--rollback', '--out'] : name === 'panel' ? ['--port'] : [];
    const values = parseFlags(command.slice(1), { allowed, withValue: ['--out', '--port'] });
    if ((values['--rollback'] && !values['--out']) || (values['--out'] && !values['--rollback']) || (values['--rollback'] && (values['--dry-run'] || values['--diff']))) {
      throw new Error('Rollback exige --out e não pode combinar --dry-run/--diff.');
    }
    const config = await loadConfig();
    let result;
    if (name === 'migrate') result = values['--rollback']
      ? await exportRollback({ ...config, destination: values['--out'] })
      : await migrateLegacy({ ...config, dryRun: Boolean(values['--dry-run']) });
    if (name === 'project') result = await projectLegacy(config);
    if (name === 'verify') result = await verifyMigration(config);
    if (name === 'panel') {
      const { startPanel } = await import('../panel/server.mjs');
      const panel = await startPanel({ dataRoot: config.dataRoot, port: values['--port'] ? Number(values['--port']) : config.port });
      result = { url: panel.url, mode: 'shadow' };
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => panel.close());
    }
    console.log(json ? JSON.stringify(result) : JSON.stringify(result, null, 2));
    if (result?.equal === false) process.exitCode = 1;
  } catch (cause) {
    fail(cause.message);
  }
} else if (extraCommands[command[0]]) {
  try {
    const { result, exitCode = 0, text } = await extraCommands[command[0]](command.slice(1), { json, parseFlags });
    console.log(json ? JSON.stringify(result) : (text ?? JSON.stringify(result, null, 2)));
    if (exitCode) process.exitCode = exitCode;
  } catch (cause) {
    fail(cause.message);
  }
} else {
  fail(`Comando desconhecido: ${command.join(' ')}`);
}
