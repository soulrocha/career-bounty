import { loadSettings } from '../config.mjs';
import { runDoctor } from '../doctor/index.mjs';
import { validatePlugin } from '../plugin/validate.mjs';
import { planApply } from '../apply/plan.mjs';
import { ensureSkeleton, resolveDataRoot } from '../store/dataRoot.mjs';
import { formatFindings, scanMessageFile, scanStaged, scanTracked } from '../privacy/scan.mjs';
import { buildDenylist, loadPrivacyContext } from '../privacy/context.mjs';
import { auditTemplateFile } from '../privacy/auditTemplate.mjs';
import { collect } from '../radar/collect.mjs';
import { buildDigest } from '../score/digest.mjs';
import { readEvents } from '../store/events.mjs';
import { projectEvents } from '../store/project.mjs';

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
  async 'audit-template'(rest, { parseFlags }) {
    const [file, ...flags] = rest;
    if (!file || file.startsWith('--')) throw new Error('Uso: audit-template <arquivo>');
    parseFlags(flags, { allowed: [] });
    const report = await auditTemplateFile(file, await loadPrivacyContext());
    const lines = [`verificado: ${report.verificados.join(', ')}`, ...report.avisos.map(aviso => `aviso: ${aviso}`),
      ...report.achados.map(a => `bloqueado: linha ${a.linha}${a.coluna ? `, coluna ${a.coluna}` : ''} (${a.tipo})`), report.ok ? 'ok' : 'falha'];
    return { result: report, exitCode: report.ok ? 0 : 1, text: lines.join(String.fromCharCode(10)) };
  },
  async plugin(rest, { parseFlags }) {
    if (rest[0] !== 'validate') throw new Error(`Subcomando plugin desconhecido: ${rest[0] ?? ''}`.trim());
    parseFlags(rest.slice(1), { allowed: [] });
    const result = await validatePlugin(process.cwd());
    return { result, exitCode: result.ok ? 0 : 1, text: result.ok ? 'ok' : result.errors.join('\n') };
  },
  async collect(rest, { parseFlags }) {
    const values = parseFlags(rest, { allowed: ['--dry-run', '--source', '--now'], withValue: ['--source', '--now'] });
    const now = values['--now'] ? new Date(values['--now']) : new Date();
    if (Number.isNaN(now.getTime())) throw new Error('Opção inválida: --now deve ser uma data ISO.');
    const only = values['--source'] ? values['--source'].split(',').map(id => id.trim()).filter(Boolean) : undefined;
    const result = await collect({ settings: await loadSettings(), only, dryRun: Boolean(values['--dry-run']), now });
    const falhas = result.fontes.filter(fonte => fonte.estado === 'erro').length;
    const linhas = [`coletadas: ${result.coletadas}; novas: ${result.novas}; eventos gravados: ${result.eventos_gravados}`,
      ...result.fontes.map(fonte => `${fonte.id}: ${fonte.estado}${fonte.erro ? ` (${fonte.erro})` : ` (${fonte.vagas})`}`)];
    return { result, text: linhas.join(String.fromCharCode(10)), exitCode: falhas && falhas === result.fontes.length ? 1 : 0 };
  },
  async digest(rest, { parseFlags }) {
    parseFlags(rest, { allowed: [] });
    const settings = await loadSettings();
    const { eventos } = await readEvents(settings.dataRoot);
    const rodadas = eventos.filter(evento => evento.tipo === 'radar.rodada').map(evento => evento.dados);
    if (!rodadas.length) return { result: { vazio: true, texto: 'Nenhuma rodada registrada.' }, text: 'Nenhuma rodada registrada.' };
    const result = buildDigest({ rodada: rodadas.at(-1), projecao: projectEvents(eventos).vagas, historico: rodadas.slice(0, -1) });
    return { result, text: result.texto };
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
