// Classificação por regra (pt-BR e en) sobre assunto, trecho e remetente do digest. Sem LLM.
// O que a regra não resolve vira `precisa_abrir`; regra que precisa do corpo declara `precisa_corpo` e só roda na fase B.
import { readFileSync } from 'node:fs';
import { fold } from '../dedup/keys.mjs';
import { parecidoComPortal, portalDoDominio } from './portais.mjs';

export const CLASSES = ['confirmacao', 'etapa_liberada', 'acao_necessaria', 'entrevista_agendada', 'negativa', 'oferta', 'alerta', 'ruido'];

const arquivo = JSON.parse(readFileSync(new URL('./rules/pt-br.json', import.meta.url), 'utf8'));
export const REGRAS = arquivo.regras.map(regra => ({ ...regra, res: regra.padroes.map(p => new RegExp(p)) }));
export const VERSAO_REGRAS = arquivo.versao;

// Domínio do remetente: portal conhecido, confiável por config, parecido com portal (suspeito) ou desconhecido.
export function avaliarDominio(dominio, { extras = [], confiaveis = [] } = {}) {
  const portal = portalDoDominio(dominio, extras);
  if (portal) return { tipo: 'portal', portal: portal === 'extra' ? null : portal, confianca: 'alta' };
  const d = String(dominio ?? '').toLowerCase();
  if (confiaveis.some(base => d === base || d.endsWith(`.${base}`))) return { tipo: 'confiavel', portal: null, confianca: 'alta' };
  const parecido = parecidoComPortal(d, extras);
  if (parecido) return { tipo: 'suspeito', portal: null, parecido_com: parecido, confianca: 'baixa' };
  return { tipo: 'desconhecido', portal: null, confianca: 'media' };
}

const campoDe = (item, campo, corpo) => fold(campo === 'corpo' ? corpo ?? '' : item[campo] ?? '');

function disparos(item, corpo) {
  const achados = [];
  for (const regra of REGRAS) {
    if (regra.campo === 'corpo' && corpo === undefined) continue;
    const texto = campoDe(item, regra.campo, corpo);
    if (texto && regra.res.some(re => re.test(texto))) achados.push(regra);
  }
  return achados;
}

// item: { assunto, trecho, remetente_dominio }. `corpo` (já sanitizado) só existe na fase B.
export function classificar(item, { corpo, extras = [], confiaveis = [] } = {}) {
  const dominio = avaliarDominio(item.remetente_dominio, { extras, confiaveis });
  const achados = disparos(item, corpo);
  const porCampo = campo => [...new Set(achados.filter(r => r.campo === campo && r.classe).map(r => r.classe))];
  const base = { portal: dominio.portal, dominio: dominio.tipo, confianca: dominio.confianca, regras: achados.map(r => r.id) };
  let classe = null;
  let conflito = false;
  for (const campo of ['assunto', 'trecho', 'corpo']) {
    const classes = porCampo(campo);
    if (classes.length === 1) { classe = classes[0]; break; }
    if (classes.length > 1) { conflito = true; break; }
  }
  if (classe) return { ...base, classe, precisa_abrir: false, precisa_llm: false, motivo: `regra:${base.regras.join(',')}` };
  if (conflito) return { ...base, classe: null, precisa_abrir: corpo === undefined, precisa_llm: corpo !== undefined, motivo: 'regras em conflito' };
  const ambigua = achados.some(r => r.classe === null);
  // Sem padrão reconhecido: vindo de portal conhecido ou com assunto ambíguo é dúvida real; de remetente
  // desconhecido ou suspeito é ruído (nunca avança etapa).
  if (ambigua || dominio.tipo === 'portal' || dominio.tipo === 'confiavel') {
    return { ...base, classe: null, precisa_abrir: corpo === undefined, precisa_llm: corpo !== undefined, motivo: ambigua ? 'assunto ambíguo' : 'portal sem padrão reconhecido' };
  }
  return { ...base, classe: 'ruido', precisa_abrir: false, precisa_llm: false, motivo: 'remetente sem padrão de processo seletivo' };
}

// Relatório por regra sobre itens rotulados: { item, corpo?, rotulo: { classe, ambiguo, precisa_llm } }.
export function relatorioPorRegra(amostra, opcoes = {}) {
  const regras = new Map(REGRAS.filter(r => r.campo !== 'corpo').map(r => [r.id, { regra: r.id, classe: r.classe, disparos: 0, acertos: 0 }]));
  const porClasse = new Map();
  let ambiguos = 0;
  let ambiguosEncaminhados = 0;
  for (const { item, rotulo } of amostra) {
    const r = classificar(item, opcoes);
    for (const id of r.regras) {
      const linha = regras.get(id);
      if (!linha || !linha.classe) continue;
      linha.disparos += 1;
      if (r.classe === rotulo.classe) linha.acertos += 1;
    }
    if (rotulo.ambiguo) { ambiguos += 1; if (r.precisa_abrir) ambiguosEncaminhados += 1; continue; }
    const c = porClasse.get(rotulo.classe) ?? { classe: rotulo.classe, total: 0, acertos: 0 };
    c.total += 1;
    if (r.classe === rotulo.classe) c.acertos += 1;
    porClasse.set(rotulo.classe, c);
  }
  const taxa = (a, t) => (t ? Math.round((a / t) * 10000) / 10000 : null);
  return {
    regras: [...regras.values()].filter(l => l.disparos > 0).map(l => ({ ...l, precisao: taxa(l.acertos, l.disparos) })),
    classes: [...porClasse.values()].map(c => ({ ...c, cobertura: taxa(c.acertos, c.total) })),
    ambiguos: { total: ambiguos, encaminhados_a_fase_b: ambiguosEncaminhados, taxa: taxa(ambiguosEncaminhados, ambiguos) },
  };
}

export function formatarRelatorio(relatorio) {
  const pct = v => (v === null ? 'n/d' : `${(v * 100).toFixed(1)}%`);
  return [
    'Precisão por regra (disparos que acertaram a classe):',
    ...relatorio.regras.map(l => `  ${l.regra.padEnd(22)} ${String(l.acertos).padStart(3)}/${String(l.disparos).padEnd(3)} ${pct(l.precisao)}`),
    'Cobertura por classe (itens não ambíguos resolvidos pela regra):',
    ...relatorio.classes.map(c => `  ${c.classe.padEnd(22)} ${String(c.acertos).padStart(3)}/${String(c.total).padEnd(3)} ${pct(c.cobertura)}`),
    `Ambíguos encaminhados à fase B: ${relatorio.ambiguos.encaminhados_a_fase_b}/${relatorio.ambiguos.total} ${pct(relatorio.ambiguos.taxa)}`,
  ].join('\n');
}
