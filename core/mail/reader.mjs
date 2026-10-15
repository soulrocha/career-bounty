// Leitor de e-mail em duas fases pelo subagente `leitor-email` (Haiku, somente leitura) via LlmRunner.
// Fase A: busca com a consulta montada pelo script. Fase B: abre só os ids que as regras não resolveram.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgent } from '../llm/agents.mjs';
import { localDay } from '../store/schema.mjs';
import { validarDigest, validarFull } from './contract.mjs';
import { EMBUTIDAS_NEGADAS, GMAIL_ESCRITA, GMAIL_PREFIXO } from './tools.mjs';

const PERMITIDAS = { A: [`${GMAIL_PREFIXO}search_threads`], B: [`${GMAIL_PREFIXO}get_thread`, `${GMAIL_PREFIXO}get_message`] };
const HOOK = fileURLToPath(new URL('../../hooks/pre-tool-use.mjs', import.meta.url));

// Terceira camada: o hook PreToolUse nega qualquer escrita do Gmail mesmo que as outras camadas falhem.
export async function escreverSettingsLeitor({ dir, node = process.execPath, hook = HOOK }) {
  await mkdir(dir, { recursive: true });
  const arquivo = path.join(dir, 'leitor-email.settings.json');
  const comando = `"${node}" "${hook}" --leitor`;
  await writeFile(arquivo, `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'mcp__.*', hooks: [{ type: 'command', command: comando }] }] } }, null, 2)}\n`);
  return arquivo;
}

// Segunda camada: o comando libera só a leitura da fase e nega todas as ferramentas de escrita.
// Sem --strict-mcp-config: o conector Gmail é do claude.ai e só existe com os conectores da conta.
export function montarArgsLeitor({ fase, modelo, sistema, settingsFile }) {
  if (!PERMITIDAS[fase]) throw new Error(`Fase inválida: ${fase}`);
  return ['-p', '--model', modelo, '--output-format', 'json', '--no-session-persistence', '--disable-slash-commands', '--tools', '',
    '--allowedTools', PERMITIDAS[fase].join(','), '--disallowedTools', [...GMAIL_ESCRITA, ...EMBUTIDAS_NEGADAS].join(','),
    ...(settingsFile ? ['--settings', settingsFile] : []), ...(sistema ? ['--system-prompt', sistema] : [])];
}

const meta = (rodada, fase) => ({ ...(rodada ? { rodada } : {}), fase });

export async function lerFaseA({ runner, consulta, now = new Date(), rodada, argsLive }) {
  const agente = await loadAgent('leitor-email');
  const entrada = { fase: 'A', consulta: consulta.query, limite: consulta.limite, cursor_usado: consulta.cursor_usado ?? null, hoje: localDay(now) };
  const { json, uso, hash } = await runner.run({ agente: 'leitor-email-busca', modelo: agente.modelo, versaoPrompt: agente.versaoPrompt, sistema: agente.sistema, entrada,
    argsLive, meta: meta(rodada, 'busca'), validar: saida => { validarDigest(saida, { now }); } });
  return { ...validarDigest(json, { now }), uso, hash };
}

export async function lerFaseB({ runner, ids, limite, rodada, argsLive }) {
  if (!ids.length) return { itens: [], adiados: [], avisos: [], uso: null };
  const agente = await loadAgent('leitor-email');
  const pedidos = ids.slice(0, Math.max(0, limite));
  const adiados = ids.slice(pedidos.length);
  if (!pedidos.length) return { itens: [], adiados, avisos: [], uso: null };
  const { json, uso, hash } = await runner.run({ agente: 'leitor-email-abertura', modelo: agente.modelo, versaoPrompt: agente.versaoPrompt, sistema: agente.sistema,
    entrada: { fase: 'B', ids: pedidos }, argsLive, meta: meta(rodada, 'abertura'), validar: saida => { validarFull(saida, { pedidos }); } });
  return { ...validarFull(json, { pedidos }), adiados, uso, hash };
}
