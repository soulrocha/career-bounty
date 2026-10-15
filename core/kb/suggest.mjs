// Sugestão de marcas claim:ID para bullets de CV sem marca (Sonnet, lote único por rodada).
// O resultado é só uma proposta em outbox/marcas: nada altera o CV nem a base.
import { createHash } from 'node:crypto';
import { chaveNumero, numerosDaAfirmacao } from '../cv/numeros.mjs';
import { verificarTexto } from '../cv/facts.mjs';
import { loadAgent } from '../llm/agents.mjs';
import { gravarDependente, lerDependente } from './cache.mjs';
import { gravarProposta } from './outbox.mjs';
import { classificarForaDoCv } from './quadrants.mjs';

export const LOTE_MAX = 80;
const CONFIANCAS = ['alta', 'media', 'baixa'];

const refDe = item => `${item.modelo}:${item.linha}`;

function validarSugestoes(json, { refs, ids }) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('saída deve ser um objeto');
  const extra = Object.keys(json).find(chave => chave !== 'sugestoes');
  if (extra) throw new Error(`campo fora do contrato: ${extra}`);
  if (!Array.isArray(json.sugestoes)) throw new Error('sugestoes deve ser lista');
  const vistos = new Set();
  json.sugestoes.forEach((s, i) => {
    if (!s || typeof s !== 'object') throw new Error(`sugestão ${i + 1} inválida`);
    const outro = Object.keys(s).find(chave => !['ref', 'claim_ids', 'confianca', 'motivo'].includes(chave));
    if (outro) throw new Error(`campo fora do contrato na sugestão ${i + 1}: ${outro}`);
    if (!refs.has(s.ref)) throw new Error(`ref fora do lote: ${String(s.ref).slice(0, 40)}`);
    if (vistos.has(s.ref)) throw new Error(`ref repetida: ${s.ref}`);
    vistos.add(s.ref);
    if (!CONFIANCAS.includes(s.confianca)) throw new Error(`confianca inválida na sugestão ${i + 1}`);
    if (!Array.isArray(s.claim_ids) || s.claim_ids.some(id => !ids.has(id))) throw new Error(`afirmação inexistente na sugestão ${i + 1}`);
    if (typeof s.motivo !== 'string' || s.motivo.length > 300) throw new Error(`motivo inválido na sugestão ${i + 1}`);
  });
}

function relatorio({ propostas, mapear_a_mao, snapshotHash }) {
  const linhas = [`# Sugestões de marcas (snapshot ${snapshotHash})`, '', 'Proposta; nada foi aplicado. Revise e cole a marca no fim do bullet do modelo de CV.', ''];
  linhas.push(`## Propostas (${propostas.length})`, '');
  for (const p of propostas) linhas.push(`- ${p.modelo}, linha ${p.linha} (${p.confianca}): ${p.texto}`, `  ${p.claim_ids.map(id => `<!-- claim:${id} -->`).join(' ')} (${p.motivo})`);
  linhas.push('', `## Mapear à mão (${mapear_a_mao.length})`, '');
  for (const m of mapear_a_mao) linhas.push(`- ${m.modelo}, linha ${m.linha}: ${m.texto}`, `  motivo: ${m.motivo}`);
  return `${linhas.join('\n')}\n`;
}

// itens: ItemCV[] (de extrairItensCv). base: resultado de lerBase. snapshotHash: hash do kb sync.
export async function sugerirMarcas({ runner, dataRoot, base, itens, snapshotHash }) {
  const semMarca = itens.filter(item => item.sem_marca).slice(0, LOTE_MAX);
  if (!semMarca.length) return { propostas: [], mapear_a_mao: [], do_cache: false, arquivo: null };

  const publicaveis = base.claims.filter(af => af.publicavel !== 'nao');
  const { b } = classificarForaDoCv({ afirmacoes: base.claims, itens, historias: [], arcos: [], cvCarregado: true });
  const prioridade = b.filter(x => x.tipo === 'afirmacao').map(x => x.id);
  const chaves = new Map(publicaveis.map(af => [af.id, new Set(numerosDaAfirmacao(af).map(chaveNumero))]));
  const entrada = {
    itens: semMarca.map(item => ({ ref: refDe(item), texto: item.texto,
      candidatas_por_numero: publicaveis.filter(af => item.numeros.some(n => chaves.get(af.id).has(chaveNumero(n)))).map(af => af.id) })),
    afirmacoes: publicaveis.map(af => ({ id: af.id, texto: af.texto, nivel_prova: af.nivel_prova, numeros: af.numeros })),
    prioridade,
  };
  const chaveCache = createHash('sha256').update(JSON.stringify(entrada)).digest('hex').slice(0, 16);
  const guardado = await lerDependente(dataRoot, 'sugestao-marcas', snapshotHash);
  if (guardado?.chave === chaveCache) return { ...guardado.resultado, do_cache: true };

  const agente = await loadAgent('mapeador');
  const refs = new Set(entrada.itens.map(i => i.ref));
  const ids = new Set(publicaveis.map(af => af.id));
  const { json } = await runner.run({ agente: 'mapeador', modelo: agente.modelo, versaoPrompt: agente.versaoPrompt, sistema: agente.sistema, entrada,
    validar: saida => validarSugestoes(saida, { refs, ids }) });

  const propostas = [];
  const mapear_a_mao = [];
  for (const item of semMarca) {
    const s = json.sugestoes.find(x => x.ref === refDe(item));
    const ref = { modelo: item.modelo, linha: item.linha, texto: item.texto };
    if (!s || s.claim_ids.length === 0 || s.confianca === 'baixa') { mapear_a_mao.push({ ...ref, motivo: s?.motivo ?? 'sem sugestão do modelo' }); continue; }
    const conferencia = verificarTexto({ texto: item.texto, ligadas: s.claim_ids, afirmacoes: base.claims });
    if (!conferencia.ok) { mapear_a_mao.push({ ...ref, motivo: `sugestão ${s.claim_ids.join(', ')} não confere: ${conferencia.problemas.map(p => p.motivo).join('; ')}` }); continue; }
    propostas.push({ ...ref, claim_ids: s.claim_ids, confianca: s.confianca, motivo: s.motivo });
  }
  const arquivo = await gravarProposta(dataRoot, 'marcas', `sugestoes-${snapshotHash}.md`, relatorio({ propostas, mapear_a_mao, snapshotHash }));
  const resultado = { propostas, mapear_a_mao, arquivo, do_cache: false };
  await gravarDependente(dataRoot, 'sugestao-marcas', snapshotHash, { chave: chaveCache, resultado });
  return resultado;
}
