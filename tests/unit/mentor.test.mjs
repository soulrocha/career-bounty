import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, run, tempDir } from '../helpers/cli.mjs';
import { loadAgent } from '../../core/llm/agents.mjs';
import { analisarBase } from '../../core/kb/analise.mjs';
import { loadSettings } from '../../core/config.mjs';
import { montarContextoMentor } from '../../core/kb/mentorContext.mjs';
import { loadIdentityValues } from '../../core/privacy/redact.mjs';

const kbDir = path.join(repoRoot, 'tests', 'fixtures', 'kb-quadrantes');
const { vagas } = JSON.parse(await readFile(path.join(repoRoot, 'tests', 'fixtures', 'vagas-quadrantes.json'), 'utf8'));
const IDENTIDADE = { nome: 'Ana Quadrantes', email: 'ana.quadrantes@exemplo.test', telefone: '+55 00 90000-0000', cpf: '000.000.000-00' };

async function ambiente(t) {
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  await cp(kbDir, path.join(dataRoot, 'kb'), { recursive: true });
  await writeFile(path.join(dataRoot, 'identity.yml'), JSON.stringify(IDENTIDADE));
  return dataRoot;
}

async function arvore(dir) {
  const itens = [];
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) { const f = path.join(e.parentPath ?? e.path, e.name); itens.push(`${path.relative(dir, f)}:${createHash('sha256').update(await readFile(f)).digest('hex')}`); }
  }
  return itens.sort().join('\n');
}

test('o agente mentor declara só ferramentas de leitura', async () => {
  const agente = await loadAgent('mentor');
  assert.equal(agente.modelo, 'opus');
  assert.ok(agente.tools.length > 0);
  assert.ok(agente.tools.every(ferramenta => ['Read', 'Grep', 'Glob'].includes(ferramenta)), agente.tools.join(','));
});

test('o contexto cita os quadrantes e o funil, sem identidade', async t => {
  const dataRoot = await ambiente(t);
  const settings = await loadSettings({ dataRoot });
  const { quadrantes, base } = await analisarBase({ dataRoot, settings });
  const contexto = montarContextoMentor({ quadrantes, vagas, preferencias: base.preferencias, identidade: Object.values(IDENTIDADE), snapshotHash: 'abc123' });
  assert.match(contexto.texto, /\(a\) dado e CV conferem: 1/);
  assert.match(contexto.texto, /\(b\) dado fora do CV: 3/);
  assert.match(contexto.texto, /\(c\) CV sem dado: 4/);
  assert.match(contexto.texto, /\(d\) lacunas: \d+/);
  assert.match(contexto.texto, /AF-104/);
  assert.match(contexto.texto, /Funil de vagas: 10 vagas/);
  assert.match(contexto.texto, /alta 3.*media 3.*boa 1.*baixa 2/s);
  assert.match(contexto.texto, /Analista de Operações/);
  for (const valor of Object.values(IDENTIDADE)) assert.ok(!contexto.texto.includes(valor), valor);
  assert.equal(contexto.dados.funil.total, 10);
  assert.equal(contexto.dados.snapshot, 'abc123');
});

test('o contexto redige qualquer valor de identidade que apareça nos textos da base', async t => {
  const dataRoot = await ambiente(t);
  await writeFile(path.join(dataRoot, 'kb', 'claims', 'AF-150.md'), '---\nid: AF-150\nnivel_prova: verificado\nuso: [CV]\npublicavel: sim\n---\nAna Quadrantes apresentou o painel a 8 gestores.\n');
  const settings = await loadSettings({ dataRoot });
  const { quadrantes, base } = await analisarBase({ dataRoot, settings });
  assert.ok(quadrantes.b.some(x => x.id === 'AF-150'));
  const contexto = montarContextoMentor({ quadrantes, vagas: [], preferencias: base.preferencias, identidade: await loadIdentityValues({ env: { IDENTITY_FILE: path.join(dataRoot, 'identity.yml') } }), snapshotHash: 'x' });
  assert.ok(!contexto.texto.includes('Ana Quadrantes'));
  assert.match(contexto.texto, /\[REDIGIDO\] apresentou o painel/);
});

test('funil vazio e base vazia geram contexto válido', () => {
  const vazio = { a: [], b: [], c: [], d: [], contagem: { a: 0, b: 0, c: 0, d: 0 }, avisos: [] };
  const contexto = montarContextoMentor({ quadrantes: vazio, vagas: [], preferencias: { cargo_alvo: null, cargos_alvo: [], texto: '' }, identidade: [], snapshotHash: null });
  assert.match(contexto.texto, /Funil de vagas: 0 vagas/);
  assert.match(contexto.texto, /\(a\) dado e CV conferem: 0/);
});

test('sem pedido explícito, o mentor não escreve em kb/ nem no outbox', async t => {
  const dataRoot = await ambiente(t);
  const antes = await arvore(path.join(dataRoot, 'kb'));
  const outboxAntes = await arvore(path.join(dataRoot, 'outbox'));
  const r = run(['mentor', 'contexto', '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(await arvore(path.join(dataRoot, 'kb')), antes);
  assert.equal(await arvore(path.join(dataRoot, 'outbox')), outboxAntes);
  assert.match(r.json.texto, /Quadrantes/);
  assert.ok(!r.stdout.includes('Ana Quadrantes'));
  assert.equal(run(['mentor', 'outro'], { dataRoot }).status, 2);
});

test('a skill e o agente proíbem inventar métrica e escrever sem pedido', async () => {
  const comando = await readFile(path.join(repoRoot, 'commands', 'mentor.md'), 'utf8');
  const agente = await readFile(path.join(repoRoot, 'agents', 'mentor.md'), 'utf8');
  for (const texto of [comando, agente]) {
    assert.match(texto, /nunca (invente|estime)[^.]*métrica|nunca estime métrica/i);
  }
  assert.match(agente, /somente leitura|só leitura/i);
  assert.match(agente, /sem pedido explícito/i);
  assert.match(comando, /^allowed-tools: Bash\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/career-bounty\.mjs":\*\)$/m);
  assert.match(comando, /mentor contexto/);
});
