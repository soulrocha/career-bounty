// Agentes do plugin (agents/*.md): modelo, ferramentas e prompt. A versão do prompt é o hash do próprio texto,
// então qualquer edição invalida os caches e as gravações de replay.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../kb/schema.mjs';

const AGENTS = new URL('../../agents/', import.meta.url);

export async function loadAgent(nome) {
  if (!/^[a-z][a-z-]*$/.test(nome)) throw new Error(`Nome de agente inválido: ${nome}`);
  const file = new URL(`${nome}.md`, AGENTS);
  const { data, body } = parseFrontmatter(await readFile(file, 'utf8'));
  const tools = typeof data.tools === 'string' ? data.tools.split(',').map(item => item.trim()).filter(Boolean) : [];
  return { nome, modelo: data.model, tools, sistema: body, versaoPrompt: createHash('sha256').update(`${data.model}\n${body}`).digest('hex').slice(0, 12), arquivo: fileURLToPath(file) };
}
