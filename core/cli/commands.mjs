import { loadSettings } from '../config.mjs';
import { runDoctor } from '../doctor/index.mjs';
import { validatePlugin } from '../plugin/validate.mjs';
import { planApply } from '../apply/plan.mjs';
import { ensureSkeleton, resolveDataRoot } from '../store/dataRoot.mjs';
import { formatFindings, scanMessageFile, scanStaged, scanTracked } from '../privacy/scan.mjs';
import { buildDenylist, loadPrivacyContext } from '../privacy/context.mjs';

async function privacy(rest, { parseFlags }) {
  const [sub, ...flags] = rest;
  if (sub === 'build-denylist') {
    parseFlags(flags, { allowed: [] });
    return { result: await buildDenylist() };
  }
  if (sub !== 'scan') throw new Error(`Subcomando privacy desconhecido: ${sub ?? ''}`.trim());
  const values = parseFlags(flags, { allowed: ['--staged', '--all', '--message-file'], withValue: ['--message-file'] });
  const context = await loadPrivacyContext();
  for (const warning of context.warnings) console.error(warning);
  let findings;
  if (values['--message-file']) findings = await scanMessageFile(context, values['--message-file']);
  else if (values['--all']) findings = await scanTracked(context);
  else findings = scanStaged(context);
  if (findings.length) console.error(formatFindings(findings));
  return { result: { ok: findings.length === 0, findings }, exitCode: findings.length ? 1 : 0, text: findings.length ? '' : 'ok' };
}

export const legacyCommandNames = ['migrate', 'project', 'verify', 'panel'];
export const commandNames = () => [...legacyCommandNames, ...Object.keys(commands)];

export const commands = {
  async doctor(rest, { parseFlags }) {
    parseFlags(rest, { allowed: [] });
    const report = await runDoctor();
    const lines = report.checks.map(c => `[${c.status}] ${c.id}: ${c.mensagem}`);
    return { result: report, exitCode: report.ok ? 0 : 1, text: [...lines, report.padroes, report.ok ? 'ok' : 'falha'].join(String.fromCharCode(10)) };
  },
  async setup() {
    const dataRoot = resolveDataRoot();
    const created = await ensureSkeleton(dataRoot);
    return { result: { dataRoot, created, ok: true } };
  },
  privacy,
  async plugin(rest, { parseFlags }) {
    if (rest[0] !== 'validate') throw new Error(`Subcomando plugin desconhecido: ${rest[0] ?? ''}`.trim());
    parseFlags(rest.slice(1), { allowed: [] });
    const result = await validatePlugin(process.cwd());
    return { result, exitCode: result.ok ? 0 : 1, text: result.ok ? 'ok' : result.errors.join('\n') };
  },
  async help() {
    return { result: { commands: commandNames() } };
  },
  async apply(rest, { parseFlags }) {
    if (rest[0] !== 'plan') throw new Error(`Subcomando apply desconhecido: ${rest[0] ?? ''}`.trim());
    parseFlags(rest.slice(1), { allowed: [] });
    return { result: planApply(await loadSettings()) };
  },
};
