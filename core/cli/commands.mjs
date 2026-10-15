import { spawnSync } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSettings } from '../config.mjs';
import { createBudget } from '../sources/budget.mjs';
import { LIMITE_DESTINOS_DIA, montarFila, registrarBloqueio, registrarDestino, reservarDestinos } from '../sources/destino.mjs';
import { localDay } from '../store/schema.mjs';
import { createRunner } from '../llm/runner.mjs';
import { loadIdentityValues } from '../privacy/redact.mjs';
import { createMarkdownFolder } from '../kb/sources/markdownFolder.mjs';
import { loadBrief } from '../kb/brief.mjs';
import { runStage2 } from '../radar/stage2.mjs';
import { dailyRun } from '../schedule/dailyRun.mjs';
import { buildTaskXml } from '../schedule/taskXml.mjs';
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
    const { novas_ids, ...result } = await collect({ settings: await loadSettings(), only, dryRun: Boolean(values['--dry-run']), now });
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
  async 'daily-run'(rest, { parseFlags }) {
    const values = parseFlags(rest, { allowed: ['--dry-run', '--now', '--host'], withValue: ['--now', '--host'] });
    const now = values['--now'] ? new Date(values['--now']) : new Date();
    if (Number.isNaN(now.getTime())) throw new Error('Opção inválida: --now deve ser uma data ISO.');
    const settings = await loadSettings();
    const host = values['--host'] ?? hostname();
    const kbRoot = path.join(settings.dataRoot, 'kb');
    const result = await dailyRun({ dataRoot: settings.dataRoot, config: settings.radar.agenda ?? {}, host, now, dryRun: Boolean(values['--dry-run']),
      estagio1: async () => collect({ settings, now }),
      estagio2: async () => {
        const runner = createRunner({ modo: 'live', dataRoot: settings.dataRoot, identity: await loadIdentityValues(), env: { ...process.env, LIVE: '1' } });
        return runStage2({ dataRoot: settings.dataRoot, runner, afirmacoes: await createMarkdownFolder(kbRoot).claims(), brief: await loadBrief(kbRoot), now });
      } });
    return { result, text: result.dry_run ? `executaria: ${result.executaria} (${result.motivo})` : (result.executou ? 'rodada concluída' : `não rodou: ${result.motivo}`), exitCode: result.falha ? 1 : 0 };
  },
  async schedule(rest, { parseFlags }) {
    const [sub, ...flags] = rest;
    if (!['install', 'uninstall'].includes(sub)) throw new Error(`Subcomando schedule desconhecido: ${sub ?? ''}`.trim());
    const values = parseFlags(flags, { allowed: ['--dry-run', '--confirmo-instalar'] });
    const nome = 'CareerBounty radar diario';
    if (sub === 'install') {
      const xml = buildTaskXml({ node: process.execPath, script: fileURLToPath(new URL('../../bin/career-bounty.mjs', import.meta.url)), nome });
      if (values['--dry-run']) return { result: { instalado: false, nome, xml }, text: xml };
      if (!values['--confirmo-instalar']) throw new Error('A instalação real no Agendador exige --confirmo-instalar (ou use --dry-run para só ver o XML).');
      const arquivo = path.join(tmpdir(), `career-bounty-task-${process.pid}.xml`);
      await writeFile(arquivo, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]));
      const saida = spawnSync('schtasks', ['/Create', '/TN', nome, '/XML', arquivo, '/F'], { encoding: 'utf8' });
      await rm(arquivo, { force: true });
      if (saida.status !== 0) throw new Error(`schtasks falhou: ${(saida.stderr || saida.stdout).trim().slice(0, 200)}`);
      return { result: { instalado: true, nome }, text: `tarefa ${nome} instalada` };
    }
    if (values['--dry-run']) return { result: { removido: false, nome }, text: `removeria a tarefa ${nome}` };
    const saida = spawnSync('schtasks', ['/Delete', '/TN', nome, '/F'], { encoding: 'utf8' });
    if (saida.status !== 0) throw new Error(`schtasks falhou: ${(saida.stderr || saida.stdout).trim().slice(0, 200)}`);
    return { result: { removido: true, nome }, text: `tarefa ${nome} removida` };
  },
  async destinos(rest, { parseFlags }) {
    const [sub, ...flags] = rest;
    const settings = await loadSettings();
    if (sub === 'fila') {
      parseFlags(flags, { allowed: [] });
      const { eventos } = await readEvents(settings.dataRoot);
      const now = new Date();
      const usados = await createBudget({ dataRoot: settings.dataRoot, nome: 'destino', limite: LIMITE_DESTINOS_DIA, now }).state();
      const fila = montarFila(projectEvents(eventos).vagas, { hoje: localDay(now) }).slice(0, Math.max(0, LIMITE_DESTINOS_DIA - usados.usado));
      return { result: { limite: LIMITE_DESTINOS_DIA, usados: usados.usado, fila: fila.map(vaga => ({ id: vaga.id, cargo: vaga.cargo, empresa: vaga.empresa, url: vaga.aparicoes?.[0]?.url ?? vaga.url })) }, text: `${fila.length} vagas na fila` };
    }
    if (sub === 'registrar' || sub === 'bloquear') {
      const values = parseFlags(flags, { allowed: ['--vaga', '--url', '--motivo'], withValue: ['--vaga', '--url', '--motivo'] });
      if (!values['--vaga']) throw new Error('Informe --vaga <id>.');
      const gasto = await reservarDestinos({ dataRoot: settings.dataRoot, quantidade: 1 });
      if (!gasto.concedidas) throw new Error(`Limite diário de ${LIMITE_DESTINOS_DIA} destinos atingido.`);
      if (sub === 'registrar') {
        if (!values['--url']) throw new Error('Informe --url <destino>.');
        const url = new URL(values['--url']);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('O destino deve ser http ou https.');
        await registrarDestino(settings.dataRoot, { vagaId: values['--vaga'], applicationUrl: `${url.origin}${url.pathname}` });
      } else await registrarBloqueio(settings.dataRoot, { vagaId: values['--vaga'], motivo: values['--motivo'] ?? 'humano' });
      return { result: { ok: true }, text: 'ok' };
    }
    throw new Error(`Subcomando destinos desconhecido: ${sub ?? ''}`.trim());
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
