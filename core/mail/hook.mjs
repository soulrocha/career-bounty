// Terceira camada contra escrita no Gmail: decisão do hook PreToolUse (seam S9), ativa só no processo do leitor de e-mail.
// Padrão negado para o Gmail: só as ferramentas de leitura conhecidas passam; qualquer outra do conector é negada, inclusive as futuras.
import { ehEscritaMcp } from './tools.mjs';

const nega = motivo => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: motivo } });

// entrada: o JSON que o Claude Code manda ao hook. Devolve null (segue o fluxo normal) ou a decisão de negar.
// O bloqueio vale só no processo do leitor de e-mail (`leitor: true`); fora dele o hook do plugin não decide nada,
// para não afetar ferramentas legítimas de outras sessões (Calendar, ai-memory, Azure DevOps...).
export function decidirFerramenta(entrada, { leitor = false } = {}) {
  if (!leitor) return null;
  if (!entrada || typeof entrada !== 'object' || typeof entrada.tool_name !== 'string') return nega('entrada do hook inválida: negado por padrão');
  if (ehEscritaMcp(entrada.tool_name)) return nega(`ferramenta de escrita negada (${entrada.tool_name}): o leitor de e-mail é somente leitura (só a leitura do Gmail é liberada; escrita e ferramenta desconhecida são negadas)`);
  return null;
}
