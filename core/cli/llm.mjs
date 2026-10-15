// Cria o LlmRunner a partir das opções --live / --replay / --gravar. Live é cobrado e exige a opção explícita.
import path from 'node:path';
import { createRunner } from '../llm/runner.mjs';
import { loadIdentityValues } from '../privacy/redact.mjs';

export async function runnerDasOpcoes(values, settings, { maxChamadasLive = 1 } = {}) {
  if (!values['--live'] && !values['--replay']) throw new Error('Informe --live (chamada real ao Claude, cobrada) ou --replay <pasta de gravações>.');
  if (values['--live'] && values['--replay']) throw new Error('Use --live ou --replay, não os dois.');
  return createRunner({ modo: values['--live'] ? 'live' : 'replay', dataRoot: settings.dataRoot, replayDir: values['--replay'] ? path.resolve(values['--replay']) : path.join(settings.dataRoot, 'golden', 'replay'),
    identity: await loadIdentityValues(), env: { ...process.env, ...(values['--live'] ? { LIVE: '1' } : {}) }, gravar: Boolean(values['--gravar']), maxChamadasLive });
}
