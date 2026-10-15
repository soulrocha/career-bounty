import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, mkdir, copyFile, appendFile, open, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hostname } from 'node:os';
import { atomicJson, readEvents, latestSnapshot } from '../store/events.mjs';
import { noLinks, privateDestination } from './paths.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
function validatePipeline(pipeline) {
  if (!pipeline || typeof pipeline !== 'object' || Array.isArray(pipeline) || !Array.isArray(pipeline.vagas)) {
    throw new Error('Pipeline inválido: objeto raiz deve conter vagas como lista.');
  }
  const ids = new Set();
  for (const vaga of pipeline.vagas) {
    if (!vaga || typeof vaga !== 'object' || typeof vaga.id !== 'string' || !vaga.id.trim() || ids.has(vaga.id)) {
      throw new Error('Pipeline inválido: cada vaga exige ID textual não vazio e único.');
    }
    ids.add(vaga.id);
  }
}

export function semanticHash(value) {
  const canonical = item => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])])) : item;
  return hash(JSON.stringify(canonical(value)));
}

async function validatedEvents(dataRoot) {
  const events = await readEvents(dataRoot);
  for (const event of events) {
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

export async function migrateLegacy(options) {
  await privateDestination(options.dataRoot, [options.careerRoot, options.curriculaRoot]);
  const files = await inventory(options);
  await options.afterInventory?.();
  const pipelineBytes = await readFile(path.join(options.careerRoot, 'pipeline-vagas.json'));
  if (hash(pipelineBytes) !== files[0].sha256) {
    throw new Error('Origem alterada durante o inventário; importação interrompida.');
  }
  const pipeline = JSON.parse(pipelineBytes.toString('utf8'));
  validatePipeline(pipeline);
  const report = { files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0), sourceHash: semanticHash(pipeline), snapshotHash: semanticHash(files.map(({ path: relative, size, sha256 }) => ({ path: relative, size, sha256 }))) };
  try {
    const projected = JSON.parse(await readFile(path.join(options.dataRoot, 'projections/pipeline-vagas.json'), 'utf8'));
    report.equal = semanticHash(projected) === report.sourceHash;
  } catch (error) { if (error.code !== 'ENOENT') throw error; report.equal = null; }
  if (options.dryRun) return report;
  const { dataRoot } = options;
  await mkdir(dataRoot, { recursive: true });
  const lockPath = path.join(dataRoot, '.migration.lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Migração bloqueada por outro processo; tente novamente após ele terminar.'); throw error; }
  try {
    const events = await validatedEvents(dataRoot);
    const previous = latestSnapshot(events);
    if (previous?.vagas && (!Array.isArray(pipeline.vagas) || previous.vagas.some(vaga => !pipeline.vagas.some(next => next.id === vaga.id)))) {
      throw new Error('IDs ausentes ou redução de vagas; revisão necessária em modo sombra.');
    }
    const ts = options.now ?? new Date().toISOString();
    const host = options.hostId ?? hostname();
    if (!/^[a-zA-Z0-9_-]+$/.test(host)) throw new Error('Identificador de host inválido.');
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
    const savedManifest = JSON.parse(await readFile(path.join(snapshotPath, 'manifest.json'), 'utf8'));
    if (semanticHash(savedManifest.files) !== semanticHash(manifest)) throw new Error('Manifesto de snapshot divergente.');
    for (const file of manifest) {
      const destination = path.join(snapshotPath, file.path);
      await noLinks(destination);
      if (hash(await readFile(destination)) !== file.sha256) throw new Error('Hash do snapshot divergente.');
    }
    if (semanticHash(await inventory(options)) !== semanticHash(files)) throw new Error('Origem alterada durante a cópia; importação interrompida.');
    const duplicate = events.some(event => event.dados.sourceHash === report.sourceHash);
    if (duplicate && events.at(-1).dados.sourceHash !== report.sourceHash) throw new Error('Snapshot anterior já importado; origem possivelmente desatualizada, revise antes de regredir.');
    if (!duplicate) {
      const event = { id: `legado-${report.sourceHash}`, ts, host, ator: 'migration', tipo: 'legado.importado', entidade: 'pipeline', entidade_id: 'legado', dados: { sourceHash: report.sourceHash, legado: pipeline }, evidencia: { snapshotRoot } };
      const logfile = path.join(dataRoot, 'events', ts.slice(0, 4), ts.slice(5, 7), `${ts.slice(8, 10)}.${host}.jsonl`);
      await noLinks(logfile);
      await mkdir(path.dirname(logfile), { recursive: true });
      await appendFile(logfile, `${JSON.stringify(event)}\n`);
    }
    await atomicJson(path.join(dataRoot, 'projections/pipeline-vagas.json'), pipeline);
    await atomicJson(path.join(dataRoot, 'state/migration.json'), { version: 1, mode: 'shadow', sourceHash: report.sourceHash, importedAt: ts, snapshotRoot, allowedBaseFiles: options.allowedBaseFiles ?? [] });
    return { ...report, snapshotRoot, eventsAdded: duplicate ? 0 : 1 };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

export async function projectLegacy({ dataRoot }) {
  await privateDestination(dataRoot);
  const events = await validatedEvents(dataRoot);
  const pipeline = latestSnapshot(events);
  if (!pipeline) throw new Error('Nenhum snapshot importado no log de eventos.');
  await atomicJson(path.join(dataRoot, 'projections/pipeline-vagas.json'), pipeline);
  return { sourceHash: semanticHash(pipeline), events: events.length };
}

export async function verifyMigration({ dataRoot }) {
  await privateDestination(dataRoot);
  const pipeline = latestSnapshot(await validatedEvents(dataRoot));
  if (!pipeline) throw new Error('Nenhum snapshot importado no log de eventos.');
  const projection = JSON.parse(await readFile(path.join(dataRoot, 'projections/pipeline-vagas.json'), 'utf8'));
  return { equal: semanticHash(pipeline) === semanticHash(projection), sourceHash: semanticHash(pipeline) };
}

export async function exportRollback({ dataRoot, destination, careerRoot, curriculaRoot }) {
  await privateDestination(destination, [careerRoot, curriculaRoot]);
  const pipeline = latestSnapshot(await validatedEvents(dataRoot));
  if (!pipeline) throw new Error('Nenhum snapshot importado no log de eventos.');
  await writeFile(destination, `${JSON.stringify(pipeline, null, 2)}\n`, { flag: 'wx' });
  return { exported: true, sourceHash: semanticHash(pipeline) };
}
