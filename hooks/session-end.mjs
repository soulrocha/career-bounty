#!/usr/bin/env node
// Hook SessionEnd: com a base central configurada (F11), envia o que a sessão gravou. Nunca falha a sessão.
import { resolveDataRoot } from '../core/store/dataRoot.mjs';
import { sincronizarComPrazo } from '../core/sync/hook.mjs';

try {
  for await (const _ of process.stdin) { /* o conteúdo do evento não é usado */ }
  const aviso = await sincronizarComPrazo(resolveDataRoot());
  if (aviso) console.error(`career-bounty: ${aviso}`);
} catch (error) {
  console.error(`career-bounty: sincronização de fim de sessão indisponível (${String(error.message ?? error).slice(0, 120)})`);
}
process.exit(0); // um ssh que passou do prazo não segura o encerramento
