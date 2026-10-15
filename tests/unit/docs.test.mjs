import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot } from '../helpers/cli.mjs';
import { findViolations } from '../helpers/allowlist.mjs';
import { buildContext, scanText } from '../../core/privacy/scan.mjs';

const read = relative => readFile(path.join(repoRoot, relative), 'utf8');

async function filesUnder(dir, extension) {
  const out = [];
  for (const entry of await readdir(path.join(repoRoot, dir), { withFileTypes: true }).catch(() => [])) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...await filesUnder(relative, extension));
    else if (relative.endsWith(extension)) out.push(relative);
  }
  return out;
}

const TERMOS = [
  ['Afirmação', /\bclaims?\b/i],
  ['Evidência', /\bevidence\b/i],
  ['Vaga canônica', /canonica/i],
  ['Requisição', /requisicao|requisition/i],
  ['Candidatura', /candidatura/i],
  ['Resposta', /\banswers?\b|resposta/i],
  ['Pergunta pendente', /pergunta_pendente|pendingQuestion/i],
  ['Regra de envio', /envio\.regras|sendRule/i],
  ['Evento', /appendEvent|readEvents|\bevents?\//i],
];

async function coreSources() {
  const files = await filesUnder('core', '.mjs');
  return Promise.all(files.map(f => read(f)));
}

test('todo termo obrigatório cujo tipo existe em core/ está definido no GLOSSARY', async () => {
  const glossary = await read('docs/GLOSSARY.md');
  const sources = (await coreSources()).join('\n');
  const present = TERMOS.filter(([, pattern]) => pattern.test(sources));
  assert.ok(present.length >= 3, 'o mapa de termos deve reconhecer tipos reais de core/');
  for (const [termo] of present) assert.match(glossary, new RegExp(`^#{2,3} ${termo}\\b`, 'm'), `termo ausente no glossário: ${termo}`);
});

test('o GLOSSARY define todos os termos do vocabulário do projeto', async () => {
  const glossary = await read('docs/GLOSSARY.md');
  for (const [termo] of TERMOS) assert.match(glossary, new RegExp(`^#{2,3} ${termo}\\b`, 'm'), termo);
});

test('ADR-1 a ADR-5 existem com Contexto, Decisão e Consequências', async () => {
  const files = (await readdir(path.join(repoRoot, 'docs', 'adr'))).filter(f => /^000[1-5]-.+\.md$/.test(f)).sort();
  assert.equal(files.length, 5);
  for (const file of files) {
    const text = await read(`docs/adr/${file}`);
    for (const section of ['Contexto', 'Decisão', 'Consequências']) assert.match(text, new RegExp(`^## ${section}\\s*$`, 'm'), `${file}: ${section}`);
  }
  assert.match(await read(`docs/adr/${files[4]}`), /Gupy por fluxos assistidos no Chrome, sem driver de envio; aceite de risco pertence à configuração do usuário/);
});

test('ARCHITECTURE lista as camadas e os seams S1 a S11', async () => {
  const text = await read('docs/ARCHITECTURE.md');
  for (let i = 1; i <= 11; i++) assert.match(text, new RegExp(`\\bS${i}\\b`), `S${i}`);
  for (const camada of ['Interface', 'Subagentes', 'Núcleo determinístico', 'Dados']) assert.match(text, new RegExp(camada), camada);
});

test('nenhum documento cita empresa real, caminho de usuário nem dado pessoal', async () => {
  const allowed = (await read('tests/fixtures/empresas-ficticias.txt')).split(/\r?\n/).filter(Boolean);
  const docs = [...await filesUnder('docs', '.md'), 'README.md', 'README.en.md', 'PRIVACY.md', 'SECURITY.md', 'CONTRIBUTING.md', 'LEGAL_DISCLAIMER.md', 'NOTICE', 'CLAUDE.md'];
  for (const file of docs) {
    const text = await read(file);
    assert.deepEqual(scanText(text, buildContext(), file), [], file);
    const hosts = findViolations(text, allowed).filter(v => v.kind === 'empresa');
    assert.deepEqual(hosts, [], file);
  }
});

test('CLAUDE.md e docs/SETUP.md falam em handoff do projeto, sem citar ferramenta de memória pessoal', async () => {
  for (const file of ['CLAUDE.md', 'docs/SETUP.md']) assert.doesNotMatch(await read(file), /ai[-_ ]?memory/i, file);
  assert.match(await read('docs/SETUP.md'), /handoff do projeto/);
});
