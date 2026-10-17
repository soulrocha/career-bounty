// Aceitação local (opt-in): usa o legado REAL em modo somente leitura. Nunca roda na CI nem em `npm test`.
//   LOCAL_ACCEPTANCE=1 LEGADO_PATH=<pipeline-vagas.json> npm run test:local
// Nada do legado é copiado para o repositório; o log vai para uma pasta temporária.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { loadSettings } from '../../core/config.mjs';
import { tempDir } from '../helpers/cli.mjs';
import { importPipeline } from '../../core/migration/import.mjs';
import { curriculoNecessario, portalCandidatura } from '../../core/apply/portal.mjs';
import { canonicalUrl, companyKey, fold, idFor, roleKey } from '../../core/dedup/keys.mjs';
import { constraints } from '../../core/score/constraints.mjs';
import { canonicalize } from '../../core/store/canonicalize.mjs';
import { semanticDiff } from '../../core/migration/diff.mjs';
import { readEvents } from '../../core/store/events.mjs';
import { projectEvents } from '../../core/store/project.mjs';

function realLegacyPath() {
  if (process.env.LOCAL_ACCEPTANCE !== '1') assert.fail('Aceitação local desligada: defina LOCAL_ACCEPTANCE=1 (e LEGADO_PATH) para rodar `npm run test:local`.');
  if (!process.env.LEGADO_PATH) assert.fail('Defina LEGADO_PATH com o caminho do pipeline-vagas.json legado.');
  return process.env.LEGADO_PATH;
}

test('F1.4: importa todas as vagas reais sem erro e reimportar não gera evento', async t => {
  const pipeline = JSON.parse(await readFile(realLegacyPath(), 'utf8'));
  const dataRoot = await tempDir(t);
  const first = await importPipeline({ dataRoot, pipeline, host: 'aceitacao' });
  assert.equal(first.vagasNovas, pipeline.vagas.length);
  const { eventos, avisos } = await readEvents(dataRoot);
  assert.deepEqual(avisos, []);
  assert.equal(projectEvents(eventos).vagas.length, pipeline.vagas.length);
  assert.equal((await importPipeline({ dataRoot, pipeline, host: 'aceitacao' })).eventsAdded, 0);
  console.log(`# vagas importadas: ${first.vagasNovas}; e-mails sem requisição: ${first.emailsNovos}; eventos: ${eventos.length}`);
});

test('F1.5: importar e projetar o legado real dá diferencas: 0', async t => {
  const pipeline = JSON.parse(await readFile(realLegacyPath(), 'utf8'));
  const dataRoot = await tempDir(t);
  await importPipeline({ dataRoot, pipeline, host: 'aceitacao' });
  const diff = semanticDiff(pipeline, projectEvents((await readEvents(dataRoot)).eventos));
  assert.equal(diff.diferencas, 0);
  console.log(`# diferencas: ${diff.diferencas}`);
});

// F1.10: as funções portadas contra o próprio refresh.py sobre as vagas reais (Python só lê; nada é gravado).
//   PYTHON_PATH=<python.exe> REFRESH_DIR=<pasta busca-vagas>
const PY_SCRIPT = `
import json, sys
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
import refresh
dados = json.load(sys.stdin)
config = json.load(open(sys.argv[1] + '/config.json', encoding='utf-8-sig'))
saida = {'empresas': {e: refresh.company_key(e) for e in dados['empresas']}, 'vagas': []}
for j in dados['vagas']:
    saida['vagas'].append({'canonicalUrl': getattr(refresh, 'canon' + 'ical')(j.get('url', '')), 'role_key': refresh.role_key(j), 'id_for': refresh.id_for(j),
      'portal': refresh.portal_candidatura(j), 'cv': refresh.curriculo_necessario(j, config), 'constraints': refresh.constraints(j, config)})
print(json.dumps(saida, ensure_ascii=False))
`;

test('F1.10: regras portadas batem com o refresh.py nas vagas reais', async () => {
  const pipeline = JSON.parse(await readFile(realLegacyPath(), 'utf8'));
  if (!process.env.PYTHON_PATH || !process.env.REFRESH_DIR) assert.fail('Defina PYTHON_PATH e REFRESH_DIR para a comparação com o refresh.py.');
  const empresas = [...new Set(pipeline.vagas.map(v => v.empresa))];
  const run = spawnSync(process.env.PYTHON_PATH, ['-X', 'utf8', '-B', '-I', '-c', PY_SCRIPT, process.env.REFRESH_DIR], { input: JSON.stringify({ vagas: pipeline.vagas, empresas }), encoding: 'utf8', maxBuffer: 1 << 28 });
  assert.equal(run.status, 0, run.stderr);
  const python = JSON.parse(run.stdout);
  const config = JSON.parse((await readFile(path.join(process.env.REFRESH_DIR, 'config.json'), 'utf8')).replace(/^﻿/, ''));
  // apelidos de empresa derivados do próprio legado: onde a chave simples difere da do Python
  const aliases = {};
  for (const empresa of empresas) if (companyKey(empresa) !== python.empresas[empresa]) aliases[fold(empresa)] = python.empresas[empresa];
  // Cidades e portais privados vêm do config.yml do DATA_ROOT (nunca do repositório).
  const privado = (await loadSettings()).raw;
  const settings = { ...config, regiao_presencial: privado.regiao_presencial ?? [], portais_extras: privado.portais_extras ?? {} };
  const divergentes = [];
  pipeline.vagas.forEach((vaga, i) => {
    const esperado = python.vagas[i];
    const obtido = { canonicalUrl: canonicalUrl(vaga.url ?? ''), role_key: roleKey(vaga, { aliases }), id_for: idFor(vaga, { aliases }), portal: portalCandidatura(vaga, settings), cv: curriculoNecessario(vaga, settings), constraints: constraints(vaga, settings) };
    for (const campo of Object.keys(obtido)) if (JSON.stringify(canonicalize(obtido[campo])) !== JSON.stringify(canonicalize(esperado[campo]))) divergentes.push(`${i}:${campo}`);
  });
  console.log(`# vagas comparadas: ${pipeline.vagas.length}; divergencias: ${divergentes.length}; empresas com apelido: ${Object.keys(aliases).length}`);
  assert.deepEqual(divergentes, []);
});

// F4.2/F4.9/F4.12: a base real e o Vault reais em somente leitura. A pasta de dados do teste é temporária; nada é gravado no Vault nem na base.
//   LOCAL_ACCEPTANCE=1 KB_DATA_ROOT=<DATA_ROOT real com kb/ e fontes.yml> npm run test:local
async function hashArvore(raiz) {
  const { createHash } = await import('node:crypto');
  const { readdir } = await import('node:fs/promises');
  const itens = [];
  async function visitar(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (['.git', '.obsidian', 'node_modules'].includes(entry.name)) continue;
      const arquivo = path.join(dir, entry.name);
      if (entry.isDirectory()) await visitar(arquivo);
      else if (/\.(md|txt|html|json|yml|cmd|ps1)$/i.test(entry.name)) itens.push(`${path.relative(raiz, arquivo)}:${createHash('sha256').update(await readFile(arquivo)).digest('hex')}`);
    }
  }
  await visitar(raiz);
  return createHash('sha256').update(itens.sort().join('\n')).digest('hex');
}

test('F4: lê a base real e o Vault real sem alterar nenhum arquivo (hash da árvore antes e depois)', async t => {
  if (process.env.LOCAL_ACCEPTANCE !== '1') assert.fail('Aceitação local desligada: defina LOCAL_ACCEPTANCE=1.');
  const real = process.env.KB_DATA_ROOT;
  if (!real) assert.fail('Defina KB_DATA_ROOT com o DATA_ROOT real (kb/ e fontes.yml).');
  const { run } = await import('../helpers/cli.mjs');
  const manifesto = JSON.parse(await readFile(path.join(real, 'fontes.yml'), 'utf8'));
  const raizVault = manifesto.obsidian_vault?.raiz ?? (await loadSettings({ dataRoot: real })).vault_root;
  assert.ok(raizVault, 'o fontes.yml ou o config.yml precisa informar a raiz do Vault');
  // DATA_ROOT temporário: lê a base real por caminho absoluto, grava só aqui.
  const temp = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot: temp }).status, 0);
  await writeFile(path.join(temp, 'fontes.yml'), JSON.stringify({ ...manifesto, markdown_folder: { raiz: path.join(real, 'kb') } }));
  await writeFile(path.join(temp, 'config.yml'), await readFile(path.join(real, 'config.yml'), 'utf8'));
  const [vaultAntes, kbAntes] = [await hashArvore(raizVault), await hashArvore(path.join(real, 'kb'))];
  for (const args of [['kb', 'sync'], ['kb', 'quadrants'], ['quadrantes'], ['vault', 'plan'], ['mentor', 'contexto']]) {
    const resultado = run([...args, '--json'], { dataRoot: temp });
    assert.equal(resultado.status, 0, `${args.join(' ')}: ${resultado.stderr || resultado.stdout.slice(0, 300)}`);
    if (args[0] === 'quadrantes') console.log(`# quadrantes: ${JSON.stringify(resultado.json.contagem)}`);
  }
  assert.equal(await hashArvore(raizVault), vaultAntes, 'o Vault não pode mudar');
  assert.equal(await hashArvore(path.join(real, 'kb')), kbAntes, 'a base real não pode mudar');
});
