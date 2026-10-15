// Terceira camada contra escrita no Gmail: decisão do hook PreToolUse (seam S9). Padrão negado para o Gmail:
// só as ferramentas de leitura conhecidas passam; qualquer outra do conector é negada, inclusive as futuras.
import { ehEscritaGmail } from './tools.mjs';

const nega = motivo => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: motivo } });

// entrada: o JSON que o Claude Code manda ao hook. Devolve null (segue o fluxo normal) ou a decisão de negar.
export function decidirFerramenta(entrada) {
  if (!entrada || typeof entrada !== 'object' || typeof entrada.tool_name !== 'string') return nega('entrada do hook inválida: negado por padrão');
  if (ehEscritaGmail(entrada.tool_name)) return nega(`ferramenta de escrita do Gmail negada (${entrada.tool_name}): o leitor de e-mail é somente leitura`);
  return null;
}
