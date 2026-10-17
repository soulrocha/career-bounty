// Seleção determinística do CV (porta da lógica do tailor_cv.py legado): base para o caso sem LLM e para conferir o redator.
// Com alvo (requisitos da vaga ligados a afirmações), os bullets sobem pelos requisitos atendidos; sem alvo, vale a base como está.
// Cabeçalho, foto, os 4 cards e as seções fixas do perfil passam intactos; o texto de cada bullet é sempre o da afirmação.
import { curriculoNecessario } from '../apply/portal.mjs';
import { elegiveis } from './elegibilidade.mjs';
import { agruparPorExperiencia } from './experiencias.mjs';
import { ITENS_MAX_PADRAO, textoDoItem } from './redator.mjs';

const ADERENCIAS_ADAPTADAS = new Set(['alta', 'boa']);
// Peso de um requisito para ordenar: obrigatório antes de desejável, atendido antes de parcial. Não atendido não é prova.
const PESOS = { 'obrigatorio:atendido': 4, 'desejavel:atendido': 3, 'obrigatorio:parcial': 2, 'desejavel:parcial': 1 };
const peso = req => PESOS[`${req.tipo}:${req.avaliacao}`] ?? 0;

// { gerar, adaptar, motivo }: portal sem CV não gera nada; o resto gera, e só a vaga boa e ativa é adaptada.
export function decidirCv(vaga, config) {
  if (vaga.curriculo_necessario === false || !curriculoNecessario(vaga, config)) return { gerar: false, adaptar: false, motivo: 'portal_sem_cv' };
  if (!ADERENCIAS_ADAPTADAS.has(vaga.aderencia)) return { gerar: true, adaptar: false, motivo: 'aderencia' };
  if (vaga.url_status !== 'aberta') return { gerar: true, adaptar: false, motivo: 'fechada' };
  if (vaga.condicoes?.situacao === 'incompativel') return { gerar: true, adaptar: false, motivo: 'incompativel' };
  if (vaga.descarte_usuario?.descartada) return { gerar: true, adaptar: false, motivo: 'descartada' };
  return { gerar: true, adaptar: true, motivo: 'adaptada' };
}

// Requisitos que provam aderência: atendidos ou parciais e ligados a ao menos uma afirmação liberada.
function requisitosAtendidos(vaga, liberadas) {
  return (vaga.requisitos ?? [])
    .filter(req => peso(req) > 0)
    .map(req => ({ requisito: req.requisito, tipo: req.tipo, avaliacao: req.avaliacao, afirmacoes: (req.afirmacoes ?? []).filter(id => liberadas.has(id)) }))
    .filter(req => req.afirmacoes.length);
}

// Ordem da base: a lista `afirmacoes` da experiência no perfil, quando existe; o resto vem depois, por ID.
function ordemBase(grupo, experiencia) {
  const fixa = experiencia?.afirmacoes ?? [];
  const posicao = id => (fixa.includes(id) ? fixa.indexOf(id) : fixa.length);
  return [...grupo].sort((a, b) => posicao(a.id) - posicao(b.id) || a.id.localeCompare(b.id));
}

function selecaoDeterministica({ perfil, liberadas, requisitos, maxItens }) {
  const pesoDe = new Map();
  for (const req of requisitos) for (const id of req.afirmacoes) pesoDe.set(id, Math.max(pesoDe.get(id) ?? 0, peso(req)));
  const grupos = agruparPorExperiencia(liberadas, perfil.experiencias);
  const experiencias = [];
  for (const [id, grupo] of grupos) {
    const base = ordemBase(grupo, perfil.experiencias.find(exp => exp.id === id));
    // sort é estável: dentro do mesmo peso, fica a ordem da base.
    const ordenada = [...base].sort((a, b) => (pesoDe.get(b.id) ?? 0) - (pesoDe.get(a.id) ?? 0));
    if (ordenada.length) experiencias.push({ id, itens: ordenada.slice(0, maxItens).map(af => ({ afirmacao: af.id, variante: null })) });
  }
  return { resumo: perfil.resumo_base, palavras_chave: [], experiencias };
}

// Payload que o render consome. selecao tem o formato do redator ({ resumo, palavras_chave, experiencias }), já validada.
export function montarPayload({ perfil, afirmacoes, selecao, vaga, tipo, requisitos_atendidos = [] }) {
  const porId = new Map(afirmacoes.map(af => [af.id, af]));
  const dadosExp = new Map(perfil.experiencias.map(exp => [exp.id, exp]));
  return {
    versao: 1,
    vaga_id: vaga.id,
    tipo,
    identificacao: tipo === 'adaptado' ? `CV para ${vaga.cargo} · ${vaga.empresa}` : 'CV-base',
    cabecalho: perfil.cabecalho,
    foto: perfil.foto ?? null,
    cards: perfil.cards,
    titulo: perfil.cabecalho.titulo,
    resumo: selecao.resumo,
    palavras_chave: selecao.palavras_chave,
    experiencias: selecao.experiencias.map(exp => {
      const dados = dadosExp.get(exp.id);
      return {
        id: exp.id,
        empresa: dados?.empresa ?? null,
        cargo: dados?.cargo ?? null,
        periodo: dados?.periodo ?? null,
        intro: dados?.intro ?? null,
        itens: exp.itens.map(item => ({ afirmacao: item.afirmacao, texto: textoDoItem(porId.get(item.afirmacao), item.variante ?? undefined) })),
      };
    }),
    formacao: perfil.formacao ?? [],
    cursos: perfil.cursos ?? [],
    competencias: perfil.competencias ?? [],
    idiomas: perfil.idiomas ?? null,
    requisitos_atendidos,
  };
}

// null quando o portal não recebe CV. Vaga sem alvo (ou não adaptável) recebe o CV-base identificado.
export function selecionarCv({ vaga, perfil, afirmacoes, config = {}, maxItens = ITENS_MAX_PADRAO }) {
  const decisao = decidirCv(vaga, config);
  if (!decisao.gerar) return null;
  const liberadas = elegiveis(afirmacoes);
  const requisitos = decisao.adaptar ? requisitosAtendidos(vaga, new Set(liberadas.map(af => af.id))) : [];
  const tipo = requisitos.length ? 'adaptado' : 'base';
  const selecao = selecaoDeterministica({ perfil, liberadas, requisitos, maxItens });
  return montarPayload({ perfil, afirmacoes, selecao, vaga, tipo, requisitos_atendidos: requisitos });
}
