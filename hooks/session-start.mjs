#!/usr/bin/env node
// Hook SessionStart: lê o JSON do evento no stdin e devolve o resumo de pendências. Nunca falha a sessão.
// Com a base central configurada (F11), traz antes o que os outros computadores gravaram, com prazo curto.
import { sessionSummary } from '../core/hooks/sessionStart.mjs';
import { resolveDataRoot } from '../core/store/dataRoot.mjs';
import { sincronizarComPrazo } from '../core/sync/hook.mjs';

try {
  for await (const _ of process.stdin) { /* o conteúdo do evento não é usado */ }
  const now = process.env.CAREER_BOUNTY_NOW ? new Date(process.env.CAREER_BOUNTY_NOW) : new Date();
  const dataRoot = resolveDataRoot();
  const aviso = await sincronizarComPrazo(dataRoot);
  const resumo = [aviso, await sessionSummary({ dataRoot, now })].filter(Boolean).join('\n');
  sair(JSON.stringify(resumo ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: resumo } } : {}));
} catch (error) {
  console.error(`career-bounty: resumo de início de sessão indisponível (${String(error.message ?? error).slice(0, 120)})`);
  sair('{}');
}

// Sai logo depois de responder: um ssh que passou do prazo não segura a sessão.
function sair(texto) { process.stdout.write(`${texto}\n`, () => process.exit(0)); }
