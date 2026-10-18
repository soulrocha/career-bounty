#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildInventory } from '../core/migration/inventory.mjs';
import { loadConfig, loadSettings } from '../core/config.mjs';
import { runShadow } from '../core/migration/shadow.mjs';
import { migrateLegacy, projectLegacy, verifyMigration, exportRollback, importFromFile } from '../core/migration/legacy.mjs';
import { commands as extraCommands, legacyCommandNames } from '../core/cli/commands.mjs';

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

const legacyCommands = legacyCommandNames;

if (command.length === 1 && command[0] === '--version') {
  console.log(json ? JSON.stringify({ version }) : version);
} else if (legacyCommands.includes(command[0])) {
  try {
    const name = command[0];
    const allowed = name === 'migrate' ? ['--dry-run', '--diff', '--rollback', '--out', '--from', '--inventory', '--shadow', '--confirmo-vault', '--aceitar-ausentes', '--corte', '--confirmar-corte'] : name === 'panel' ? ['--port'] : [];
    const values = parseFlags(command.slice(1), { allowed, withValue: ['--out', '--port', '--from'] });
    if ((values['--shadow'] && (values['--dry-run'] || values['--rollback'] || values['--from'])) || (values['--confirmo-vault'] && !values['--rollback'])) {
      throw new Error('--shadow não combina com --dry-run/--rollback/--from, e --confirmo-vault só vale com --rollback.');
    }
    if ((values['--rollback'] && !values['--out']) || (values['--out'] && !values['--rollback'] && !values['--inventory']) || (values['--rollback'] && (values['--dry-run'] || values['--diff']))) {
      throw new Error('Rollback exige --out e não pode combinar --dry-run/--diff.');
    }
    if (values['--aceitar-ausentes'] && (values['--rollback'] || values['--from'] || values['--inventory'])) throw new Error('--aceitar-ausentes só vale ao importar do legado (migrate, --shadow ou --dry-run).');
    const useConfig = name === 'migrate' && !values['--from'];
    const config = useConfig ? await loadConfig() : null;
    const settings = useConfig ? null : await loadSettings();
    let result;
    if (name === 'migrate' && values['--inventory']) {
      const pipeline = JSON.parse(await readFile(path.join(config.careerRoot, 'pipeline-vagas.json'), 'utf8'));
      result = buildInventory(pipeline);
      if (values['--out']) { await writeFile(values['--out'], `${JSON.stringify(result, null, 2)}${String.fromCharCode(10)}`, { flag: 'wx' }); result = { inventario: values['--out'], campos: Object.keys(result.vaga).length }; }
    } else if (name === 'migrate' && values['--from']) result = await importFromFile({ dataRoot: settings.dataRoot, from: values['--from'] });
    else if (name === 'migrate' && values['--corte']) {
      const { cutoverMigration } = await import('../core/migration/cutover.mjs');
      result = await cutoverMigration({ dataRoot: config.dataRoot, careerRoot: config.careerRoot, confirmo: Boolean(values['--confirmar-corte']) });
    } else if (name === 'migrate') result = values['--rollback']
      ? await exportRollback({ ...config, destination: values['--out'], confirmoVault: Boolean(values['--confirmo-vault']) })
      : values['--shadow'] ? await runShadow({ ...config, aceitarAusentes: Boolean(values['--aceitar-ausentes']) })
      : await migrateLegacy({ ...config, dryRun: Boolean(values['--dry-run']), diff: Boolean(values['--diff']), aceitarAusentes: Boolean(values['--aceitar-ausentes']) });
    if (name === 'project') result = await projectLegacy(settings);
    if (name === 'verify') result = await verifyMigration(settings);
    if (name === 'panel') {
      const { startPanel } = await import('../panel/server.mjs');
      const panel = await startPanel({ dataRoot: settings.dataRoot, port: values['--port'] !== undefined ? Number(values['--port']) : settings.panel.port, appName: settings.panel.app_name, perfil: settings.perfil });
      result = { url: panel.url, mode: panel.mode };
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
