// LlmRunner (seam S4): única porta de saída para o LLM. Modos fake, replay e live.
// O contrato é JSON validado por quem chama; a entrada passa por redact; cada chamada registra um evento llm.uso.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendEvents } from '../store/events.mjs';
import { redact } from '../privacy/redact.mjs';

export class LlmSaidaInvalida extends Error {
  constructor(message, { agente, tentativas } = {}) {
    super(message);
    this.name = 'LlmSaidaInvalida';
    this.agente = agente;
    this.tentativas = tentativas;
  }
}

const ordenar = value => {
  if (Array.isArray(value)) return value.map(ordenar);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordenar(value[key])]));
  return value;
};

// Hash da chamada: agente, modelo, versão do prompt e entrada. Mudou qualquer um, a gravação antiga não vale.
export const entradaHash = ({ agente, modelo, versaoPrompt, entrada }) =>
  createHash('sha256').update(JSON.stringify(ordenar({ agente, modelo, versaoPrompt, entrada }))).digest('hex');

export function stripFence(text) {
  const match = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(String(text));
  return (match ? match[1] : String(text)).trim();
}

// Envelope de `claude -p --output-format json`.
export function parseEnvelope(stdout) {
  let envelope;
  try { envelope = JSON.parse(stdout); } catch { throw new Error('saída do claude -p não é JSON'); }
  if (envelope.is_error || typeof envelope.result !== 'string') throw new Error(`claude -p falhou: ${String(envelope.result ?? 'sem resultado').slice(0, 200)}`);
  const u = envelope.usage ?? {};
  return { texto: envelope.result, uso: { tokens_in: u.input_tokens ?? 0, tokens_out: u.output_tokens ?? 0, tokens_cache_leitura: u.cache_read_input_tokens ?? 0, tokens_cache_criacao: u.cache_creation_input_tokens ?? 0, custo_usd: envelope.total_cost_usd ?? null } };
}

// Nenhuma ferramenta, nenhuma sessão salva, nenhum MCP, nenhuma skill: o texto da vaga é dado, não tem como agir.
export function buildLiveArgs({ modelo, sistema }) {
  return ['-p', '--model', modelo, '--output-format', 'json', '--tools', '', '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config',
    '--setting-sources', '', ...(sistema ? ['--system-prompt', sistema] : [])];
}

function runClaude({ bin, args, input, cwd, timeoutMs, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`claude -p excedeu ${timeoutMs} ms`)); }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(new Error(`não foi possível iniciar o claude: ${error.code ?? error.message}`)); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(`claude -p saiu com código ${code}: ${stderr.trim().slice(-200)}`)); });
    child.stdin.end(input);
  });
}

export function createRunner({ modo, dataRoot, fake, replayDir, identity = [], env = process.env, gravar = false, claudeBin = 'claude', timeoutMs = 180000, now = () => new Date() } = {}) {
  if (!['fake', 'replay', 'live'].includes(modo)) throw new Error(`Modo de LLM inválido: ${modo}`);
  let seq = 0;

  async function chamar({ agente, modelo, versaoPrompt, entrada, sistema, tentativa, hash }) {
    if (modo === 'fake') {
      if (typeof fake !== 'function') throw new Error('Modo fake exige a função fake.');
      const saida = await fake({ agente, modelo, versaoPrompt, entrada, tentativa });
      const { _uso, ...resto } = saida && typeof saida === 'object' ? saida : { _uso: undefined };
      return { texto: typeof saida === 'string' ? saida : JSON.stringify(resto), uso: _uso ?? { tokens_in: 0, tokens_out: 0 } };
    }
    if (modo === 'replay') {
      const file = path.join(replayDir, `${agente}-${hash.slice(0, 16)}.json`);
      let gravacao;
      try { gravacao = JSON.parse(await readFile(file, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') throw new Error(`Sem gravação para ${agente} (hash ${hash.slice(0, 16)}): rode npm run record para regravar.`); throw error; }
      if (gravacao.hash !== hash) throw new Error(`Gravação de ${agente} não confere com o hash atual: rode npm run record.`);
      return { texto: gravacao.saida, uso: gravacao.uso ?? { tokens_in: 0, tokens_out: 0 } };
    }
    if (env.CI) throw new Error('O modo live não roda dentro da CI.');
    if (env.LIVE !== '1') throw new Error('O modo live exige LIVE=1 (chamada real cobrada).');
    const prompt = `Entrada (JSON):\n${JSON.stringify(entrada)}\nResponda somente com o JSON do contrato.`;
    const stdout = await runClaude({ bin: claudeBin, args: buildLiveArgs({ modelo, sistema }), input: prompt, cwd: tmpdir(), timeoutMs, env });
    const resultado = parseEnvelope(stdout);
    if (gravar && replayDir) {
      await mkdir(replayDir, { recursive: true });
      await writeFile(path.join(replayDir, `${agente}-${hash.slice(0, 16)}.json`), `${JSON.stringify({ hash, agente, modelo, versaoPrompt, entrada, saida: resultado.texto, uso: resultado.uso }, null, 2)}\n`);
    }
    return resultado;
  }

  async function registrar({ agente, modelo, versaoPrompt, hash, uso, tentativa }) {
    if (!dataRoot) return;
    const ts = now().toISOString();
    seq += 1;
    await appendEvents(dataRoot, [{ id: `llm.uso:${hash.slice(0, 12)}:${ts}:${seq}:${tentativa}`, ts, ator: 'llm', tipo: 'llm.uso', entidade: 'llm', entidade_id: agente,
      dados: { modelo, agente, tokens_in: uso.tokens_in ?? 0, tokens_out: uso.tokens_out ?? 0, ...(uso.tokens_cache_leitura ? { tokens_cache_leitura: uso.tokens_cache_leitura } : {}),
        ...(uso.tokens_cache_criacao ? { tokens_cache_criacao: uso.tokens_cache_criacao } : {}), ...(uso.custo_usd != null ? { custo_usd: uso.custo_usd } : {}), hash, modo, versaoPrompt, tentativa } }], { now: ts });
  }

  return {
    modo,
    async run({ agente, modelo, versaoPrompt, entrada, sistema, validar = () => {} }) {
      const limpa = redact(entrada, identity).valor;
      const hash = entradaHash({ agente, modelo, versaoPrompt, entrada: limpa });
      let motivo = '';
      for (let tentativa = 1; tentativa <= 2; tentativa++) {
        const { texto, uso } = await chamar({ agente, modelo, versaoPrompt, entrada: limpa, sistema, tentativa, hash });
        await registrar({ agente, modelo, versaoPrompt, hash, uso, tentativa });
        let json;
        try { json = JSON.parse(stripFence(texto)); }
        catch { motivo = 'saída não é JSON válido'; continue; }
        try { validar(json); } catch (error) { motivo = `saída fora do contrato: ${error.message}`; continue; }
        return { json, uso, hash };
      }
      throw new LlmSaidaInvalida(`${agente}: ${motivo} (2 tentativas)`, { agente, tentativas: 2 });
    },
  };
}
