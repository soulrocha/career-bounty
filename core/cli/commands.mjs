import { describeDefaults, loadSettings } from '../config.mjs';
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

export const commands = {
  async doctor() {
    const settings = await loadSettings();
    const padroes = describeDefaults(settings);
    return { result: { dataRoot: settings.dataRoot, ok: true, padroes }, text: `${padroes}
ok` };
  },
  async setup() {
    const dataRoot = resolveDataRoot();
    const created = await ensureSkeleton(dataRoot);
    return { result: { dataRoot, created, ok: true } };
  },
  privacy,
  async apply(rest, { parseFlags }) {
    if (rest[0] !== 'plan') throw new Error(`Subcomando apply desconhecido: ${rest[0] ?? ''}`.trim());
    parseFlags(rest.slice(1), { allowed: [] });
    return { result: planApply(await loadSettings()) };
  },
};
