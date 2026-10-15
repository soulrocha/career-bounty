// Validador determinístico da avaliação do LLM. O modelo escolhe ids de afirmação e classifica; este módulo
// confere o contrato, rebaixa o que não tem prova e recalcula a aderência a partir dos requisitos.
import { fold } from '../dedup/keys.mjs';

export const AVALIACOES = ['atendido', 'parcial', 'lacuna'];
export const TIPOS = ['obrigatorio', 'desejavel'];
export const ADERENCIAS = ['alta', 'media', 'baixa'];
const PROVA = new Set(['verificado', 'entregue']);
const CRITICO = /fluen|ingles (avancado|fluente)|english|certifica|\bpmp\b|\bcsm\b|\d+\s*\+?\s*anos.{0,40}(gestao|lideranca|gerencia)/;

const only = (objeto, permitidos, onde) => {
  const extra = Object.keys(objeto).find(key => !permitidos.includes(key));
  if (extra) throw new Error(`campo fora do contrato em ${onde}: ${extra}`);
};

export function validarAvaliacao(json, { ids, vagaId }) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('avaliação deve ser um objeto');
  only(json, ['vaga_id', 'requisitos', 'aderencia_sugerida', 'resumo', 'pendencias'], 'avaliação');
  if (json.vaga_id !== vagaId) throw new Error(`vaga_id não confere com a vaga avaliada (${vagaId})`);
  if (!Array.isArray(json.requisitos)) throw new Error('requisitos deve ser lista');
  if (!ADERENCIAS.includes(json.aderencia_sugerida)) throw new Error('aderencia_sugerida inválida');
  if (typeof json.resumo !== 'string') throw new Error('resumo deve ser texto');
  if (!Array.isArray(json.pendencias) || json.pendencias.some(item => typeof item !== 'string')) throw new Error('pendencias deve ser lista de textos');
  json.requisitos.forEach((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`requisito ${index + 1} inválido`);
    only(item, ['requisito', 'tipo', 'avaliacao', 'afirmacoes', 'observacao'], `requisito ${index + 1}`);
    if (typeof item.requisito !== 'string' || !item.requisito.trim()) throw new Error(`requisito ${index + 1} sem texto`);
    if (!TIPOS.includes(item.tipo)) throw new Error(`tipo inválido no requisito ${index + 1}`);
    if (!AVALIACOES.includes(item.avaliacao)) throw new Error(`avaliacao inválida no requisito ${index + 1}`);
    if (!Array.isArray(item.afirmacoes)) throw new Error(`afirmacoes deve ser lista no requisito ${index + 1}`);
    for (const id of item.afirmacoes) if (!ids.has(id)) throw new Error(`afirmação inexistente: ${String(id).slice(0, 40)}`);
  });
}

const PESO = { obrigatorio: 1, desejavel: 0.25 };
const VALOR = { atendido: 1, parcial: 0.5, lacuna: 0 };

export function calcularAderencia(requisitos) {
  if (!requisitos.length) return 'baixa';
  const total = requisitos.reduce((soma, item) => soma + PESO[item.tipo], 0);
  const obtido = requisitos.reduce((soma, item) => soma + PESO[item.tipo] * VALOR[item.avaliacao], 0);
  const razao = obtido / total;
  const lacunas = requisitos.filter(item => item.tipo === 'obrigatorio' && item.avaliacao === 'lacuna').length;
  if (lacunas >= 2) return 'baixa';
  const nivel = razao >= 0.8 ? 'alta' : razao >= 0.5 ? 'media' : 'baixa';
  return lacunas === 1 && nivel === 'alta' ? 'media' : nivel;
}

// Aplica as regras de prova. `niveis`: Map(id da afirmação -> nivel_prova).
export function refinarAvaliacao(json, niveis) {
  const ajustes = [];
  const requisitos = json.requisitos.map(item => {
    const novo = { ...item, afirmacoes: [...item.afirmacoes] };
    const comProva = novo.afirmacoes.some(id => PROVA.has(niveis.get(id)));
    if (novo.avaliacao === 'atendido' && !comProva) {
      const critico = CRITICO.test(fold(novo.requisito));
      novo.avaliacao = critico ? 'lacuna' : 'parcial';
      ajustes.push(`${novo.requisito}: atendido sem prova virou ${novo.avaliacao}`);
    }
    if (novo.afirmacoes.some(id => niveis.get(id) === 'relato')) novo.nao_verificado = true;
    return novo;
  });
  return { ...json, requisitos, aderencia: calcularAderencia(requisitos), aderencia_sugerida_llm: json.aderencia_sugerida, ajustes };
}
