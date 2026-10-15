// Livro de tokens por rodada de e-mail: fase A (busca), fase B (abertura) e classificador, lidos do `usage`
// do `claude -p --output-format json` (eventos llm.uso). Nada de assunto, remetente ou trecho passa por aqui.
const FASES = ['busca', 'abertura', 'classificador'];
const vazio = () => ({ chamadas: 0, tokens_in: 0, tokens_out: 0, tokens_cache_leitura: 0, tokens_cache_criacao: 0, custo_usd: 0 });
const total = fase => fase.tokens_in + fase.tokens_out + fase.tokens_cache_leitura + fase.tokens_cache_criacao;
const arredonda = (v, casas = 6) => Math.round(v * 10 ** casas) / 10 ** casas;

export function percentil(valores, p) {
  if (!valores.length) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[Math.min(ordenados.length - 1, Math.max(0, Math.ceil((p / 100) * ordenados.length) - 1))];
}

export function resumirRodadas(eventos) {
  const rodadas = new Map();
  for (const e of eventos) {
    if (e.tipo !== 'llm.uso' || !e.dados?.rodada || !FASES.includes(e.dados.fase)) continue;
    const r = rodadas.get(e.dados.rodada) ?? { rodada: e.dados.rodada, ts: e.ts, ...Object.fromEntries(FASES.map(f => [f, vazio()])) };
    const alvo = r[e.dados.fase];
    alvo.chamadas += 1;
    alvo.tokens_in += e.dados.tokens_in ?? 0;
    alvo.tokens_out += e.dados.tokens_out ?? 0;
    alvo.tokens_cache_leitura += e.dados.tokens_cache_leitura ?? 0;
    alvo.tokens_cache_criacao += e.dados.tokens_cache_criacao ?? 0;
    alvo.custo_usd = arredonda(alvo.custo_usd + (e.dados.custo_usd ?? 0));
    if (e.ts < r.ts) r.ts = e.ts;
    rodadas.set(e.dados.rodada, r);
  }
  const lista = [...rodadas.values()].sort((a, b) => a.ts.localeCompare(b.ts)).map(r => ({
    ...r, total_tokens: FASES.reduce((s, f) => s + total(r[f]), 0), custo_usd: arredonda(FASES.reduce((s, f) => s + r[f].custo_usd, 0)),
  }));
  const totais = lista.map(r => r.total_tokens);
  return {
    rodadas: lista,
    resumo: { rodadas: lista.length, media_tokens: lista.length ? Math.round(totais.reduce((a, b) => a + b, 0) / lista.length) : null, p95_tokens: percentil(totais, 95),
      media_custo_usd: lista.length ? arredonda(lista.reduce((s, r) => s + r.custo_usd, 0) / lista.length) : null },
  };
}

// Orçamento: se a última rodada passou do orçamento, a próxima abre menos mensagens (metade, no mínimo 1) e avisa.
export function planejarLimiteFaseB({ limite, orcamento, ultimaRodada }) {
  if (!orcamento || !ultimaRodada || ultimaRodada.total_tokens <= orcamento) return { limite, avisos: [] };
  const reduzido = Math.max(1, Math.floor(limite / 2));
  return { limite: reduzido, avisos: [`a rodada anterior gastou ${ultimaRodada.total_tokens} tokens, acima do orçamento de ${orcamento}: a fase B abre no máximo ${reduzido} mensagens`] };
}
