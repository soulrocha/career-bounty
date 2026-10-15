// Contrato do leitor de e-mail (seam S10): MailDigest (fase A) e MailFull (fase B).
// O subagente devolve JSON; aqui ele é validado contra os schemas de `schema/`, que proíbem campo extra.
// Campo extra, JSON truncado ou id fora do pedido rejeitam a resposta inteira e o cursor não avança.
import { readFileSync } from 'node:fs';
import { stripFence } from '../llm/runner.mjs';
import { isoDate } from '../store/rules.mjs';
import { localDay } from '../store/schema.mjs';

export const LIMITES = { trecho: 300, corpo: 1500, assunto: 300 };

export class MailContractError extends Error {
  constructor(codigo, message) {
    super(message);
    this.name = 'MailContractError';
    this.codigo = codigo;
  }
}

const carregar = nome => JSON.parse(readFileSync(new URL(`./schema/${nome}.json`, import.meta.url), 'utf8'));
export const SCHEMA_DIGEST = carregar('mail-digest');
export const SCHEMA_FULL = carregar('mail-full');

const tipoDe = valor => (valor === null ? 'null' : Array.isArray(valor) ? 'array' : typeof valor);

// Validador mínimo do subconjunto de JSON Schema usado em `schema/`.
function validarEstrutura(valor, schema, caminho) {
  const tipos = [schema.type].flat();
  if (!tipos.includes(tipoDe(valor))) throw new MailContractError('schema', `${caminho}: tipo inválido (esperado ${tipos.join('|')})`);
  if (typeof valor === 'string') {
    if (schema.minLength !== undefined && valor.length < schema.minLength) throw new MailContractError('schema', `${caminho}: vazio`);
    if (schema.maxLength !== undefined && valor.length > schema.maxLength) throw new MailContractError('schema', `${caminho}: longo demais`);
  }
  if (tipoDe(valor) === 'object') {
    for (const chave of schema.required ?? []) if (!Object.hasOwn(valor, chave)) throw new MailContractError('schema', `${caminho}: falta ${chave}`);
    for (const chave of Object.keys(valor)) {
      if (!Object.hasOwn(schema.properties ?? {}, chave)) {
        if (schema.additionalProperties === false) throw new MailContractError('campo_extra', `${caminho}: campo fora do contrato (${chave.slice(0, 40)})`);
        continue;
      }
      validarEstrutura(valor[chave], schema.properties[chave], `${caminho}.${chave}`);
    }
  }
  if (Array.isArray(valor) && schema.items) valor.forEach((elemento, i) => validarEstrutura(elemento, schema.items, `${caminho}[${i}]`));
}

// Texto bruto do modelo (com ou sem cerca) para objeto. JSON truncado é erro tipado.
export function lerJson(texto) {
  try { return JSON.parse(stripFence(texto)); }
  catch { throw new MailContractError('json_invalido', 'a saída do leitor não é JSON completo (possível truncamento)'); }
}

const ENDERECO = /[^\s<>"',;()]+@[^\s<>"',;()]+/g;
const DOMINIO = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

// "Nome <a@b.c>" ou "a@b.c" para { nome, domínio }. O endereço nunca é guardado.
export function paraRemetente(bruto) {
  const texto = String(bruto ?? '').trim();
  const enderecos = [...texto.matchAll(ENDERECO)];
  const ultimo = enderecos.at(-1)?.[0];
  const dominio = ultimo ? ultimo.slice(ultimo.lastIndexOf('@') + 1).toLowerCase().replace(/\.$/, '') : '';
  const nome = texto.replace(ENDERECO, '').replace(/[<>"]/g, '').replace(/\s+/g, ' ').trim();
  return { remetente_nome: nome, remetente_dominio: dominio };
}

const limparNome = nome => paraRemetente(nome).remetente_nome;

function diaDe(texto) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ]\S+)?$/.exec(String(texto).trim());
  if (!m) return null;
  if (m[0].length === 10) return isoDate(m[1]);
  const data = new Date(String(texto).trim().replace(' ', 'T'));
  return Number.isNaN(data.getTime()) ? null : localDay(data);
}

function cortar(texto, max, campo, id, avisos) {
  const pontos = [...texto];
  if (pontos.length <= max) return texto;
  avisos.push(`${campo} truncado em ${max} caracteres (${id})`);
  return pontos.slice(0, max).join('');
}

export function validarDigest(bruto, { now = new Date() } = {}) {
  validarEstrutura(bruto, SCHEMA_DIGEST, 'digest');
  if (Number.isNaN(Date.parse(bruto.consultado_em))) throw new MailContractError('schema', 'digest.consultado_em: data inválida');
  const ids = new Set(bruto.itens.map(i => i.message_id));
  for (const id of bruto.precisa_abrir) if (!ids.has(id)) throw new MailContractError('precisa_abrir_invalido', `precisa_abrir cita id que não está nos itens (${id.slice(0, 40)})`);
  const hoje = localDay(now);
  const avisos = [];
  const rejeitados = [];
  const vistos = new Set();
  const itens = [];
  for (const cru of bruto.itens) {
    if (vistos.has(cru.message_id)) { avisos.push(`message_id duplicado ignorado (${cru.message_id})`); continue; }
    vistos.add(cru.message_id);
    const dia = diaDe(cru.data);
    if (!dia) { rejeitados.push({ message_id: cru.message_id, motivo: 'data inválida' }); continue; }
    if (dia > hoje) { rejeitados.push({ message_id: cru.message_id, motivo: 'data futura' }); continue; }
    const origem = cru.remetente !== undefined
      ? paraRemetente(cru.remetente)
      : { remetente_nome: limparNome(cru.remetente_nome), remetente_dominio: String(cru.remetente_dominio ?? '').trim().toLowerCase().replace(/^.*@/, '') };
    if (cru.remetente !== undefined && cru.remetente_nome) origem.remetente_nome = limparNome(cru.remetente_nome);
    if (!DOMINIO.test(origem.remetente_dominio)) { rejeitados.push({ message_id: cru.message_id, motivo: 'remetente sem domínio válido' }); continue; }
    itens.push({ message_id: cru.message_id, data: dia, ...origem, assunto: cortar(cru.assunto, LIMITES.assunto, 'assunto', cru.message_id, avisos), trecho: cortar(cru.trecho, LIMITES.trecho, 'trecho', cru.message_id, avisos) });
  }
  const mantidos = new Set(itens.map(i => i.message_id));
  return { digest: { cursor_usado: bruto.cursor_usado, consultado_em: bruto.consultado_em, itens, precisa_abrir: bruto.precisa_abrir.filter(id => mantidos.has(id)) }, avisos, rejeitados };
}

export function validarFull(bruto, { pedidos }) {
  validarEstrutura(bruto, SCHEMA_FULL, 'full');
  const permitidos = new Set(pedidos);
  const avisos = [];
  const vistos = new Set();
  const itens = [];
  for (const cru of bruto.itens) {
    if (!permitidos.has(cru.message_id)) throw new MailContractError('corpo_nao_pedido', `corpo de mensagem que não foi pedida (${cru.message_id.slice(0, 40)})`);
    if (vistos.has(cru.message_id)) { avisos.push(`corpo duplicado ignorado (${cru.message_id})`); continue; }
    vistos.add(cru.message_id);
    itens.push({ message_id: cru.message_id, corpo: cortar(cru.corpo, LIMITES.corpo, 'corpo', cru.message_id, avisos) });
  }
  return { itens, avisos };
}
