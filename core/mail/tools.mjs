// Ferramentas do conector Gmail (claude.ai). Leitura é lista fechada; todo o resto do Gmail é tratado como escrita.
export const GMAIL_PREFIXO = 'mcp__claude_ai_Gmail__';
const nome = acao => `${GMAIL_PREFIXO}${acao}`;

export const GMAIL_LEITURA = ['search_threads', 'get_thread', 'get_message'].map(nome);

export const ACOES_ESCRITA = ['send_message', 'reply', 'forward', 'trash_message', 'trash_thread', 'untrash_message', 'untrash_thread',
  'create_draft', 'update_draft', 'delete_draft', 'create_label', 'update_label', 'delete_label', 'label_message', 'label_thread',
  'unlabel_message', 'unlabel_thread', 'update_message_labels', 'mark_message_spam', 'mark_thread_spam', 'unmark_message_spam',
  'unmark_thread_spam', 'apply_sensitive_message_label', 'apply_sensitive_thread_label'];
export const GMAIL_ESCRITA = ACOES_ESCRITA.map(nome);

// Ferramentas embutidas que o leitor jamais precisa.
export const EMBUTIDAS_NEGADAS = ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch'];

// Qualquer ferramenta MCP cujo servidor se chame Gmail e não esteja na lista de leitura, ou cuja ação seja de escrita
// conhecida em qualquer servidor, conta como escrita (padrão negado).
export function ehEscritaGmail(ferramenta) {
  const partes = String(ferramenta ?? '').split('__');
  if (partes[0] !== 'mcp' || partes.length < 3) return false;
  const servidor = partes[1];
  const acao = partes.slice(2).join('__');
  if (/gmail/i.test(servidor)) return !GMAIL_LEITURA.includes(ferramenta);
  return ACOES_ESCRITA.includes(acao);
}

// Verbos de escrita: ferramenta desconhecida de qualquer servidor MCP com um destes no nome é negada (padrão negado).
const VERBOS_ESCRITA = /send|forward|reply|trash|delete|draft|label|modify|move|archive|spam|envio|apagar/i;

export function ehEscritaMcp(ferramenta) {
  if (ehEscritaGmail(ferramenta)) return true;
  const partes = String(ferramenta ?? '').split('__');
  if (partes[0] !== 'mcp' || partes.length < 3) return false;
  return VERBOS_ESCRITA.test(partes.slice(2).join('__'));
}
