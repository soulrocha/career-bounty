// `report tokens --by mail-round`: tokens e custo por rodada de leitura de e-mail (sem nenhum conteúdo de e-mail).
import { loadSettings } from '../config.mjs';
import { resumirRodadas } from '../mail/tokens.mjs';
import { readEvents } from '../store/events.mjs';

export async function report(rest, { parseFlags }) {
  const [sub, ...flags] = rest;
  if (sub !== 'tokens') throw new Error(`Subcomando report desconhecido: ${sub ?? ''}`.trim());
  const values = parseFlags(flags, { allowed: ['--by'], withValue: ['--by'] });
  if (values['--by'] !== 'mail-round') throw new Error('Informe --by mail-round.');
  const settings = await loadSettings();
  const { eventos } = await readEvents(settings.dataRoot);
  const result = { orcamento_tokens: settings.mail.orcamento_tokens, ...resumirRodadas(eventos) };
  const linhas = result.rodadas.map(r => `${r.rodada}: ${r.total_tokens} tokens, US$ ${r.custo_usd} (busca ${r.busca.chamadas}, abertura ${r.abertura.chamadas}, classificador ${r.classificador.chamadas})`);
  return { result, text: [...linhas, `rodadas: ${result.resumo.rodadas}; média ${result.resumo.media_tokens ?? 'n/d'}; P95 ${result.resumo.p95_tokens ?? 'n/d'}`].join('\n') };
}
