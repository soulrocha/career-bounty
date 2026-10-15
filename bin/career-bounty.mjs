#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { loadConfig } from '../core/config.mjs';
import { migrateLegacy, projectLegacy, verifyMigration, exportRollback } from '../core/migration/legacy.mjs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const args = process.argv.slice(2);
const json = args.includes('--json');
const command = args.filter(arg => arg !== '--json');

if (command.length === 1 && command[0] === '--version') {
  console.log(json ? JSON.stringify({ version }) : version);
} else if (['migrate', 'project', 'verify', 'panel'].includes(command[0])) {
  try {
    const name = command[0];
    const allowed = name === 'migrate' ? ['--dry-run', '--diff', '--rollback', '--out'] : name === 'panel' ? ['--port'] : [];
    const values = {};
    for (let i = 1; i < command.length; i++) {
      const flag = command[i];
      if (!allowed.includes(flag) || Object.hasOwn(values, flag)) throw new Error(`Opção inválida: ${flag}`);
      if (['--out', '--port'].includes(flag)) {
        if (!command[i + 1] || command[i + 1].startsWith('--')) throw new Error(`Valor ausente: ${flag}`);
        values[flag] = command[++i];
      } else values[flag] = true;
    }
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
    const error = cause.message;
    if (json) console.log(JSON.stringify({ error }));
    else console.error(error);
    process.exitCode = 2;
  }
} else {
  const error = `Comando desconhecido: ${command.join(' ')}`;
  if (json) console.log(JSON.stringify({ error }));
  else console.error(error);
  process.exitCode = 2;
}
