// Proposta de perfil de portal (Gupy primeiro): o portal não recebe CV por vaga, o perfil dele é o documento.
// O modelo propõe texto por campo ligado a afirmações; o validador barra afirmação não liberada ou de outra experiência,
// número sem prova, habilidade que não está nas afirmações e campo acima do limite. Nada é aplicado: a saída é só o diff proposto.
import { fold } from '../dedup/keys.mjs';
import { loadAgent } from '../llm/agents.mjs';
import { embrulhar, limparTextoNaoConfiavel } from '../privacy/untrusted.mjs';
import { motivoInelegivel } from './elegibilidade.mjs';
import { verificarTexto } from './facts.mjs';

// Limites por portal (caracteres por campo de texto, quantidade e tamanho de habilidade). Conferir no portal ao revisar a proposta.
export const LIMITES_PORTAL = {
  gupy: { sobre: 1000, experiencia: 2000, habilidades: 30, habilidade: 40 },
};

const so = (objeto, permitidos, onde) => {
  if (!objeto || typeof objeto !== 'object' || Array.isArray(objeto)) throw new Error(`${onde} deve ser um objeto`);
  const extra = Object.keys(objeto).find(chave => !permitidos.includes(chave));
  if (extra) throw new Error(`campo fora do contrato em ${onde}: ${extra}`);
};
const tamanho = texto => [...texto].length;
const normalizar = texto => String(texto ?? '').replace(/\s+/g, ' ').trim();
const contem = (texto, termo) => new RegExp(`(^|[^a-z0-9])${fold(termo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(fold(texto));

function validarSecao(secao, i, ctx) {
  const onde = `seção ${i + 1}`;
  so(secao, ['campo', 'proposto', 'afirmacoes'], onde);
  const { limites, porId, atual, afirmacoes } = ctx;
  if (!Array.isArray(secao.afirmacoes) || !secao.afirmacoes.length) throw new Error(`${onde} sem afirmação ligada: todo fato precisa de uma`);
  const ligadas = secao.afirmacoes.map(id => {
    const af = porId.get(id);
    if (!af) throw new Error(`${onde}: afirmação inexistente ${String(id).slice(0, 40)}`);
    const barrada = motivoInelegivel(af);
    if (barrada) throw new Error(`${onde}: ${barrada.motivo}`);
    return af;
  });
  if (secao.campo === 'habilidades') {
    if (!Array.isArray(secao.proposto) || secao.proposto.some(h => typeof h !== 'string' || !h.trim())) throw new Error('habilidades deve ser lista de textos');
    if (secao.proposto.length > limites.habilidades) throw new Error(`habilidades acima do limite de ${limites.habilidades}`);
    for (const h of secao.proposto) {
      if (tamanho(h) > limites.habilidade) throw new Error(`habilidade excede ${limites.habilidade} caracteres`);
      if (!ligadas.some(af => contem(af.texto, h))) throw new Error(`habilidade sem afirmação ligada que a mencione: ${h.slice(0, 40)}`);
    }
    return;
  }
  if (typeof secao.proposto !== 'string' || !secao.proposto.trim()) throw new Error(`${onde}: proposto deve ser texto não vazio`);
  let limite;
  if (secao.campo === 'sobre') limite = limites.sobre;
  else if (/^experiencia:/.test(secao.campo)) {
    const exp = atual.experiencias.find(e => `experiencia:${e.id}` === secao.campo);
    if (!exp) throw new Error(`${onde}: experiência desconhecida no perfil do portal`);
    const fora = ligadas.find(af => fold(af.empresa ?? '') !== fold(exp.empresa));
    if (fora) throw new Error(`${onde}: ${fora.id} é de outra experiência, não de ${exp.empresa}`);
    limite = limites.experiencia;
  } else throw new Error(`${onde}: campo desconhecido ${String(secao.campo).slice(0, 40)}`);
  if (tamanho(secao.proposto) > limite) throw new Error(`${secao.campo} excede ${limite} caracteres (${tamanho(secao.proposto)})`);
  const conferencia = verificarTexto({ texto: secao.proposto, ligadas: secao.afirmacoes, afirmacoes });
  if (!conferencia.ok) throw new Error(`${secao.campo} com fato sem afirmação: ${conferencia.problemas.map(p => p.motivo).join('; ')}`);
}

export function validarProposta(json, ctx) {
  so(json, ['secoes'], 'a saída');
  if (!Array.isArray(json.secoes)) throw new Error('secoes deve ser lista');
  const campos = new Set();
  json.secoes.forEach((secao, i) => {
    validarSecao(secao, i, ctx);
    if (campos.has(secao.campo)) throw new Error(`campo repetido: ${secao.campo}`);
    campos.add(secao.campo);
  });
}

const valorAtual = (atual, campo) => {
  if (campo === 'sobre') return atual.sobre ?? '';
  if (campo === 'habilidades') return atual.habilidades ?? [];
  return atual.experiencias.find(e => `experiencia:${e.id}` === campo)?.descricao ?? '';
};
const igual = (a, b) => Array.isArray(a)
  ? Array.isArray(b) && a.length === b.length && a.every((v, i) => fold(normalizar(v)) === fold(normalizar(b[i])))
  : normalizar(a) === normalizar(b);

// perfilAtual: { sobre, experiencias: [{ id, empresa, cargo, descricao }], habilidades }, copiado do portal pela pessoa.
export async function proporPerfilPortal({ runner, portal = 'gupy', perfilAtual, afirmacoes, limites = LIMITES_PORTAL[portal] }) {
  if (!limites) throw new Error(`Portal sem limites cadastrados: ${portal}`);
  const agente = await loadAgent('perfil-portal');
  const porId = new Map(afirmacoes.map(af => [af.id, af]));
  const liberadas = afirmacoes.filter(af => motivoInelegivel(af) === null);
  const curto = (texto, max) => embrulhar(limparTextoNaoConfiavel(texto ?? '', { max }).texto);
  const entrada = {
    portal,
    perfil_atual: {
      sobre: curto(perfilAtual.sobre, limites.sobre * 2),
      experiencias: perfilAtual.experiencias.map(e => ({ id: e.id, empresa: e.empresa, cargo: e.cargo, descricao: curto(e.descricao, limites.experiencia * 2) })),
      habilidades: (perfilAtual.habilidades ?? []).slice(0, limites.habilidades * 2),
    },
    afirmacoes: liberadas.map(af => ({ id: af.id, texto: af.texto, empresa: af.empresa ?? null, periodo: af.periodo ?? null })),
    limites,
  };
  const ctx = { limites, porId, atual: perfilAtual, afirmacoes };
  const { json, uso, hash } = await runner.run({ agente: 'perfil-portal', modelo: agente.modelo, versaoPrompt: agente.versaoPrompt, sistema: agente.sistema, entrada, validar: saida => validarProposta(saida, ctx) });
  const secoes = json.secoes
    .map(secao => ({ campo: secao.campo, atual: valorAtual(perfilAtual, secao.campo), proposto: secao.campo === 'habilidades' ? secao.proposto.map(normalizar) : normalizar(secao.proposto), afirmacoes: secao.afirmacoes }))
    .filter(secao => !igual(secao.atual, secao.proposto));
  return { tipo: 'proposta', portal, secoes, uso, hash, versaoPrompt: agente.versaoPrompt };
}
