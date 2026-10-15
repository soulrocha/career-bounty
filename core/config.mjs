import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { noLinks, privateDestination, within } from './migration/paths.mjs';

export async function loadConfig({ dataRoot = process.env.DATA_ROOT || path.join(homedir(), '.career-bounty') } = {}) {
  dataRoot = path.resolve(dataRoot);
  await privateDestination(dataRoot);
  const filename = path.join(dataRoot, 'config.yml');
  await noLinks(filename);
  let config;
  try { config = JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('Configuração ausente: crie DATA_ROOT/config.yml como JSON válido, com legado_path, legacy_assets e legacy_materials.');
    if (error instanceof SyntaxError) throw new Error('config.yml deve conter JSON válido (subconjunto de YAML).');
    throw error;
  }
  for (const key of ['legado_path', 'legacy_assets', 'legacy_materials']) {
    if (typeof config?.[key] !== 'string' || !path.isAbsolute(config[key])) throw new Error(`Configuração inválida: ${key} deve ser caminho absoluto.`);
  }
  const careerRoot = path.dirname(config.legado_path);
  if (path.basename(config.legado_path) !== 'pipeline-vagas.json' || path.resolve(config.legacy_assets) !== path.join(careerRoot, 'busca-vagas')) {
    throw new Error('Configuração inválida: legado_path e legacy_assets devem compartilhar a estrutura carreira.');
  }
  await privateDestination(dataRoot, [careerRoot, config.legacy_materials]);
  const port = config.panel?.port ?? 8880;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Configuração inválida: panel.port.');
  const allowedBaseFiles = config.panel?.base_files ?? [];
  if (!Array.isArray(allowedBaseFiles)) throw new Error('Configuração inválida: panel.base_files deve ser lista.');
  for (const relative of allowedBaseFiles) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || /[\\%]/.test(relative) || relative.split('/').includes('..') || !relative.endsWith('.pdf') || !within(path.join(config.legacy_materials, relative), config.legacy_materials)) {
      throw new Error('Configuração inválida: panel.base_files exige caminhos relativos PDF seguros.');
    }
    await noLinks(path.join(config.legacy_materials, relative));
  }
  return { dataRoot, careerRoot, curriculaRoot: config.legacy_materials, port, allowedBaseFiles };
}
