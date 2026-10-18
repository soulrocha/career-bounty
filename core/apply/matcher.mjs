// Matcher determinístico (F6.4): cruza os campos extraídos com o answer bank, sem LLM.
// Rótulo igual ou variante cadastrada preenche; select, rádio e grupo de checkbox só com opção equivalente; obrigatório sem
// resposta vira desconhecido (pergunta ao usuário ou rascunho, decidido na F6.5). Upload de currículo usa o PDF aprovado.
import { buscarResposta, normalizarRotulo } from './answers.mjs';

const ROTULO_CV = /\b(resume|curriculo|curriculum|cv)\b/;
const SIM = ['sim', 'yes', 'true'];
const NAO = ['nao', 'no', 'false'];

// Resposta textual ou booleana contra as opções da página: igual (normalizada), ou sim/não para booleano.
function opcaoEquivalente(valor, opcoes) {
  const alvo = normalizarRotulo(valor === true ? 'sim' : valor === false ? 'nao' : valor);
  const exata = opcoes.find(o => normalizarRotulo(o) === alvo);
  if (exata) return exata;
  const familia = SIM.includes(alvo) ? SIM : NAO.includes(alvo) ? NAO : null;
  return familia ? opcoes.find(o => familia.includes(normalizarRotulo(o))) ?? null : null;
}

function valorPara(campo, r) {
  if (campo.tipo === 'select' || campo.tipo === 'radio') {
    if (Array.isArray(r.resposta)) return { erro: 'resposta em lista para campo de escolha única' };
    const opcao = opcaoEquivalente(r.resposta, campo.opcoes ?? []);
    return opcao ? { valor: opcao } : { erro: 'sem opção equivalente na página' };
  }
  if (campo.tipo === 'checkbox_grupo') {
    const lista = Array.isArray(r.resposta) ? r.resposta : [r.resposta];
    const opcoes = lista.map(v => opcaoEquivalente(v, campo.opcoes ?? []));
    return opcoes.every(Boolean) ? { valor: opcoes } : { erro: 'alguma escolha sem opção equivalente na página' };
  }
  if (campo.tipo === 'checkbox') {
    const marcar = r.resposta === true || SIM.includes(normalizarRotulo(r.resposta));
    const desmarcar = r.resposta === false || NAO.includes(normalizarRotulo(r.resposta));
    return marcar || desmarcar ? { valor: marcar } : { erro: 'resposta não é sim/não' };
  }
  if (Array.isArray(r.resposta) || typeof r.resposta === 'boolean') return { erro: 'tipo de resposta incompatível com campo de texto' };
  if (campo.tipo === 'number' && !/^-?\d+([.,]\d+)?$/.test(String(r.resposta))) return { erro: 'campo numérico com resposta não numérica' };
  return { valor: String(r.resposta) };
}

// extracao: saída normalizada do extrator. Devolve { preenchimentos, desconhecidos, ignorados, chamadas_llm: 0 }.
// preenchimento: { ref, tipo, valor, resposta_id, sensivel } ou { ref, tipo: 'file', arquivo: 'cv_ats' }.
export function casarCampos({ extracao, respostas, portal = null, empresa = null, hoje }) {
  const preenchimentos = [];
  const desconhecidos = [];
  const ignorados = [];
  for (const campo of extracao.campos) {
    if (campo.tipo === 'file') {
      if (ROTULO_CV.test(normalizarRotulo(campo.label))) preenchimentos.push({ ref: campo.ref, tipo: 'file', arquivo: 'cv_ats' });
      else (campo.obrigatorio ? desconhecidos : ignorados).push({ ...campo, motivo: 'anexo que não é o currículo' });
      continue;
    }
    let r;
    try { r = buscarResposta(respostas, { label: campo.label, portal, empresa, hoje }); }
    catch (e) { desconhecidos.push({ ...campo, motivo: e.message }); continue; }
    if (!r) { (campo.obrigatorio ? desconhecidos : ignorados).push({ ...campo, motivo: 'sem resposta no answer bank' }); continue; }
    const { valor, erro } = valorPara(campo, r);
    if (erro) { desconhecidos.push({ ...campo, motivo: `${r.id}: ${erro}` }); continue; }
    preenchimentos.push({ ref: campo.ref, tipo: campo.tipo, valor, resposta_id: r.id, sensivel: r.sensivel });
  }
  return { preenchimentos, desconhecidos, ignorados, chamadas_llm: 0 };
}
