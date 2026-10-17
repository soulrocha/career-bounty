// Lacunas (quadrante d): o que falta na base para sustentar o CV e as vagas. Determinístico.
// Cada lacuna traz peso e uma pergunta sugerida; a fila ordena por peso e desempata de forma estável.
import { fold } from '../dedup/keys.mjs';
import { extrairNumeros } from '../cv/numeros.mjs';
import { limparCampoCurto } from '../privacy/untrusted.mjs';

const ORDEM_TIPO = ['requisito_frequente', 'sem_fonte', 'sem_linha_base', 'buraco_timeline'];
const ADERENCIAS_ALVO = new Set(['alta', 'media', 'boa']);
const VERBO_VARIACAO = /\b(redu[zc]\w*|caiu|cair|aument\w*|cresc\w*|melhor\w*|elev\w*|diminu\w*|economi[zs]\w*|ganh\w*|amplia\w*|dobr\w*|passou de)\b/i;
const DE_PARA = /\b(?:de|from)\s+R?\$?\s*[\d.,]+\s*(?:%|mi|mil|[a-zçã]+)?\s+(?:para|a|to)\s+R?\$?\s*[\d.,]+/i;

const mesIndice = (ano, mes) => Number(ano) * 12 + (Number(mes) - 1);
const mesTexto = indice => `${Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, '0')}`;
const resumo = (texto, max = 110) => (texto.length > max ? `${texto.slice(0, max - 1).trimEnd()}…` : texto);

// "2025-03..2026-06", "2026-07-29..2026-08-03", "2019..2020" ou "2026-01..atual" -> intervalo em meses corridos.
export function parsePeriodo(periodo, { hoje = new Date() } = {}) {
  if (typeof periodo !== 'string') return null;
  const partes = periodo.split('..');
  if (partes.length !== 2) return null;
  const agora = new Date(hoje);
  const ponto = (texto, ehFim) => {
    const t = texto.trim().toLowerCase();
    if (t === 'atual' || t === 'hoje') return mesIndice(agora.getUTCFullYear(), agora.getUTCMonth() + 1);
    const m = /^(\d{4})(?:-(\d{2}))?(?:-\d{2})?$/.exec(t);
    if (!m) return null;
    if (m[2]) return mesIndice(m[1], m[2]);
    return mesIndice(m[1], ehFim ? 12 : 1);
  };
  const inicio = ponto(partes[0], false);
  const fim = ponto(partes[1], true);
  return inicio === null || fim === null || fim < inicio ? null : { inicio, fim };
}

// Resultado = afirmação com percentual, valor em reais ou verbo de variação. Contagem simples (14 pessoas) não exige linha de base.
const ehResultado = af => extrairNumeros(af.texto).some(n => n.tipo !== 'numero') || VERBO_VARIACAO.test(af.texto);
const temLinhaBase = (af, evidencias) => DE_PARA.test(af.texto) || evidencias.some(ev => ev.afirmacoes.includes(af.id) && String(ev.linha_base ?? '').trim());

function lacunasDasAfirmacoes({ afirmacoes, evidencias }) {
  const comFonte = new Set(evidencias.flatMap(ev => ev.afirmacoes));
  const out = [];
  for (const af of afirmacoes) {
    const noCv = af.uso?.includes('CV') ? 2 : 0;
    if (!comFonte.has(af.id)) {
      out.push({ id: `sem_fonte:${af.id}`, tipo: 'sem_fonte', origem: 'afirmacao', alvo: af.id, peso: 3 + noCv + (af.nivel_prova === 'relato' ? 1 : 0),
        descricao: `${af.id} não tem evidência ligada: "${resumo(af.texto)}"`,
        pergunta_sugerida: `Onde está o registro que sustenta ${af.id}? Indique o documento, relatório ou dado, ou diga que só existe o seu relato.` });
    }
    if (ehResultado(af) && !temLinhaBase(af, evidencias)) {
      out.push({ id: `sem_linha_base:${af.id}`, tipo: 'sem_linha_base', origem: 'afirmacao', alvo: af.id, peso: 2 + noCv,
        descricao: `${af.id} é um resultado sem linha de base: "${resumo(af.texto)}"`,
        pergunta_sugerida: `Qual era o ponto de partida antes do resultado de ${af.id}? Informe o valor de antes, o período e como foi medido.` });
    }
  }
  return out;
}

function lacunasDaLinhaDoTempo({ afirmacoes, buracoMeses, hoje }) {
  const intervalos = afirmacoes.map(af => parsePeriodo(af.periodo, { hoje })).filter(Boolean).sort((a, b) => a.inicio - b.inicio || a.fim - b.fim);
  const fundidos = [];
  for (const atual of intervalos) {
    const ultimo = fundidos.at(-1);
    if (ultimo && atual.inicio <= ultimo.fim + 1) ultimo.fim = Math.max(ultimo.fim, atual.fim);
    else fundidos.push({ ...atual });
  }
  const out = [];
  for (let i = 1; i < fundidos.length; i++) {
    const meses = fundidos[i].inicio - fundidos[i - 1].fim - 1;
    if (meses <= buracoMeses) continue;
    const de = mesTexto(fundidos[i - 1].fim + 1);
    const ate = mesTexto(fundidos[i].inicio - 1);
    out.push({ id: `buraco_timeline:${de}..${ate}`, tipo: 'buraco_timeline', origem: 'timeline', alvo: `${de}..${ate}`, peso: meses,
      descricao: `Sem afirmações entre ${de} e ${ate} (${meses} meses)`,
      pergunta_sugerida: `O que você fez entre ${de} e ${ate}? Cite cargo ou frente, atividades e uma entrega concreta, se houver.` });
  }
  return out;
}

// Requisitos de vagas de aderência alta/média/boa que nenhuma afirmação sustenta e que se repetem.
function lacunasDasVagas({ vagas, freqMinima }) {
  const grupos = new Map();
  for (const vaga of vagas) {
    if (!ADERENCIAS_ALVO.has(vaga.aderencia)) continue;
    const vistos = new Set();
    for (const r of vaga.requisitos ?? []) {
      if (r.avaliacao === 'atendido' || (r.afirmacoes ?? []).length) continue;
      const texto = limparCampoCurto(r.requisito, 120);
      const chave = fold(texto).replace(/\s+/g, ' ').trim();
      if (!chave || vistos.has(chave)) continue;
      vistos.add(chave);
      const grupo = grupos.get(chave) ?? { alvo: texto.toLowerCase().replace(/\s+/g, ' '), vagas: 0 };
      grupo.vagas += 1;
      grupos.set(chave, grupo);
    }
  }
  return [...grupos.values()].filter(g => g.vagas >= freqMinima).map(g => ({ id: `requisito_frequente:${g.alvo}`, tipo: 'requisito_frequente', origem: 'vagas', alvo: g.alvo, vagas: g.vagas, peso: g.vagas * 2,
    descricao: `"${g.alvo}" aparece em ${g.vagas} vagas de aderência alta ou média sem afirmação que o sustente`,
    pergunta_sugerida: `Você tem experiência com "${g.alvo}"? Descreva uma situação concreta, o resultado e o ponto de partida, se houver número.` }));
}

export function ordenarLacunas(lacunas) {
  return [...lacunas].sort((a, b) => b.peso - a.peso || ORDEM_TIPO.indexOf(a.tipo) - ORDEM_TIPO.indexOf(b.tipo) || a.id.localeCompare(b.id, 'pt-BR', { numeric: true }));
}

export function calcularLacunas({ afirmacoes, evidencias, vagas = [], buracoMeses = 6, freqMinima = 2, hoje = new Date() }) {
  return ordenarLacunas([
    ...lacunasDasAfirmacoes({ afirmacoes, evidencias }),
    ...lacunasDaLinhaDoTempo({ afirmacoes, buracoMeses, hoje }),
    ...lacunasDasVagas({ vagas, freqMinima }),
  ]);
}
