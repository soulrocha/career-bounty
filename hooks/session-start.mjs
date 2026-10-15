#!/usr/bin/env node
// Hook SessionStart: lê o JSON do evento no stdin e devolve o resumo de pendências. Nunca falha a sessão.
import { sessionSummary } from '../core/hooks/sessionStart.mjs';
import { resolveDataRoot } from '../core/store/dataRoot.mjs';

try {
  for await (const _ of process.stdin) { /* o conteúdo do evento não é usado */ }
  const now = process.env.CAREER_BOUNTY_NOW ? new Date(process.env.CAREER_BOUNTY_NOW) : new Date();
  const resumo = await sessionSummary({ dataRoot: resolveDataRoot(), now });
  console.log(JSON.stringify(resumo ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: resumo } } : {}));
} catch (error) {
  console.error(`career-bounty: resumo de início de sessão indisponível (${String(error.message ?? error).slice(0, 120)})`);
  console.log('{}');
}
