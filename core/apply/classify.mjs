// Classificação dos campos desconhecidos (F6.5): o que vira pergunta à pessoa e o que pode virar rascunho do redator.
// Factual, sensível, eliminatório, legal ou ambíguo é sempre pergunta (nunca rascunho, nunca chute). Só texto aberto vira
// rascunho, marcado rascunho_llm e aprovado antes de entrar no formulário. O Haiku entra só nos rótulos que as regras não
// resolvem, em lote, atrás de contrato JSON; sem runner, o que sobrar vira pergunta.
import { normalizarRotulo } from './answers.mjs';
import { loadAgent } from '../llm/agents.mjs';
import { redact as redigir } from '../privacy/redact.mjs';
import { chunk } from '../score/triage.mjs';

const redact = (texto, identity) => redigir(String(texto ?? ''), identity).valor;

const SENSIVEL = /\b(pcd|deficien\w*|disability|raca|cor|etnia|race|ethnic\w*|genero|gender|sexo|orientacao sexual|veteran\w*|religi\w*|gravid\w*|filhos|estado civil|idade|data de nascimento|nascimento|cpf|rg|documento|passaporte|endereco|cep|pretensao|salari\w*|remuneracao|salary|compensation|visto|visa|sponsor\w*|autorizad\w* a trabalhar|authorized to work|anos de experiencia|years of experience|tempo de experiencia)\b/;
const LEGAL = /\b(declar\w*|conflito de interesse|conflict of interest|parente\w*|relacionamento|concord\w*|autoriz\w*|termos|ciente|consent\w*|lgpd|gdpr|privacy|privacidade|antecedentes|background check|certif\w* que)\b/;
const ABERTO = /\b(conte|descreva|explique|por que|porque|fale sobre|motivacao|carta de apresentacao|cover letter|tell us|describe|why|what makes|additional information|informacoes adicionais|comentarios)\b/;
const FECHADOS = new Set(['select', 'radio', 'checkbox', 'checkbox_grupo', 'number', 'date', 'month', 'email', 'tel', 'url', 'file']);
export const CATEGORIAS_LLM = ['aberta', 'factual', 'sensivel', 'legal', 'ambigua'];
export const LOTE_CLASSIFICACAO = 20;

function porRegra(campo) {
  const r = normalizarRotulo(campo.label);
  if (!r) return { decisao: 'pergunta', categoria: 'ambigua', motivo: 'campo sem rótulo' };
  if (SENSIVEL.test(r)) return { decisao: 'pergunta', categoria: 'sensivel', motivo: 'dado sensível, factual ou eliminatório: só a pessoa responde' };
  if (LEGAL.test(r)) return { decisao: 'pergunta', categoria: 'legal', motivo: 'declaração legal ou de conflito: só a pessoa responde' };
  if (FECHADOS.has(campo.tipo)) return { decisao: 'pergunta', categoria: 'factual', motivo: 'escolha ou dado fechado: só a pessoa responde' };
  if (campo.tipo === 'textarea' || ABERTO.test(r)) return { decisao: 'rascunho', categoria: 'aberta', motivo: 'texto aberto: rascunho do redator, aprovado antes de usar' };
  return null;
}

export function validarClassificacao(json, refs) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.itens)) throw new Error('faltou itens[]');
  for (const item of json.itens) {
    const extra = Object.keys(item ?? {}).find(k => !['ref', 'categoria'].includes(k));
    if (extra) throw new Error(`campo fora do contrato: ${extra}`);
    if (!refs.has(item.ref)) throw new Error(`ref fora do lote: ${String(item.ref).slice(0, 20)}`);
    if (!CATEGORIAS_LLM.includes(item.categoria)) throw new Error(`categoria inválida: ${String(item.categoria).slice(0, 20)}`);
  }
}

// desconhecidos: saída do matcher. identity: valores de identidade para tirar de qualquer rótulo devolvido.
export async function classificarDesconhecidos({ desconhecidos, runner = null, identity = [] }) {
  const limpar = campo => ({ ref: campo.ref, label: redact(campo.label, identity), tipo: campo.tipo, obrigatorio: campo.obrigatorio, ...(campo.opcoes ? { opcoes: campo.opcoes.map(o => redact(o, identity)) } : {}) });
  const resultado = [];
  const restantes = [];
  for (const campo of desconhecidos) {
    const decisao = porRegra(campo);
    if (decisao) resultado.push({ ...limpar(campo), ...decisao, ...(decisao.decisao === 'rascunho' ? { rascunho_llm: true } : {}) });
    else restantes.push(campo);
  }
  let chamadas = 0;
  if (restantes.length && runner) {
    const agente = await loadAgent('classificador-campos');
    for (const lote of chunk(restantes, LOTE_CLASSIFICACAO)) {
      const refs = new Set(lote.map(c => c.ref));
      const entrada = { campos: lote.map(c => ({ ref: c.ref, label: redact(c.label, identity).slice(0, 120), tipo: c.tipo })) };
      const { json } = await runner.run({ agente: 'classificador-campos', modelo: agente.modelo, versaoPrompt: agente.versaoPrompt, sistema: agente.sistema, entrada, validar: saida => validarClassificacao(saida, refs) });
      chamadas += 1;
      for (const campo of lote) {
        const categoria = json.itens.find(i => i.ref === campo.ref)?.categoria ?? 'ambigua';
        const aberta = categoria === 'aberta';
        resultado.push({ ...limpar(campo), decisao: aberta ? 'rascunho' : 'pergunta', categoria, motivo: aberta ? 'texto aberto (classificado pelo Haiku): rascunho aprovado antes de usar' : `classificado como ${categoria}: só a pessoa responde`, ...(aberta ? { rascunho_llm: true } : {}) });
      }
    }
  } else {
    for (const campo of restantes) resultado.push({ ...limpar(campo), decisao: 'pergunta', categoria: 'ambigua', motivo: 'rótulo ambíguo: pergunta, não chute' });
  }
  const ordem = new Map(desconhecidos.map((c, i) => [c.ref, i]));
  return { campos: resultado.sort((a, b) => ordem.get(a.ref) - ordem.get(b.ref)), chamadas_llm: chamadas };
}
