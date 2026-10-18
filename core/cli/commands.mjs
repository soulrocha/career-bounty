import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSettings } from '../config.mjs';
import { createBudget } from '../sources/budget.mjs';
import { LIMITE_DESTINOS_DIA, montarFila, registrarBloqueio, registrarDestino, reservarDestinos } from '../sources/destino.mjs';
import { localDay } from '../store/schema.mjs';
import { createRunner } from '../llm/runner.mjs';
import { avaliarGolden, MINIMO_PADRAO } from '../eval/radar.mjs';
import { loadIdentityValues } from '../privacy/redact.mjs';
import { createMarkdownFolder } from '../kb/sources/markdownFolder.mjs';
import { loadBrief } from '../kb/brief.mjs';
import { runStage2 } from '../radar/stage2.mjs';
import { dailyRun } from '../schedule/dailyRun.mjs';
import { buildTaskXml } from '../schedule/taskXml.mjs';
import { runDoctor } from '../doctor/index.mjs';
import { validatePlugin } from '../plugin/validate.mjs';
import { aplicarCommands } from './aplicar.mjs';
import { gupyCommands } from './gupy.mjs';
import { ensureSkeleton, resolveDataRoot } from '../store/dataRoot.mjs';
import { iniciarInstalacaoNova } from '../migration/legacy.mjs';
import { formatFindings, scanMessageFile, scanStaged, scanTracked } from '../privacy/scan.mjs';
import { buildDenylist, loadPrivacyContext } from '../privacy/context.mjs';
import { auditTemplateFile } from '../privacy/auditTemplate.mjs';
import { collect } from '../radar/collect.mjs';
import { compararRadar } from '../radar/compare.mjs';
import { buildDigest } from '../score/digest.mjs';
import { readEvents } from '../store/events.mjs';
import { projectEvents } from '../store/project.mjs';
import { mail } from './mail.mjs';
import { report } from './report.mjs';
import { avisoEmailNaoConferido, sincronizarEmail } from '../mail/sync.mjs';
import { entrevistaCommands } from './entrevista.mjs';
import { kbCommands } from './kb.mjs';
import { cvCommands } from './cv.mjs';
import { mentorCommands } from './mentor.mjs';
import { vaultCommands } from './vault.mjs';
import { envioCommands } from './envio.mjs';
import { preferenciasCommands } from './preferencias.mjs';
import { demoCommands } from './demo.mjs';
import { contatoCommands } from './contato.mjs';
import { relogio } from './relogio.mjs';
export { relogio } from './relogio.mjs';

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
  ...kbCommands,
  ...cvCommands,
  ...aplicarCommands,
  ...gupyCommands,
  ...entrevistaCommands,
  ...mentorCommands,
  ...vaultCommands,
  ...envioCommands,
  ...preferenciasCommands,
  ...demoCommands,
  ...contatoCommands,
  async doctor(rest, { parseFlags }) {
    parseFlags(rest, { allowed: [] });
    const report = await runDoctor();
    const lines = report.checks.map(c => `[${c.status}] ${c.id}: ${c.mensagem}`);
    return { result: report, exitCode: report.ok ? 0 : 1, text: [...lines, report.padroes, report.ok ? 'ok' : 'falha'].join(String.fromCharCode(10)) };
  },
  async setup(rest, { parseFlags }) {
    const values = parseFlags(rest, { allowed: ['--com-legado'] });
    const dataRoot = resolveDataRoot();
    const created = await ensureSkeleton(dataRoot);
    // Instalação nova já nasce em modo ativo (painel e coleta funcionando). Quem vai migrar o legado usa --com-legado.
    const { iniciada } = values['--com-legado'] ? { iniciada: false } : await iniciarInstalacaoNova({ dataRoot });
    return { result: { dataRoot, created, instalacao_nova: iniciada, ok: true } };
  },
  privacy,
  mail,
  report,
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
    const values = parseFlags(rest, { allowed: ['--dry-run', '--source', '--now', '--teste'], withValue: ['--source', '--now'] });
    const now = relogio(values);
    const only = values['--source'] ? values['--source'].split(',').map(id => id.trim()).filter(Boolean) : undefined;
    const { novas_ids, ...result } = await collect({ settings: await loadSettings(), only, dryRun: Boolean(values['--dry-run']), now });
    const falhas = result.fontes.filter(fonte => fonte.estado === 'erro').length;
    const linhas = [`coletadas: ${result.coletadas}; novas: ${result.novas}; pendentes de conferência: ${result.pendentes_conferencia}; eventos gravados: ${result.eventos_gravados}`,
      ...result.fontes.map(fonte => `${fonte.id}: ${fonte.estado}${fonte.erro ? ` (${fonte.erro})` : ` (${fonte.vagas})`}`)];
    return { result, text: linhas.join(String.fromCharCode(10)), exitCode: falhas && falhas === result.fontes.length ? 1 : 0 };
  },
  async digest(rest, { parseFlags }) {
    parseFlags(rest, { allowed: [] });
    const settings = await loadSettings();
    const { eventos } = await readEvents(settings.dataRoot);
    const rodadas = eventos.filter(evento => evento.tipo === 'radar.rodada').map(evento => evento.dados);
    const aviso = await avisoEmailNaoConferido(settings.dataRoot, { ativo: settings.mail.ativo });
    if (!rodadas.length) return { result: { vazio: true, texto: 'Nenhuma rodada registrada.', ...(aviso ? { email_nao_conferido: true } : {}) }, text: ['Nenhuma rodada registrada.', aviso].filter(Boolean).join(String.fromCharCode(10)) };
    const result = buildDigest({ rodada: rodadas.at(-1), projecao: projectEvents(eventos).vagas, historico: rodadas.slice(0, -1) });
    return { result: aviso ? { ...result, email_nao_conferido: true } : result, text: [result.texto, aviso].filter(Boolean).join(String.fromCharCode(10, 10)) };
  },
  async 'daily-run'(rest, { parseFlags }) {
    const values = parseFlags(rest, { allowed: ['--dry-run', '--now', '--host', '--teste'], withValue: ['--now', '--host'] });
    const now = relogio(values);
    const settings = await loadSettings();
    const host = values['--host'] ?? hostname();
    const kbRoot = path.join(settings.dataRoot, 'kb');
    const result = await dailyRun({ dataRoot: settings.dataRoot, config: settings.radar.agenda ?? {}, host, now, dryRun: Boolean(values['--dry-run']),
      estagio1: async () => collect({ settings, now }),
      estagio2: async () => {
        const runner = createRunner({ modo: 'live', dataRoot: settings.dataRoot, identity: await loadIdentityValues(), env: { ...process.env, CAREER_BOUNTY_LIVE: '1' } });
        return runStage2({ dataRoot: settings.dataRoot, runner, afirmacoes: await createMarkdownFolder(kbRoot).claims(), brief: await loadBrief(kbRoot), now });
      } });
    // E-mail depois do radar: falha aqui nunca derruba a rodada; vira "e-mail não conferido hoje" no digest.
    if (!values['--dry-run'] && result.executou && !result.falha && settings.mail.ativo) {
      try {
        const runner = createRunner({ modo: 'live', dataRoot: settings.dataRoot, identity: await loadIdentityValues(), env: { ...process.env, CAREER_BOUNTY_LIVE: '1' }, timeoutMs: 300000, now: () => now });
        result.email = await sincronizarEmail({ dataRoot: settings.dataRoot, settings, runner, now });
      } catch (error) { result.email = { ok: false, falha: { etapa: 'inicio', erro: String(error.message ?? error).slice(0, 200) } }; }
    }
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
  async 'compare-radar'(rest, { parseFlags }) {
    const values = parseFlags(rest, { allowed: ['--antigo', '--desde'], withValue: ['--antigo', '--desde'] });
    const settings = await loadSettings();
    const arquivo = values['--antigo'] ?? settings.raw.legado_path;
    if (!arquivo) throw new Error('Informe --antigo <pipeline-vagas.json> ou configure legado_path em DATA_ROOT/config.yml.');
    const desde = values['--desde'] ?? localDay(new Date(Date.now() - 7 * 86400000));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) throw new Error('Opção inválida: --desde deve ser AAAA-MM-DD.');
    const antigo = JSON.parse(await readFile(arquivo, 'utf8')).vagas ?? [];
    const { eventos } = await readEvents(settings.dataRoot);
    const result = compararRadar({ antigo, novo: projectEvents(eventos).vagas, desde });
    const linhas = [`desde ${desde}: antigo ${result.contagem.antigo}, novo ${result.contagem.novo}, em ambos ${result.contagem.ambos}`,
      `só no antigo: ${result.contagem.so_antigo} (${result.altas_boas_so_antigo.length} alta/boa a explicar); só no novo: ${result.contagem.so_novo}`];
    return { result, text: linhas.join(String.fromCharCode(10)) };
  },
  async eval(rest, { parseFlags }) {
    if (rest[0] !== 'radar') throw new Error(`Subcomando eval desconhecido: ${rest[0] ?? ''}`.trim());
    const values = parseFlags(rest.slice(1), { allowed: ['--golden', '--live', '--gravar', '--min', '--max-chamadas'], withValue: ['--golden', '--min', '--max-chamadas'] });
    const settings = await loadSettings();
    const raiz = fileURLToPath(new URL('../../', import.meta.url));
    const privado = path.join(settings.dataRoot, 'golden', 'golden-20.json');
    const arquivo = values['--golden'] ?? (await access(privado).then(() => privado, () => path.join(raiz, 'tests', 'golden', 'radar', 'golden-sintetico.json')));
    const golden = JSON.parse(await readFile(arquivo, 'utf8'));
    const real = golden.kb !== 'persona-ficticia';
    const kbRoot = real ? path.join(settings.dataRoot, 'kb') : path.join(raiz, 'examples', 'persona-ficticia');
    const replayDir = real ? path.join(settings.dataRoot, 'golden', 'replay') : path.join(raiz, 'tests', 'replay', 'llm');
    const minimo = values['--min'] !== undefined ? Number(values['--min']) : MINIMO_PADRAO;
    if (!Number.isFinite(minimo) || minimo < 0 || minimo > 1) throw new Error('Opção inválida: --min deve ficar entre 0 e 1.');
    if (!golden.vagas?.some(vaga => ['alta', 'media', 'baixa'].includes(vaga.rotulo_saulo))) {
      return { result: { ok: false, motivo: 'golden sem rótulos', concordancia: null }, text: 'O golden set ainda não tem rótulos (rotulo_saulo: pendente).', exitCode: 3 };
    }
    const ledger = await mkdtemp(path.join(tmpdir(), 'cb-eval-'));
    try {
      const runner = createRunner({ modo: values['--live'] ? 'live' : 'replay', dataRoot: ledger, replayDir, identity: await loadIdentityValues(), env: { ...process.env, CAREER_BOUNTY_LIVE: values['--live'] ? '1' : undefined },
        gravar: Boolean(values['--gravar']), maxChamadasLive: values['--max-chamadas'] ? Number(values['--max-chamadas']) : Infinity });
      const resultado = await avaliarGolden({ golden, runner, dataRoot: ledger, afirmacoes: await createMarkdownFolder(kbRoot).claims(), brief: await loadBrief(kbRoot) });
      const ok = resultado.concordancia !== null && resultado.concordancia >= minimo;
      const linhas = [`concordância: ${resultado.concordancia === null ? 'n/d' : `${(resultado.concordancia * 100).toFixed(1)}%`} (${resultado.acertos}/${resultado.rotuladas}); mínimo ${(minimo * 100).toFixed(0)}%`,
        ...resultado.discordancias.map(item => `- ${item.id}: esperado ${item.esperado}, obtido ${item.obtido} (${item.motivo})`), ok ? 'ok' : 'abaixo do mínimo'];
      return { result: { ok, minimo, ...resultado }, text: linhas.join(String.fromCharCode(10)), exitCode: ok ? 0 : 1 };
    } finally { await rm(ledger, { recursive: true, force: true }); }
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
};
