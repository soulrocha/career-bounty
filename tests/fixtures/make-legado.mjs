// Gera pipelines legados sintéticos a partir do inventário de nomes (core/migration/legacySchema.json).
// Todos os valores são inventados; empresas só da lista fictícia, domínios só .test.
import { readFileSync } from 'node:fs';

const schema = JSON.parse(readFileSync(new URL('../../core/migration/legacySchema.json', import.meta.url), 'utf8'));
export const STATUS = JSON.parse(readFileSync(new URL('./status-legado.json', import.meta.url), 'utf8'));
export const EMPRESAS = readFileSync(new URL('./empresas-ficticias.txt', import.meta.url), 'utf8').split(/\r?\n/).filter(Boolean);
const ADERENCIAS = ['alta', 'boa', 'condicional', 'incompativel'];
const BASICOS = ['id', 'empresa', 'cargo', 'url', 'consultado_em', 'modalidade', 'local', 'regime', 'salario', 'status', 'aderencia', 'url_status', 'portal_candidatura', 'curriculo_necessario'];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dateLike = name => /(_em|^data|^prazo|_data|data_|publicada_em|recebido_em|gerado_em)/.test(name) || name === 'prazo';

function leaf(name, types, n, random) {
  const type = types.find(t => t !== 'null') ?? 'null';
  if (type === 'string') {
    if (dateLike(name)) return `2026-10-${String(1 + (n % 14)).padStart(2, '0')}`;
    if (/url/.test(name)) return `https://vagas.exemplo.test/${name}/${n}`;
    return `texto ${name} ${n}`;
  }
  if (type === 'number') return Math.round(random() * 20000);
  if (type === 'boolean') return random() > 0.5;
  if (type === 'array') return [`item ${name} ${n}`];
  if (type === 'object') return {};
  return null;
}

function value(name, spec, n, random) {
  const types = spec.tipos;
  const concrete = types.find(t => t !== 'null') ?? 'null';
  if (spec.filhos && (concrete === 'object' || concrete === 'array')) {
    const object = Object.fromEntries(Object.entries(spec.filhos).map(([child, childTypes]) => [child, leaf(child, childTypes, n, random)]));
    return concrete === 'array' ? [object] : object;
  }
  return leaf(name, types, n, random);
}

// `completo: true` põe todos os campos do inventário em toda vaga.
export function makeVaga(index, { seed = 1, completo = false } = {}) {
  const random = rng(seed * 100003 + index);
  const vaga = {};
  for (const [name, spec] of Object.entries(schema.vaga)) {
    if (!completo && !BASICOS.includes(name) && random() > 0.15) continue;
    vaga[name] = value(name, spec, index, random);
  }
  const empresa = EMPRESAS[index % EMPRESAS.length];
  Object.assign(vaga, {
    id: `${empresa.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${String(index).padStart(10, '0')}`,
    empresa,
    cargo: `Gestor de Tecnologia ${index}`,
    url: `https://vagas.exemplo.test/jobs/${100000 + index}`,
    status: STATUS[index % STATUS.length],
    aderencia: ADERENCIAS[index % ADERENCIAS.length],
    salario: index % 3 === 0 ? null : 9000 + index * 100,
    modalidade: ['remoto', 'hibrido', 'presencial'][index % 3],
    regime: ['CLT', 'PJ'][index % 2],
    portal_candidatura: 'Pendente',
    curriculo_necessario: true,
  });
  return vaga;
}

export function makeEmail(index) {
  const email = {};
  for (const [name, spec] of Object.entries(schema.email)) email[name] = leaf(name, spec.tipos, index, rng(index + 7));
  return { ...email, id: `email-${index}`, empresa: EMPRESAS[index % EMPRESAS.length] };
}

export function makeLegado({ vagas = 5, emails = 2, seed = 1, completo = false } = {}) {
  return {
    schema_version: 1,
    atualizado: '2026-10-14',
    vagas: Array.from({ length: vagas }, (_, i) => makeVaga(i + 1, { seed, completo })),
    eventos_email_sem_requisicao: Array.from({ length: emails }, (_, i) => makeEmail(i + 1)),
  };
}

export const schemaFields = () => Object.keys(schema.vaga);
