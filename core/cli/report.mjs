// `report tokens --by mail-round`: tokens e custo por rodada de leitura de e-mail (sem nenhum conteúdo de e-mail).
import { loadSettings } from '../config.mjs';
import { resumirRodadas } from '../mail/tokens.mjs';
import { readEvents } from '../store/events.mjs';
import { resumirCandidaturas } from '../apply/tokens.mjs';

export async function report(rest, { parseFlags }) {
  const [sub, ...flags] = rest;
  if (sub !== 'tokens') throw new Error(`Subcomando report desconhecido: ${sub ?? ''}`.trim());
  const values = parseFlags(flags, { allowed: ['--by'], withValue: ['--by'] });
  if (!['mail-round', 'application'].includes(values['--by'])) throw new Error('Informe --by mail-round ou application.');
  const settings = await loadSettings();
  const { eventos, avisos } = await readEvents(settings.dataRoot);
  if (values['--by'] === 'application') {
    if (avisos.length) throw new Error('Log contém eventos inválidos; relatório de candidatura não verificado.');
    const result = resumirCandidaturas(eventos);
    return { result, exitCode: result.resumo.acima_limite ? 1 : 0, text: result.candidaturas.map(c => `${c.vaga_id} (${c.tentativa_id}): ${c.total_tokens} tokens; ${c.resultado}`).join('\n') };
  }
  const result = { orcamento_tokens: settings.mail.orcamento_tokens, ...resumirRodadas(eventos) };
  const linhas = result.rodadas.map(r => `${r.rodada}: ${r.total_tokens} tokens, US$ ${r.custo_usd} (busca ${r.busca.chamadas}, abertura ${r.abertura.chamadas}, classificador ${r.classificador.chamadas})`);
  return { result, text: [...linhas, `rodadas: ${result.resumo.rodadas}; média ${result.resumo.media_tokens ?? 'n/d'}; P95 ${result.resumo.p95_tokens ?? 'n/d'}`].join('\n') };
}
