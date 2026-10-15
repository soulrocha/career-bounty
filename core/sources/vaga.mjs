// Contrato `Vaga` (seam S3): o que toda fonte devolve. Campos em português, alinhados ao pipeline legado.
import { createHash } from 'node:crypto';

export const CAMPOS_VAGA = ['fonte', 'portal', 'requisicao_id', 'empresa', 'cargo', 'local', 'modalidade', 'regime',
  'salario_min', 'salario_max', 'url', 'publicado_em', 'descricao', 'descricao_hash'];

const clean = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value);

// Hash do texto da vaga sem sensibilidade a espaços: base do cache e da detecção de mudança.
export function descricaoHash(text) {
  return createHash('sha256').update(String(clean(text ?? '') ?? '')).digest('hex');
}

const textOrNull = value => (typeof value === 'string' && value.trim() ? value.trim() : null);
const numberOrNull = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// Completa os campos opcionais com null e calcula o hash. Não valida.
export function makeVaga(raw) {
  const descricao = typeof raw.descricao === 'string' ? raw.descricao : '';
  return {
    fonte: textOrNull(raw.fonte), portal: textOrNull(raw.portal),
    requisicao_id: raw.requisicao_id === undefined || raw.requisicao_id === null || raw.requisicao_id === '' ? null : String(raw.requisicao_id),
    empresa: textOrNull(raw.empresa) ?? '', cargo: textOrNull(raw.cargo) ?? '',
    local: textOrNull(raw.local), modalidade: textOrNull(raw.modalidade), regime: textOrNull(raw.regime),
    salario_min: numberOrNull(raw.salario_min), salario_max: numberOrNull(raw.salario_max),
    url: textOrNull(raw.url) ?? '', publicado_em: textOrNull(raw.publicado_em), descricao,
    descricao_hash: descricaoHash(descricao),
  };
}

export function validateVaga(vaga) {
  if (!vaga || typeof vaga !== 'object' || Array.isArray(vaga)) throw new Error('Vaga inválida: deve ser um objeto.');
  for (const campo of ['empresa', 'cargo', 'url']) {
    if (typeof vaga[campo] !== 'string' || !vaga[campo].trim()) throw new Error(`Vaga inválida: campo obrigatório ausente (${campo}).`);
  }
  let url;
  try { url = new URL(vaga.url); } catch { throw new Error('Vaga inválida: url não é um endereço válido.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Vaga inválida: url deve ser http ou https.');
  return vaga;
}
