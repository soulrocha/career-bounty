// Redator de CV (Sonnet): escolhe e ordena afirmações por experiência e escreve só o resumo (até 450 caracteres) e a escolha de frases-variante.
// O modelo nunca escreve fato: o texto de cada bullet vem da afirmação (ou de uma variante cadastrada nela).
// O validador determinístico barra ID inexistente, afirmação sem prova, não publicável ou fora do uso de CV, número sem afirmação e variante inventada.
import { fold } from '../dedup/keys.mjs';
import { loadAgent } from '../llm/agents.mjs';
import { embrulhar, limparCampoCurto, limparTextoNaoConfiavel } from '../privacy/untrusted.mjs';
import { verificarTexto } from './facts.mjs';
import { quantidadesPorExtenso } from './extenso.mjs';
import { motivoInelegivel } from './elegibilidade.mjs';
import { DESTAQUES, experienciaDaAfirmacao } from './experiencias.mjs';

export const RESUMO_MAX = 450;
export const ITENS_MAX_PADRAO = 6;
export const PALAVRAS_CHAVE_MAX = 15;
const PALAVRA_MAX = 40;
const DESCRICAO_MAX_CHARS = 12000;

const so = (objeto, permitidos, onde) => {
  const extra = Object.keys(objeto).find(chave => !permitidos.includes(chave));
  if (extra) throw new Error(`campo fora do contrato em ${onde}: ${extra}`);
};
const objeto = (valor, onde) => {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error(`${onde} deve ser um objeto`);
};

// Texto que o bullet vai mostrar: a variante cadastrada, quando escolhida, ou o texto da própria afirmação.
export const textoDoItem = (afirmacao, variante) => variante ?? afirmacao.texto;

// ctx: { todas: Map(id -> afirmação), experiencias, maxItens, afirmacoesDosCards }.
export function validarSelecao(json, ctx) {
  objeto(json, 'a saída');
  so(json, ['resumo', 'palavras_chave', 'experiencias'], 'saída');
  if (typeof json.resumo !== 'string' || !json.resumo.trim()) throw new Error('resumo deve ser texto não vazio');
  if (/[\r\n]/.test(json.resumo)) throw new Error('resumo deve ser um único parágrafo');
  if ([...json.resumo].length > RESUMO_MAX) throw new Error(`resumo excede ${RESUMO_MAX} caracteres (${[...json.resumo].length})`);
  if (!Array.isArray(json.palavras_chave) || json.palavras_chave.length > PALAVRAS_CHAVE_MAX
    || json.palavras_chave.some(p => typeof p !== 'string' || !p.trim() || [...p].length > PALAVRA_MAX)) {
    throw new Error(`palavras_chave deve ser lista de até ${PALAVRAS_CHAVE_MAX} textos curtos`);
  }
  if (!Array.isArray(json.experiencias) || !json.experiencias.length) throw new Error('experiencias deve ser lista não vazia');
  const idsExperiencia = new Set([...ctx.experiencias.map(exp => exp.id), DESTAQUES]);
  const vistasExp = new Set();
  const escolhidas = new Set();
  json.experiencias.forEach((exp, i) => {
    objeto(exp, `experiência ${i + 1}`);
    so(exp, ['id', 'itens'], `experiência ${i + 1}`);
    if (!idsExperiencia.has(exp.id)) throw new Error(`experiência desconhecida: ${String(exp.id).slice(0, 40)}`);
    if (vistasExp.has(exp.id)) throw new Error(`experiência repetida: ${exp.id}`);
    vistasExp.add(exp.id);
    if (!Array.isArray(exp.itens) || !exp.itens.length) throw new Error(`experiência ${exp.id} sem itens (omita a experiência sem bullets)`);
    if (exp.itens.length > ctx.maxItens) throw new Error(`experiência ${exp.id} acima do limite de ${ctx.maxItens} itens`);
    exp.itens.forEach(item => {
      objeto(item, `item de ${exp.id}`);
      so(item, ['afirmacao', 'variante'], `item de ${exp.id}`);
      const afirmacao = ctx.todas.get(item.afirmacao);
      if (!afirmacao) throw new Error(`afirmação inexistente: ${String(item.afirmacao).slice(0, 40)}`);
      const barrada = motivoInelegivel(afirmacao);
      if (barrada) throw new Error(`afirmação ${afirmacao.id} não liberada para CV: ${barrada.motivo}`);
      if (escolhidas.has(afirmacao.id)) throw new Error(`afirmação repetida: ${afirmacao.id}`);
      escolhidas.add(afirmacao.id);
      const dona = experienciaDaAfirmacao(afirmacao, ctx.experiencias) ?? DESTAQUES;
      if (dona !== exp.id) throw new Error(`afirmação ${afirmacao.id} pertence a outra experiência (${dona}), não a ${exp.id}`);
      if (item.variante !== undefined && item.variante !== null && !(afirmacao.variantes ?? []).includes(item.variante)) {
        throw new Error(`variante não cadastrada em ${afirmacao.id}`);
      }
    });
  });
  const ligadas = [...new Set([...escolhidas, ...ctx.afirmacoesDosCards.filter(id => ctx.todas.has(id) && !motivoInelegivel(ctx.todas.get(id)))])];
  const conferencia = verificarTexto({ texto: json.resumo, ligadas, afirmacoes: [...ctx.todas.values()] });
  if (!conferencia.ok) throw new Error(`resumo com fato sem afirmação: ${conferencia.problemas.map(p => p.motivo).join('; ')}`);
  const extenso = quantidadesPorExtenso(json.resumo, ligadas.map(id => ctx.todas.get(id).texto));
  if (extenso.length) throw new Error(`resumo com quantidade por extenso sem afirmação que use a mesma expressão: ${extenso.join(', ')}`);
}

const contem = (texto, termo) => new RegExp(`(^|[^a-z0-9])${fold(termo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(texto);

function refinar(json, ctx) {
  const avisos = [];
  const itens = json.experiencias.flatMap(exp => exp.itens);
  const textos = fold(itens.map(item => textoDoItem(ctx.todas.get(item.afirmacao), item.variante ?? undefined)).join(' \n '));
  const palavras_chave = [];
  for (const palavra of json.palavras_chave) {
    if (contem(textos, palavra)) { if (!palavras_chave.some(p => fold(p) === fold(palavra))) palavras_chave.push(palavra.trim()); }
    else avisos.push(`palavra-chave removida por não aparecer em nenhuma afirmação selecionada: ${palavra}`);
  }
  return {
    selecao: {
      resumo: json.resumo.trim(),
      palavras_chave,
      experiencias: json.experiencias.map(exp => ({ id: exp.id, itens: exp.itens.map(item => ({ afirmacao: item.afirmacao, variante: item.variante ?? null })) })),
    },
    avisos,
  };
}

// vaga: vaga da projeção. afirmacoes: toda a base (a entrada oferece só as liberadas). experiencias: do perfil de CV.
export async function redigirCv({ runner, vaga, afirmacoes, experiencias, maxItens = ITENS_MAX_PADRAO, afirmacoesDosCards = [] }) {
  const agente = await loadAgent('redator-cv');
  const todas = new Map(afirmacoes.map(af => [af.id, af]));
  const liberadas = afirmacoes.filter(af => motivoInelegivel(af) === null);
  const descricao = limparTextoNaoConfiavel(vaga.descricao_completa ?? vaga.descricao ?? '', { max: DESCRICAO_MAX_CHARS });
  const entrada = {
    vaga: {
      id: vaga.id, cargo: limparCampoCurto(vaga.cargo), empresa: limparCampoCurto(vaga.empresa), descricao: embrulhar(descricao.texto),
      requisitos: (vaga.requisitos ?? []).map(r => ({ requisito: limparCampoCurto(r.requisito, 300), tipo: r.tipo, avaliacao: r.avaliacao, afirmacoes: (r.afirmacoes ?? []).filter(id => liberadas.some(af => af.id === id)) })),
    },
    experiencias: experiencias.map(exp => ({ id: exp.id, empresa: exp.empresa, cargo: exp.cargo })),
    afirmacoes: liberadas.map(af => ({ id: af.id, texto: af.texto, experiencia: experienciaDaAfirmacao(af, experiencias) ?? DESTAQUES, periodo: af.periodo, ...(af.variantes?.length ? { variantes: af.variantes } : {}) })),
    limites: { resumo_max_caracteres: RESUMO_MAX, itens_por_experiencia: maxItens, palavras_chave_max: PALAVRAS_CHAVE_MAX },
  };
  const ctx = { todas, experiencias, maxItens, afirmacoesDosCards };
  const { json, uso, hash } = await runner.run({ agente: 'redator-cv', modelo: agente.modelo, versaoPrompt: agente.versaoPrompt, sistema: agente.sistema, entrada, validar: saida => validarSelecao(saida, ctx) });
  const { selecao, avisos } = refinar(json, ctx);
  return { selecao, avisos: [...avisos, ...descricao.avisos], uso, hash, versaoPrompt: agente.versaoPrompt };
}
