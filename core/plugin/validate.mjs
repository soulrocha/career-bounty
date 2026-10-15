import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from '../kb/schema.mjs';
import { buildContext, scanText } from '../privacy/scan.mjs';
import { commandNames } from '../cli/commands.mjs';

const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'];
const READ_ONLY_AGENTS = /triador|leitor|classificador/;
const MODELS = ['haiku', 'sonnet', 'opus', 'inherit'];

const exists = async filename => access(filename).then(() => true, () => false);

async function readJson(root, relative, errors) {
  try { return JSON.parse(await readFile(path.join(root, relative), 'utf8')); }
  catch (error) {
    errors.push(error.code === 'ENOENT' ? `${relative}: arquivo ausente.` : `${relative}: não é JSON válido.`);
    return null;
  }
}

async function markdownIn(root, folder) {
  try { return (await readdir(path.join(root, folder))).filter(n => n.endsWith('.md')).sort(); } catch { return []; }
}

export async function validatePlugin(root) {
  const errors = [];
  const manifest = await readJson(root, '.claude-plugin/plugin.json', errors);
  if (manifest) for (const key of ['name', 'version', 'description']) {
    if (typeof manifest[key] !== 'string' || !manifest[key]) errors.push(`.claude-plugin/plugin.json: campo ${key} ausente.`);
  }
  const market = await readJson(root, '.claude-plugin/marketplace.json', errors);
  if (market) {
    if (typeof market.name !== 'string' || typeof market.owner?.name !== 'string') errors.push('.claude-plugin/marketplace.json: name e owner.name são obrigatórios.');
    if (!Array.isArray(market.plugins) || !market.plugins.length) errors.push('.claude-plugin/marketplace.json: plugins ausente.');
    for (const plugin of market.plugins ?? []) {
      if (typeof plugin.source !== 'string' || !(await exists(path.join(root, plugin.source)))) {
        errors.push(`.claude-plugin/marketplace.json: caminho ${plugin.source} do plugin ${plugin.name} não existe.`);
      }
    }
  }

  const known = new Set(commandNames());
  const commands = await markdownIn(root, 'commands');
  for (const name of commands) {
    const file = `commands/${name}`;
    const { data, body } = parseFrontmatter(await readFile(path.join(root, file), 'utf8'));
    if (!data.description) errors.push(`${file}: frontmatter sem description.`);
    const sub = /career-bounty\.mjs"?\s+([a-z][\w-]*)/.exec(body)?.[1];
    if (!sub) errors.push(`${file}: não chama nenhum subcomando da CLI.`);
    else if (!known.has(sub)) errors.push(`${file}: chama o subcomando ${sub}, que não existe na CLI.`);
  }

  const agents = await markdownIn(root, 'agents');
  for (const name of agents) {
    const file = `agents/${name}`;
    const { data } = parseFrontmatter(await readFile(path.join(root, file), 'utf8'));
    if (!MODELS.includes(data.model)) errors.push(`${file}: model ausente ou inválido.`);
    const tools = typeof data.tools === 'string' ? data.tools.split(',').map(t => t.trim()).filter(Boolean) : [];
    if (!tools.length) errors.push(`${file}: lista explícita de tools ausente.`);
    if (READ_ONLY_AGENTS.test(path.basename(name, '.md')) && tools.some(t => WRITE_TOOLS.includes(t))) {
      errors.push(`${file}: agente de leitura não pode ter ferramenta de escrita.`);
    }
  }

  try {
    const text = await readFile(path.join(root, 'CLAUDE.md'), 'utf8');
    if (text.split(/\r?\n/).length >= 60) errors.push('CLAUDE.md: deve ter menos de 60 linhas.');
    const findings = scanText(text, buildContext(), 'CLAUDE.md');
    if (findings.length) errors.push(`CLAUDE.md: contém dado pessoal (${[...new Set(findings.map(f => f.rule))].join(', ')}).`);
  } catch { errors.push('CLAUDE.md: arquivo ausente.'); }

  if (await exists(path.join(root, 'hooks', 'hooks.json'))) {
    const hooks = await readJson(root, 'hooks/hooks.json', errors);
    for (const match of JSON.stringify(hooks ?? {}).matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s"\\]+)/g)) {
      if (!(await exists(path.join(root, match[1])))) errors.push(`hooks/hooks.json: script ${match[1]} não existe.`);
    }
  }

  if (await exists(path.join(root, '.mcp.json'))) {
    const mcp = await readJson(root, '.mcp.json', errors);
    for (const [name, server] of Object.entries(mcp?.mcpServers ?? {})) {
      if (!/gupy/i.test(name)) errors.push(`.mcp.json: servidor ${name} não é o MCP público da Gupy.`);
      if (server.env || server.headers || server.apiKey || server.token) errors.push(`.mcp.json: servidor ${name} traz credencial.`);
    }
  }

  return { ok: errors.length === 0, errors, commands: commands.length, agents: agents.length };
}
