import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { noLinks, privateDestination, within } from './migration/paths.mjs';
import { resolveDataRoot } from './store/dataRoot.mjs';

const ENVIO_PADROES = ['parar_antes_de_enviar', 'confirmar_lote'];

export function defaultSettings() {
  return {
    vault_root: null,
    backups_retidos: 3,
    portais_extras: {},
    manifesto_kb: null,
    identidade: null,
    ai_memory: { url: null },
    envio: { padrao: 'parar_antes_de_enviar', regras: [] },
    fontes: { linkedin_guest: { ativo: false, aceite_termos: false } },
    panel: { port: 8880, base_files: [], app_name: 'career-bounty' },
    perfil: { nome: '', especialidade: '', regiao: '', aviso: '', pdfs_base: [] },
  };
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = (key, rule) => new Error(`Configuração inválida: ${key} ${rule}.`);

function optionalString(raw, key, { absolute = false } = {}) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' || raw === '') throw invalid(key, 'deve ser texto');
  if (absolute && !path.isAbsolute(raw)) throw invalid(key, 'deve ser caminho absoluto');
  return raw;
}

function section(raw, key) {
  if (raw === undefined) return {};
  if (!isObject(raw)) throw invalid(key, 'deve ser objeto');
  return raw;
}

export function validateSettings(raw) {
  if (!isObject(raw)) throw new Error('Configuração inválida: config.yml deve ser um objeto.');
  const settings = defaultSettings();
  settings.vault_root = optionalString(raw.vault_root, 'vault_root', { absolute: true });
  if (raw.backups_retidos !== undefined) {
    if (!Number.isInteger(raw.backups_retidos) || raw.backups_retidos < 1) throw invalid('backups_retidos', 'deve ser inteiro >= 1');
    settings.backups_retidos = raw.backups_retidos;
  }
  if (raw.portais_extras !== undefined) {
    const extras = raw.portais_extras;
    const hostValido = host => typeof host === 'string' && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(host) && host.includes('.');
    if (!isObject(extras) || Object.entries(extras).some(([label, hosts]) => !label.trim() || !Array.isArray(hosts) || !hosts.length || !hosts.every(hostValido))) {
      throw invalid('portais_extras', 'deve ser objeto { "Rótulo": ["host.exemplo"] } com hosts sem esquema nem caminho');
    }
    settings.portais_extras = extras;
  }
  settings.manifesto_kb = optionalString(raw.manifesto_kb, 'manifesto_kb', { absolute: true });
  settings.identidade = optionalString(raw.identidade, 'identidade', { absolute: true });
  settings.ai_memory.url = optionalString(section(raw.ai_memory, 'ai_memory').url, 'ai_memory.url');

  const envio = section(raw.envio, 'envio');
  if (envio.padrao !== undefined) {
    if (!ENVIO_PADROES.includes(envio.padrao)) throw invalid('envio.padrao', `deve ser um de: ${ENVIO_PADROES.join(', ')}`);
    settings.envio.padrao = envio.padrao;
  }
  if (envio.regras !== undefined) {
    if (!Array.isArray(envio.regras)) throw invalid('envio.regras', 'deve ser lista');
    envio.regras.forEach((regra, index) => {
      const key = `envio.regras[${index}]`;
      if (!isObject(regra)) throw invalid(key, 'deve ser objeto');
      if (String(regra.acao ?? '').trim().toLowerCase() === 'enviar_automatico' && (!Number.isInteger(regra.limite_dia) || regra.limite_dia < 1)) {
        throw invalid(`${key}.limite_dia`, 'é obrigatório (inteiro >= 1) em regra enviar_automatico');
      }
    });
    settings.envio.regras = envio.regras;
  }

  const guest = section(section(raw.fontes, 'fontes').linkedin_guest, 'fontes.linkedin_guest');
  for (const key of ['ativo', 'aceite_termos']) {
    if (guest[key] !== undefined && typeof guest[key] !== 'boolean') throw invalid(`fontes.linkedin_guest.${key}`, 'deve ser booleano');
    if (guest[key] !== undefined) settings.fontes.linkedin_guest[key] = guest[key];
  }
  if (settings.fontes.linkedin_guest.ativo && !settings.fontes.linkedin_guest.aceite_termos) {
    throw invalid('fontes.linkedin_guest.ativo', 'exige aceite_termos: true no mesmo bloco; o coletor guest pode violar os termos de uso do LinkedIn e a responsabilidade é sua');
  }

  const perfil = section(raw.perfil, 'perfil');
  for (const key of ['nome', 'especialidade', 'regiao', 'aviso']) {
    if (perfil[key] !== undefined) {
      if (typeof perfil[key] !== 'string') throw invalid(`perfil.${key}`, 'deve ser texto');
      settings.perfil[key] = perfil[key];
    }
  }
  if (perfil.pdfs_base !== undefined) {
    if (!Array.isArray(perfil.pdfs_base) || perfil.pdfs_base.some(item => !isObject(item) || typeof item.texto !== 'string' || typeof item.href !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(item.href))) {
      throw invalid('perfil.pdfs_base', 'deve ser lista de {texto, href} com href relativo');
    }
    settings.perfil.pdfs_base = perfil.pdfs_base;
  }

  const panel = section(raw.panel, 'panel');
  if (panel.port !== undefined) {
    if (!Number.isInteger(panel.port) || panel.port < 1 || panel.port > 65535) throw invalid('panel.port', 'deve ser porta entre 1 e 65535');
    settings.panel.port = panel.port;
  }
  if (panel.app_name !== undefined) {
    if (typeof panel.app_name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(panel.app_name)) throw invalid('panel.app_name', 'deve ser um nome curto em minúsculas, números e hífen');
    settings.panel.app_name = panel.app_name;
  }
  if (panel.base_files !== undefined) {
    if (!Array.isArray(panel.base_files)) throw new Error('Configuração inválida: panel.base_files deve ser lista.');
    settings.panel.base_files = panel.base_files;
  }
  // O link do currículo base só funciona se o painel o serve: href "curriculos/<arquivo>.pdf" com <arquivo> em panel.base_files.
  for (const item of settings.perfil.pdfs_base) {
    const arquivo = item.href.startsWith('curriculos/') ? item.href.slice('curriculos/'.length) : null;
    if (arquivo === null || !settings.panel.base_files.includes(arquivo)) {
      throw invalid('perfil.pdfs_base', 'cada href deve ser "curriculos/<arquivo>.pdf" com o arquivo listado em panel.base_files');
    }
  }
  return settings;
}

export const activeRules = settings => settings.envio.regras.filter(regra => regra.ativo !== false);

export function describeDefaults(settings) {
  const rules = activeRules(settings);
  const envio = rules.length ? `automático (${rules.length} ${rules.length === 1 ? 'regra ativa' : 'regras ativas'})` : 'manual';
  return `envio: ${envio}; LinkedIn guest: ${settings.fontes.linkedin_guest.ativo ? 'ligado' : 'desligado'}`;
}

async function readRawConfig(dataRoot) {
  const filename = path.join(dataRoot, 'config.yml');
  await noLinks(filename);
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return { missing: true };
    if (error instanceof SyntaxError) throw new Error('config.yml deve conter JSON válido (subconjunto de YAML).');
    throw error;
  }
}

// Configuração geral: padrões seguros + DATA_ROOT/config.yml. Nada vem de variável de ambiente.
export async function loadSettings({ dataRoot, env = process.env, home } = {}) {
  dataRoot = path.resolve(dataRoot ?? resolveDataRoot({ env, ...(home ? { home } : {}) }));
  await privateDestination(dataRoot);
  const raw = await readRawConfig(dataRoot);
  const settings = raw.missing ? defaultSettings() : validateSettings(raw);
  if (settings.vault_root && (within(dataRoot, settings.vault_root) || within(settings.vault_root, dataRoot))) {
    throw new Error('DATA_ROOT não pode sobrepor vault_root.');
  }
  return { dataRoot, ...settings, raw: raw.missing ? {} : raw };
}

// Configuração da migração em sombra: exige os caminhos do sistema de origem.
export async function loadConfig({ dataRoot = resolveDataRoot() } = {}) {
  const settings = await loadSettings({ dataRoot });
  dataRoot = settings.dataRoot;
  const config = settings.raw;
  if (!Object.keys(config).length) throw new Error('Configuração ausente: crie DATA_ROOT/config.yml como JSON válido, com legado_path, legacy_assets e legacy_materials.');
  for (const key of ['legado_path', 'legacy_assets', 'legacy_materials']) {
    if (typeof config?.[key] !== 'string' || !path.isAbsolute(config[key])) throw new Error(`Configuração inválida: ${key} deve ser caminho absoluto.`);
  }
  const careerRoot = path.dirname(config.legado_path);
  if (path.basename(config.legado_path) !== 'pipeline-vagas.json' || path.resolve(config.legacy_assets) !== path.join(careerRoot, 'busca-vagas')) {
    throw new Error('Configuração inválida: legado_path e legacy_assets devem compartilhar a estrutura carreira.');
  }
  await privateDestination(dataRoot, [careerRoot, config.legacy_materials]);
  const port = settings.panel.port;
  const allowedBaseFiles = settings.panel.base_files;
  for (const relative of allowedBaseFiles) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || /[\%]/.test(relative) || relative.split('/').includes('..') || !relative.endsWith('.pdf') || !within(path.join(config.legacy_materials, relative), config.legacy_materials)) {
      throw new Error('Configuração inválida: panel.base_files exige caminhos relativos PDF seguros.');
    }
    await noLinks(path.join(config.legacy_materials, relative));
  }
  return { dataRoot, careerRoot, curriculaRoot: config.legacy_materials, port, allowedBaseFiles, backupsRetidos: settings.backups_retidos };
}
