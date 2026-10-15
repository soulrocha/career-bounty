// Triagem barata (Haiku) sobre o delta, em lotes de 20, com cache por hash da JD.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from '../store/atomicWrite.mjs';
import { loadAgent } from '../llm/agents.mjs';
import { embrulhar, limparCampoCurto, limparTextoNaoConfiavel } from '../privacy/untrusted.mjs';

export const LOTE = 20;
export const BRIEF_MAX_CHARS = 8000; // ~2 mil tokens (4 caracteres por token)
export const RESUMO_MAX_CHARS = 600;
export const DECISOES = ['descartar', 'talvez', 'avaliar'];

export const chunk = (lista, tamanho) => Array.from({ length: Math.ceil(lista.length / tamanho) }, (_, i) => lista.slice(i * tamanho, (i + 1) * tamanho));

export function validarTriagem(json, idsDoLote) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.resultados)) throw new Error('faltou resultados[]');
  for (const item of json.resultados) {
    if (!item || typeof item !== 'object') throw new Error('item inválido');
    const extras = Object.keys(item).filter(key => !['id', 'decisao', 'motivo'].includes(key));
    if (extras.length) throw new Error(`campo fora do contrato: ${extras[0]}`);
    if (!idsDoLote.has(item.id)) throw new Error(`id fora do lote: ${String(item.id).slice(0, 40)}`);
    if (!DECISOES.includes(item.decisao)) throw new Error(`decisao inválida: ${String(item.decisao).slice(0, 20)}`);
    if (typeof item.motivo !== 'string' || !item.motivo.trim() || item.motivo.length > 400) throw new Error('motivo ausente ou longo demais');
  }
}

const resumoDe = vaga => embrulhar(limparTextoNaoConfiavel(String(vaga.descricao ?? '').replace(/\s+/g, ' ').trim(), { max: RESUMO_MAX_CHARS }).texto);
const linhaDe = ({ id, vaga }) => ({ id, cargo: limparCampoCurto(vaga.cargo), empresa: limparCampoCurto(vaga.empresa), local: limparCampoCurto(vaga.local ?? ''), modalidade: limparCampoCurto(vaga.modalidade ?? '', 40), resumo: resumoDe(vaga) });

async function readCache(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}; throw error; }
}

// vagas: [{ id, vaga }]. Devolve { decisoes: Map(id -> { decisao, motivo }), doCache, chamadas }.
export async function triar({ runner, dataRoot, vagas, brief }) {
  const agente = await loadAgent('triador');
  const briefCortado = String(brief ?? '').slice(0, BRIEF_MAX_CHARS);
  const briefHash = createHash('sha256').update(briefCortado).digest('hex').slice(0, 12);
  const cacheFile = path.join(dataRoot, 'cache', 'triagem.json');
  const cache = await readCache(cacheFile);
  const chave = ({ vaga }) => createHash('sha256').update(`${vaga.descricao_hash}|${agente.versaoPrompt}|${agente.modelo}|${briefHash}`).digest('hex');
  const decisoes = new Map();
  const pendentes = [];
  for (const item of vagas) {
    const guardada = cache[chave(item)];
    if (guardada) decisoes.set(item.id, guardada); else pendentes.push(item);
  }
  const doCache = vagas.length - pendentes.length;
  let chamadas = 0;

  async function enviar(lista) {
    const ids = new Set(lista.map(item => item.id));
    chamadas += 1;
    const { json } = await runner.run({ agente: 'triador', modelo: agente.modelo, versaoPrompt: agente.versaoPrompt, sistema: agente.sistema,
      entrada: { brief: briefCortado, vagas: lista.map(linhaDe) }, validar: saida => validarTriagem(saida, ids) });
    for (const resultado of json.resultados) if (!decisoes.has(resultado.id)) decisoes.set(resultado.id, { decisao: resultado.decisao, motivo: resultado.motivo.trim() });
  }

  for (const lote of chunk(pendentes, LOTE)) {
    await enviar(lote);
    const faltantes = lote.filter(item => !decisoes.has(item.id));
    if (faltantes.length) await enviar(faltantes);
    for (const item of lote) {
      if (!decisoes.has(item.id)) decisoes.set(item.id, { decisao: 'talvez', motivo: 'sem resposta do triador; revisar depois' });
      else cache[chave(item)] = decisoes.get(item.id);
    }
  }
  if (pendentes.length) await atomicJson(cacheFile, cache);
  return { decisoes, doCache, chamadas };
}
