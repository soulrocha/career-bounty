import { lstat, readdir, readFile, mkdir, copyFile, writeFile, rm, utimes } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson, readEvents, defaultHost } from '../store/events.mjs';
import { withLock } from '../store/lock.mjs';
import { projectEvents } from '../store/project.mjs';
import { semanticHash, sha256 } from '../store/canonicalize.mjs';
import { validatePipeline, importPipeline } from './import.mjs';
import { semanticDiff } from './diff.mjs';
import { noLinks, privateDestination, within } from './paths.mjs';
import { legacyBusy } from './shadow.mjs';

const hash = sha256;
export { semanticHash };

// Lê o log inteiro e recusa qualquer sinal de corrupção. Comandos que gravam projeção nunca partem de leitura parcial.
export async function strictEvents(dataRoot) {
  const { eventos: events, avisos } = await readEvents(dataRoot);
  if (avisos.length) throw new Error(`Log de eventos truncado ou corrompido (${avisos.length} aviso(s)); revisão necessária.`);
  for (const event of events.filter(item => item.tipo === 'legado.importado')) {
    validatePipeline(event.dados.legado);
    if (semanticHash(event.dados.legado) !== event.dados.sourceHash || event.id !== `legado-${event.dados.sourceHash}`) throw new Error('Evento corrompido: hash do snapshot divergente.');
  }
  return events;
}

async function inventory({ careerRoot, curriculaRoot }) {
  await noLinks(careerRoot);
  await noLinks(curriculaRoot);
  const files = [];
  async function visit(source, relative) {
    const stat = await lstat(source);
    if (stat.isSymbolicLink()) throw new Error('Link simbólico ou junction não permitido na origem.');
    if (stat.isDirectory()) {
      for (const name of (await readdir(source)).sort()) await visit(path.join(source, name), `${relative}/${name}`);
    } else if (stat.isFile()) {
      const bytes = await readFile(source);
      files.push({ source, path: relative, size: bytes.length, sha256: hash(bytes) });
    } else throw new Error('Tipo de arquivo não permitido na origem.');
  }
  await visit(path.join(careerRoot, 'pipeline-vagas.json'), 'carreira/pipeline-vagas.json');
  await visit(path.join(careerRoot, 'busca-vagas'), 'carreira/busca-vagas');
  await visit(curriculaRoot, 'curriculos');
  return files;
}

// Estado da migração (state/migration.json). Ausente = nunca migrou; ilegível = falha fechada.
export async function readMigrationState(dataRoot) {
  let text;
  try { text = await readFile(path.join(dataRoot, 'state/migration.json'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try {
    const state = JSON.parse(text);
    if (state && typeof state === 'object' && !Array.isArray(state)) return state;
  } catch { /* cai no erro abaixo */ }
  throw new Error('Estado de migração ilegível; revise state/migration.json antes de reimportar.');
}

// Depois do corte o painel grava marcações como evento; reimportar o legado as apagaria e devolveria o modo para sombra.
async function recusarSeAtivo(dataRoot) {
  const state = await readMigrationState(dataRoot);
  if (state?.mode === 'ativo') throw new Error('Modo ativo: reimportar do legado apagaria as marcações feitas no painel. Faça o rollback (migrate --rollback) antes de voltar à sombra.');
  if (state && state.mode !== 'shadow') throw new Error('Estado de migração inválido: modo desconhecido.');
}

const BACKUP_PADRAO = 3;
const UM_DIA = 24 * 60 * 60 * 1000;

// Mantém só os N snapshots mais recentes (pela data do manifesto, que a reutilização renova). O snapshot do
// estado atual nunca é apagado; pasta sem manifesto (cópia interrompida) só sai depois de um dia.
async function podarBackups(dataRoot, manter, protegidos) {
  const base = path.join(dataRoot, 'backups');
  let nomes;
  try { nomes = await readdir(base); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const completos = [];
  const removidos = [];
  for (const nome of nomes) {
    if (!/^[\w-][\w.-]*$/.test(nome)) continue;
    const dir = path.join(base, nome);
    const info = await lstat(dir);
    if (info.isSymbolicLink() || !info.isDirectory()) continue;
    const manifesto = await lstat(path.join(dir, 'manifest.json')).catch(() => null);
    if (manifesto) completos.push({ nome, dir, quando: manifesto.mtimeMs });
    else if (!protegidos.has(nome) && Date.now() - info.mtimeMs > UM_DIA) { await rm(dir, { recursive: true, force: true }); removidos.push(nome); }
  }
  completos.sort((a, b) => b.quando - a.quando || b.nome.localeCompare(a.nome));
  const manterNomes = new Set(completos.slice(0, manter).map(item => item.nome));
  for (const item of completos) {
    if (manterNomes.has(item.nome) || protegidos.has(item.nome)) continue;
    await rm(item.dir, { recursive: true, force: true });
    removidos.push(item.nome);
  }
  return removidos;
}

export async function migrateLegacy(options) {
  await privateDestination(options.dataRoot, [options.careerRoot, options.curriculaRoot]);
  const busy = options.legacyBusy ?? (path => legacyBusy(path));
  if (await busy(path.join(options.careerRoot, 'pipeline-vagas.json'))) throw new Error('Legado em uso por outro processo; tente novamente após ele terminar.');
  const files = await inventory(options);
  await options.afterInventory?.();
  const pipelineBytes = await readFile(path.join(options.careerRoot, 'pipeline-vagas.json'));
  if (hash(pipelineBytes) !== files[0].sha256) {
    throw new Error('Origem alterada durante o inventário; importação interrompida.');
  }
  const pipeline = JSON.parse(pipelineBytes.toString('utf8'));
  validatePipeline(pipeline);
  const { dataRoot } = options;
  const report = { files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0), sourceHash: semanticHash(pipeline), snapshotHash: semanticHash(files.map(({ path: relative, size, sha256 }) => ({ path: relative, size, sha256 }))) };
  // Vaga que sumiu do legado nunca é apagada da projeção; a opção só aceita a diferença (e a lista no relatório).
  const aceitar = Boolean(options.aceitarAusentes);
  const idsLegado = new Set(pipeline.vagas.map(vaga => vaga.id));
  const semAusentes = projecao => aceitar ? { ...projecao, vagas: projecao.vagas.filter(vaga => idsLegado.has(vaga.id)) } : projecao;
  const onAusentes = aceitar ? 'ignorar' : 'erro';
  const existing = await strictEvents(dataRoot);
  if (existing.length) {
    const diff = semanticDiff(pipeline, semAusentes(projectEvents(existing)));
    report.equal = diff.diferencas === 0;
    report.diferencas = diff.diferencas;
    if (options.diff) report.itens = diff.itens;
  } else { report.equal = null; report.diferencas = null; }
  if (options.dryRun) return report;
  await recusarSeAtivo(dataRoot);
  await mkdir(dataRoot, { recursive: true });
  return withLock(path.join(dataRoot, '.migration.lock'), { timeoutMs: 0, busyMessage: 'Migração bloqueada por outro processo; tente novamente após ele terminar.' }, async () => {
    await recusarSeAtivo(dataRoot);
    const events = await strictEvents(dataRoot);
    const ts = options.now ?? new Date().toISOString();
    const host = options.hostId ?? defaultHost();
    if (!/^[a-zA-Z0-9_-]+$/.test(host)) throw new Error('Identificador de host inválido.');
    // Simulação: recusa vaga ausente e origem mais antiga antes de copiar qualquer coisa.
    await importPipeline({ dataRoot, pipeline, ts, host, onAusentes, dryRun: true });
    const previousDate = projectEvents(events).atualizado;
    if (typeof previousDate === 'string' && typeof pipeline.atualizado === 'string' && /^\d{4}-\d{2}-\d{2}/.test(previousDate) && pipeline.atualizado < previousDate) {
      throw new Error('Origem mais antiga que a projeção; revise antes de regredir.');
    }
    const manifest = files.map(({ path: relative, size, sha256 }) => ({ path: relative, size, sha256 }));
    const id = semanticHash(manifest);
    const snapshotRoot = `backups/${id}`;
    const snapshotPath = path.join(dataRoot, snapshotRoot);
    await noLinks(snapshotPath);
    let exists = false;
    try { await lstat(path.join(snapshotPath, 'manifest.json')); exists = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!exists) {
      await mkdir(snapshotPath, { recursive: true });
      for (const file of files) {
        const destination = path.join(snapshotPath, file.path);
        await noLinks(destination);
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(file.source, destination, 1);
        if (hash(await readFile(destination)) !== file.sha256) throw new Error('Cópia divergente do hash da origem.');
      }
      await atomicJson(path.join(snapshotPath, 'manifest.json'), { version: 1, files: manifest });
    }
    if (exists) { const agora = new Date(); await utimes(path.join(snapshotPath, 'manifest.json'), agora, agora); }
    const savedManifest = JSON.parse(await readFile(path.join(snapshotPath, 'manifest.json'), 'utf8'));
    if (semanticHash(savedManifest.files) !== semanticHash(manifest)) throw new Error('Manifesto de snapshot divergente.');
    for (const file of manifest) {
      const destination = path.join(snapshotPath, file.path);
      await noLinks(destination);
      if (hash(await readFile(destination)) !== file.sha256) throw new Error('Hash do snapshot divergente.');
    }
    if (semanticHash(await inventory(options)) !== semanticHash(files)) throw new Error('Origem alterada durante a cópia; importação interrompida.');
    const added = await importPipeline({ dataRoot, pipeline, ts, host, onAusentes });
    const projection = projectEvents(await strictEvents(dataRoot));
    await atomicJson(path.join(dataRoot, 'projections/pipeline-vagas.json'), projection);
    await atomicJson(path.join(dataRoot, 'state/migration.json'), { version: 1, mode: 'shadow', sourceHash: report.sourceHash, importedAt: ts, snapshotRoot, allowedBaseFiles: options.allowedBaseFiles ?? [] });
    const removidos = await podarBackups(dataRoot, options.backupsRetidos ?? BACKUP_PADRAO, new Set([path.basename(snapshotRoot)]));
    const finalDiff = semanticDiff(pipeline, semAusentes(projection));
    const ausentesAceitas = aceitar ? projection.vagas.map(vaga => vaga.id).filter(id => !idsLegado.has(id)) : undefined;
    return { ...report, ...(aceitar ? { ausentes_aceitas: ausentesAceitas } : {}), backupsRemovidos: removidos.length, equal: finalDiff.diferencas === 0, diferencas: finalDiff.diferencas, snapshotRoot, eventsAdded: added.eventsAdded };
  });
}

export async function projectLegacy({ dataRoot }) {
  await privateDestination(dataRoot);
  const events = await strictEvents(dataRoot);
  if (!events.length) throw new Error('Nenhum snapshot importado no log de eventos.');
  const pipeline = projectEvents(events);
  await atomicJson(path.join(dataRoot, 'projections/pipeline-vagas.json'), pipeline);
  return { sourceHash: semanticHash(pipeline), events: events.length, vagas: pipeline.vagas.length };
}

export async function verifyMigration({ dataRoot }) {
  await privateDestination(dataRoot);
  const events = await strictEvents(dataRoot);
  if (!events.length) throw new Error('Nenhum snapshot importado no log de eventos.');
  const pipeline = projectEvents(events);
  const projection = JSON.parse(await readFile(path.join(dataRoot, 'projections/pipeline-vagas.json'), 'utf8'));
  return { equal: semanticHash(pipeline) === semanticHash(projection), sourceHash: semanticHash(pipeline) };
}

// Regrava um pipeline legado equivalente a partir dos eventos. Dentro da origem (o Vault) só com confirmação explícita,
// com cópia do arquivo atual em DATA_ROOT, respeitando o lock do legado e recusando se o legado mudou depois da última importação.
export async function exportRollback({ dataRoot, destination, careerRoot, curriculaRoot, confirmoVault = false, now, legacyBusy: busyProbe }) {
  const inSource = [careerRoot, curriculaRoot].filter(Boolean).some(source => within(destination, source));
  if (inSource && !confirmoVault) throw new Error('Destino dentro da origem do legado; use --confirmo-vault para regravar o legado.');
  if (inSource) await noLinks(destination);
  else await privateDestination(destination, [careerRoot, curriculaRoot]);
  const events = await strictEvents(dataRoot);
  if (!events.length) throw new Error('Nenhum snapshot importado no log de eventos.');
  const pipeline = projectEvents(events);
  let backup;
  if (inSource) {
    const busy = busyProbe ?? (file => legacyBusy(file));
    const emUso = 'Legado em uso por outro processo; tente novamente após ele terminar.';
    if (await busy(destination)) throw new Error(emUso);
    let atual = null;
    try { atual = await readFile(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (atual !== null) {
      await conferirLegadoNaoMaisNovo({ dataRoot, atual, pipeline });
      const quando = (now ?? new Date().toISOString()).replace(/[^0-9A-Za-z]/g, '-');
      backup = path.join(dataRoot, 'rollback-backups', `pipeline-vagas-${quando}.json`);
      await mkdir(path.dirname(backup), { recursive: true });
      await writeFile(backup, atual, { flag: 'wx' });
      if (hash(await readFile(backup)) !== hash(atual)) throw new Error('Cópia do legado divergente; rollback interrompido.');
    }
    // o legado pode ter sido travado durante a cópia
    if (await busy(destination)) throw new Error(emUso);
    await atomicJson(destination, pipeline);
  } else await writeFile(destination, `${JSON.stringify(pipeline, null, 2)}
`, { flag: 'wx' });
  return { exported: true, sourceHash: semanticHash(pipeline), vagas: pipeline.vagas.length, ...(backup ? { backup } : {}) };
}

// O legado em disco ainda é o que a sombra importou por último? Se não, regravá-lo apagaria trabalho mais novo.
async function conferirLegadoNaoMaisNovo({ dataRoot, atual, pipeline }) {
  const state = await readMigrationState(dataRoot);
  let legado;
  try { legado = JSON.parse(atual.toString('utf8')); } catch { throw new Error('Legado atual ilegível; rollback recusado para não sobrescrever o que não foi lido.'); }
  if (typeof state?.sourceHash === 'string' && semanticHash(legado) === state.sourceHash) return;
  const maisNovo = typeof legado?.atualizado === 'string' && typeof pipeline.atualizado === 'string' && legado.atualizado > pipeline.atualizado;
  throw new Error(maisNovo
    ? 'O legado é mais novo que a sombra; importe-o (migrate --shadow) antes do rollback.'
    : 'O legado foi alterado depois da última importação; importe-o (migrate --shadow) antes do rollback.');
}

// Importa um pipeline legado de um arquivo único (sem snapshot de materiais).
export async function importFromFile({ dataRoot, from, now, hostId }) {
  await privateDestination(dataRoot, [path.dirname(from)]);
  await recusarSeAtivo(dataRoot);
  const pipeline = JSON.parse(await readFile(from, 'utf8'));
  validatePipeline(pipeline);
  await mkdir(dataRoot, { recursive: true });
  const added = await importPipeline({ dataRoot, pipeline, ts: now, host: hostId ?? defaultHost() });
  const result = await projectLegacy({ dataRoot });
  await atomicJson(path.join(dataRoot, 'state/migration.json'), { version: 1, mode: 'shadow', sourceHash: semanticHash(pipeline), importedAt: now ?? new Date().toISOString(), snapshotRoot: null, allowedBaseFiles: [] });
  return { eventsAdded: added.eventsAdded, vagas: result.vagas, sourceHash: result.sourceHash };
}

// Instalação nova (quem não tem legado para migrar): grava um pipeline vazio como importação inicial e já deixa o modo ativo,
// para o painel abrir, a projeção existir e a coleta gravar. Idempotente: se a pasta já tem estado de migração, não toca em nada.
export async function iniciarInstalacaoNova({ dataRoot, now = new Date().toISOString(), hostId }) {
  await privateDestination(dataRoot);
  if (await readMigrationState(dataRoot)) return { iniciada: false };
  const pipeline = { schema_version: 1, atualizado: now.slice(0, 10), vagas: [], eventos_email_sem_requisicao: [] };
  await mkdir(dataRoot, { recursive: true });
  await importPipeline({ dataRoot, pipeline, ts: now, host: hostId ?? defaultHost() });
  await projectLegacy({ dataRoot });
  await atomicJson(path.join(dataRoot, 'state/migration.json'), { version: 1, mode: 'ativo', sourceHash: semanticHash(pipeline), importedAt: now, snapshotRoot: null, allowedBaseFiles: [] });
  return { iniciada: true };
}
