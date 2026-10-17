// Rascunho de resposta aberta (F6.10): o redator escreve a partir das afirmações liberadas; o validador barra número e
// quantidade por extenso sem prova. O rascunho nunca vai direto ao formulário: vira sugestão na aba Perguntas.
import { loadAgent } from '../llm/agents.mjs';
import { embrulhar, limparCampoCurto, limparTextoNaoConfiavel } from '../privacy/untrusted.mjs';
import { elegiveis } from '../cv/elegibilidade.mjs';
import { verificarTexto } from '../cv/facts.mjs';
import { quantidadesPorExtenso } from '../cv/extenso.mjs';

export const RASCUNHO_MAX = 1200;

export function validarRascunhos(json, { refs, porId, afirmacoes }) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.rascunhos)) throw new Error('faltou rascunhos[]');
  for (const r of json.rascunhos) {
    const extra = Object.keys(r ?? {}).find(k => !['ref', 'texto', 'afirmacoes'].includes(k));
    if (extra) throw new Error(`campo fora do contrato: ${extra}`);
    if (!refs.has(r.ref)) throw new Error(`ref fora do pedido: ${String(r.ref).slice(0, 20)}`);
    if (typeof r.texto !== 'string' || !r.texto.trim() || [...r.texto].length > RASCUNHO_MAX) throw new Error(`texto vazio ou acima de ${RASCUNHO_MAX} caracteres`);
    if (!Array.isArray(r.afirmacoes) || !r.afirmacoes.length || r.afirmacoes.some(id => !porId.has(id))) throw new Error('cada rascunho liga ao menos uma afirmação liberada');
    const conferencia = verificarTexto({ texto: r.texto, ligadas: r.afirmacoes, afirmacoes });
    if (!conferencia.ok) throw new Error(`fato sem afirmação em ${r.ref}: ${conferencia.problemas.map(p => p.motivo).join('; ')}`);
    const extenso = quantidadesPorExtenso(r.texto, r.afirmacoes.map(id => porId.get(id)));
    if (extenso.length) throw new Error(`quantidade por extenso sem afirmação em ${r.ref}: ${extenso.join(', ')}`);
  }
}

// campos: rascunhos da classificação (ref, label). Devolve { ref: texto } para usar como sugestão.
export async function rascunharRespostas({ runner, campos, vaga, afirmacoes }) {
  if (!campos.length) return {};
  const agente = await loadAgent('redator-respostas');
  const liberadas = elegiveis(afirmacoes);
  const porId = new Map(liberadas.map(af => [af.id, af]));
  const entrada = {
    vaga: { cargo: limparCampoCurto(vaga.cargo), empresa: limparCampoCurto(vaga.empresa), descricao: embrulhar(limparTextoNaoConfiavel(vaga.descricao_completa ?? vaga.descricao ?? '', { max: 6000 }).texto) },
    perguntas: campos.map(c => ({ ref: c.ref, pergunta: embrulhar(limparCampoCurto(c.label, 300)) })),
    afirmacoes: liberadas.map(af => ({ id: af.id, texto: af.texto, empresa: af.empresa ?? null })),
    limite_caracteres: RASCUNHO_MAX,
  };
  const ctx = { refs: new Set(campos.map(c => c.ref)), porId, afirmacoes };
  const { json } = await runner.run({ agente: 'redator-respostas', modelo: agente.modelo, versaoPrompt: agente.versaoPrompt, sistema: agente.sistema, entrada, validar: saida => validarRascunhos(saida, ctx) });
  return Object.fromEntries(json.rascunhos.map(r => [r.ref, r.texto.trim()]));
}
