import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { makeLegado } from '../fixtures/make-legado.mjs';
import { loadConfig } from '../../core/config.mjs';
import { semanticDiff } from '../../core/migration/diff.mjs';
import { exportRollback } from '../../core/migration/legacy.mjs';
import { legacyBusy, runShadow } from '../../core/migration/shadow.mjs';

async function ambiente(t) {
  const root = await tempDir(t);
  const careerRoot = path.join(root, 'legacy/carreira');
  const curriculaRoot = path.join(root, 'legacy/curriculos');
  const dataRoot = path.join(root, 'data');
  await mkdir(path.join(careerRoot, 'busca-vagas'), { recursive: true });
  await mkdir(curriculaRoot, { recursive: true });
  await mkdir(dataRoot);
  const legado = path.join(careerRoot, 'pipeline-vagas.json');
  const pipeline = makeLegado({ vagas: 4, emails: 1, seed: 9 });
  await writeFile(legado, JSON.stringify(pipeline));
  await writeFile(path.join(careerRoot, 'busca-vagas/painel-vagas.html'), '<html></html>');
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ legado_path: legado, legacy_assets: path.join(careerRoot, 'busca-vagas'), legacy_materials: curriculaRoot }));
  const cli = (...args) => run([...args, '--json'], { dataRoot });
  const escreveLegado = async next => writeFile(legado, JSON.stringify(next));
  return { root, careerRoot, curriculaRoot, dataRoot, legado, pipeline, cli, escreveLegado };
}

async function arvore(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await arvore(full, base));
    else out.push(`${path.relative(base, full)}:${(await readFile(full)).length}`);
  }
  return out.sort();
}

test('migrate --dry-run --diff --json não escreve nada em DATA_ROOT e lista as diferenças', async t => {
  const a = await ambiente(t);
  assert.equal(a.cli('migrate').status, 0);
  const next = structuredClone(a.pipeline);
  next.vagas[0].status = 'status-novo';
  next.vagas.push({ ...next.vagas[1], id: 'empresa-alfa-nova' });
  await a.escreveLegado(next);
  const antes = await arvore(a.dataRoot);
  const result = a.cli('migrate', '--dry-run', '--diff');
  assert.equal(result.status, 1);
  assert.equal(result.json.diferencas, 2);
  assert.deepEqual(result.json.itens.map(i => i.tipo).sort(), ['alterado', 'somente_em_a']);
  assert.deepEqual(await arvore(a.dataRoot), antes);
});

test('modo shadow importa, informa gravacao_painel desligada e grava o relatório do dia', async t => {
  const a = await ambiente(t);
  const first = a.cli('migrate', '--shadow');
  assert.equal(first.status, 0, first.stdout);
  assert.equal(first.json.gravacao_painel, 'desligada');
  assert.equal(first.json.equal, true);
  assert.equal(first.json.diferencas, 0);
  const report = JSON.parse(await readFile(path.join(a.dataRoot, 'state/shadow-report.json'), 'utf8'));
  assert.equal(report.atual.ok, true);
  assert.equal(report.atual.gravacao_painel, 'desligada');
  assert.equal(report.atual.diferencas, 0);
  assert.equal(report.historico.length, 1);
});

test('o relatório acompanha um legado que muda entre rodadas (nova vaga e marcação)', async t => {
  const a = await ambiente(t);
  assert.equal(a.cli('migrate', '--shadow').status, 0);
  const next = structuredClone(a.pipeline);
  next.vagas[0].candidatura_usuario = { aplicada: true, data: '2026-10-14', origem: 'usuario-no-painel' };
  next.vagas.push({ ...next.vagas[1], id: 'empresa-alfa-nova' });
  next.atualizado = '2026-10-15';
  await a.escreveLegado(next);
  const second = a.cli('migrate', '--shadow');
  assert.equal(second.status, 0, second.stdout);
  const report = JSON.parse(await readFile(path.join(a.dataRoot, 'state/shadow-report.json'), 'utf8'));
  assert.equal(report.atual.mudancas_importadas, 2);
  assert.equal(report.atual.diferencas, 0);
  assert.ok(report.atual.eventos_adicionados >= 3);
  assert.equal(report.historico.length, 2);
  assert.equal(a.cli('verify').json.equal, true);
});

test('migrate --rollback --out regrava um legado equivalente (diff zero)', async t => {
  const a = await ambiente(t);
  assert.equal(a.cli('migrate', '--shadow').status, 0);
  const out = path.join(a.root, 'rollback.json');
  const result = a.cli('migrate', '--rollback', '--out', out);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(semanticDiff(a.pipeline, JSON.parse(await readFile(out, 'utf8'))).diferencas, 0);
});

test('o rollback nunca escreve no caminho do legado sem --confirmo-vault', async t => {
  const a = await ambiente(t);
  assert.equal(a.cli('migrate', '--shadow').status, 0);
  const original = await readFile(a.legado, 'utf8');
  const refused = a.cli('migrate', '--rollback', '--out', a.legado);
  assert.equal(refused.status, 2);
  assert.match(refused.json.error, /--confirmo-vault/);
  assert.equal(await readFile(a.legado, 'utf8'), original);
  assert.equal(a.cli('migrate', '--rollback', '--out', path.join(a.careerRoot, 'novo.json')).status, 2);
  const accepted = a.cli('migrate', '--rollback', '--out', a.legado, '--confirmo-vault');
  assert.equal(accepted.status, 0, accepted.stdout);
  assert.equal(semanticDiff(a.pipeline, JSON.parse(await readFile(a.legado, 'utf8'))).diferencas, 0);
  assert.equal(a.cli('migrate', '--confirmo-vault').status, 2);
});

test('legado travado por outro processo falha sem corromper projeção, log nem estado', async t => {
  const a = await ambiente(t);
  assert.equal(a.cli('migrate', '--shadow').status, 0);
  const config = await loadConfig({ dataRoot: a.dataRoot });
  const antes = await arvore(a.dataRoot);
  const next = structuredClone(a.pipeline);
  next.vagas[0].status = 'durante-a-escrita';
  await a.escreveLegado(next);
  await assert.rejects(runShadow({ ...config, legacyBusy: async () => true }), /em uso por outro processo/);
  const report = JSON.parse(await readFile(path.join(a.dataRoot, 'state/shadow-report.json'), 'utf8'));
  assert.equal(report.atual.ok, false);
  assert.match(report.atual.erro, /em uso/);
  const depois = (await arvore(a.dataRoot)).filter(item => !item.startsWith('state'));
  assert.deepEqual(depois, antes.filter(item => !item.startsWith('state')));
  assert.equal(a.cli('verify').json.equal, true);
});

test('a sonda de lock do legado não vê lock inexistente nem arquivo comum como ocupado', async t => {
  const a = await ambiente(t);
  assert.equal(await legacyBusy(a.legado), false);
  await writeFile(a.legado.replace(/\.json$/, '.lock'), '0');
  assert.equal(await legacyBusy(a.legado), false);
});

test('o caminho do legado vem de legado_path no config.yml; sem ele o comando pede a configuração', async t => {
  const dataRoot = await tempDir(t);
  const semConfig = run(['migrate', '--dry-run', '--json'], { dataRoot });
  assert.equal(semConfig.status, 2);
  assert.match(semConfig.json.error, /legado_path/);
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ legacy_assets: '/x', legacy_materials: '/y' }));
  const semCaminho = run(['migrate', '--shadow', '--json'], { dataRoot });
  assert.equal(semCaminho.status, 2);
  assert.match(semCaminho.json.error, /legado_path/);
  assert.deepEqual(await readdir(dataRoot), ['config.yml']);
});

test('exportRollback direto: destino existente fora da origem não é sobrescrito', async t => {
  const a = await ambiente(t);
  assert.equal(a.cli('migrate', '--shadow').status, 0);
  const out = path.join(a.root, 'fora.json');
  await writeFile(out, '{}');
  await assert.rejects(exportRollback({ dataRoot: a.dataRoot, destination: out, careerRoot: a.careerRoot, curriculaRoot: a.curriculaRoot }), /EEXIST|existe/);
});

test('em modo ativo, reimportar do legado é recusado e nunca devolve o modo para shadow', async t => {
  const a = await ambiente(t);
  assert.equal(a.cli('migrate', '--shadow').status, 0);
  const estadoArquivo = path.join(a.dataRoot, 'state/migration.json');
  const estado = JSON.parse(await readFile(estadoArquivo, 'utf8'));
  await writeFile(estadoArquivo, JSON.stringify({ ...estado, mode: 'ativo' }));
  const next = structuredClone(a.pipeline);
  next.vagas[0].status = 'mudou-no-legado';
  await a.escreveLegado(next);
  const semRelatorio = async () => (await arvore(a.dataRoot)).filter(item => !/^state[\\/]shadow-report/.test(item));
  const antes = await semRelatorio();
  for (const args of [['migrate', '--shadow'], ['migrate'], ['migrate', '--from', a.legado]]) {
    const result = a.cli(...args);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.json.error, /modo ativo/i, args.join(' '));
    assert.equal(JSON.parse(await readFile(estadoArquivo, 'utf8')).mode, 'ativo', args.join(' '));
    assert.deepEqual(await semRelatorio(), antes, args.join(' '));
  }
  // consulta continua liberada
  assert.equal(a.cli('migrate', '--dry-run', '--diff').status, 1);
  assert.equal(a.cli('verify').json.equal, true);
});

test('estado de migração ilegível também bloqueia a reimportação (falha fechada)', async t => {
  const a = await ambiente(t);
  assert.equal(a.cli('migrate', '--shadow').status, 0);
  await writeFile(path.join(a.dataRoot, 'state/migration.json'), '{quebrado');
  const result = a.cli('migrate', '--shadow');
  assert.equal(result.status, 2);
  assert.match(result.json.error, /estado de migração/i);
});

const snapshots = async dataRoot => (await readdir(path.join(dataRoot, 'backups'))).sort();
const novaVersaoDoLegado = async (a, n) => writeFile(path.join(a.careerRoot, 'busca-vagas/painel-vagas.html'), `<html>versao ${n}</html>`);

test('backups: nada mudou, nada é copiado; mudou, vira um snapshot novo', async t => {
  const a = await ambiente(t);
  assert.equal(a.cli('migrate', '--shadow').status, 0);
  const [unico] = await snapshots(a.dataRoot);
  const copia = path.join(a.dataRoot, 'backups', unico, 'carreira/busca-vagas/painel-vagas.html');
  const antes = (await stat(copia)).mtimeMs;
  await new Promise(done => setTimeout(done, 30));
  assert.equal(a.cli('migrate', '--shadow').status, 0);
  assert.deepEqual(await snapshots(a.dataRoot), [unico]);
  assert.equal((await stat(copia)).mtimeMs, antes, 'o arquivo do snapshot não pode ser recopiado');
  await novaVersaoDoLegado(a, 1);
  assert.equal(a.cli('migrate', '--shadow').status, 0);
  assert.equal((await snapshots(a.dataRoot)).length, 2);
});

test('backups: retém só os 3 snapshots mais recentes por padrão e preserva o do estado atual', async t => {
  const a = await ambiente(t);
  const vistos = [];
  for (let n = 0; n < 6; n++) {
    await novaVersaoDoLegado(a, n);
    const result = a.cli('migrate', '--shadow');
    assert.equal(result.status, 0, result.stdout);
    vistos.push(path.basename(result.json.snapshotRoot));
  }
  const restantes = await snapshots(a.dataRoot);
  assert.equal(restantes.length, 3);
  assert.deepEqual(restantes, vistos.slice(-3).sort());
  const estado = JSON.parse(await readFile(path.join(a.dataRoot, 'state/migration.json'), 'utf8'));
  assert.ok(restantes.includes(path.basename(estado.snapshotRoot)));
  assert.equal(a.cli('verify').json.equal, true);
});

test('backups: a retenção é configurável (backups_retidos) e valor inválido é recusado', async t => {
  const a = await ambiente(t);
  const configFile = path.join(a.dataRoot, 'config.yml');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  await writeFile(configFile, JSON.stringify({ ...config, backups_retidos: 1 }));
  for (let n = 0; n < 3; n++) { await novaVersaoDoLegado(a, n); assert.equal(a.cli('migrate', '--shadow').status, 0); }
  assert.equal((await snapshots(a.dataRoot)).length, 1);
  for (const invalido of [0, -1, 1.5, '3', null]) {
    await writeFile(configFile, JSON.stringify({ ...config, backups_retidos: invalido }));
    const result = a.cli('migrate', '--dry-run');
    assert.equal(result.status, 2, String(invalido));
    assert.match(result.json.error, /backups_retidos/);
  }
});

test('rollback --confirmo-vault guarda cópia do legado atual antes de regravá-lo', async t => {
  const a = await ambiente(t);
  assert.equal(a.cli('migrate', '--shadow').status, 0);
  const antes = await readFile(a.legado, 'utf8');
  const result = a.cli('migrate', '--rollback', '--out', a.legado, '--confirmo-vault');
  assert.equal(result.status, 0, result.stdout);
  assert.ok(result.json.backup, 'informa onde ficou a cópia');
  assert.equal(await readFile(result.json.backup, 'utf8'), antes);
  assert.ok(path.resolve(result.json.backup).startsWith(path.resolve(a.dataRoot)), 'a cópia fica em DATA_ROOT, fora do legado');
});

test('rollback --confirmo-vault recusa se o legado mudou depois da última importação (mais novo que a sombra)', async t => {
  const a = await ambiente(t);
  assert.equal(a.cli('migrate', '--shadow').status, 0);
  const mudou = structuredClone(a.pipeline);
  mudou.vagas.push({ ...mudou.vagas[0], id: 'empresa-alfa-posterior' });
  mudou.atualizado = '2099-01-01';
  await a.escreveLegado(mudou);
  const conteudo = await readFile(a.legado, 'utf8');
  const result = a.cli('migrate', '--rollback', '--out', a.legado, '--confirmo-vault');
  assert.equal(result.status, 2);
  assert.match(result.json.error, /legado.*(mais novo|alterado)/i);
  assert.equal(await readFile(a.legado, 'utf8'), conteudo, 'o legado não pode ser tocado');
  assert.equal(await arvoreTemBackup(a.dataRoot), false, 'e nenhuma cópia é criada quando recusa');
});

test('rollback --confirmo-vault respeita o lock do legado (antes de copiar e antes de gravar)', async t => {
  const a = await ambiente(t);
  assert.equal(a.cli('migrate', '--shadow').status, 0);
  const conteudo = await readFile(a.legado, 'utf8');
  const base = { dataRoot: a.dataRoot, destination: a.legado, careerRoot: a.careerRoot, curriculaRoot: a.curriculaRoot, confirmoVault: true };
  await assert.rejects(exportRollback({ ...base, legacyBusy: async () => true }), /em uso por outro processo/);
  // o lock aparece só depois da cópia: na segunda sondagem
  let chamadas = 0;
  await assert.rejects(exportRollback({ ...base, legacyBusy: async () => ++chamadas > 1 }), /em uso por outro processo/);
  assert.equal(await readFile(a.legado, 'utf8'), conteudo);
});

async function arvoreTemBackup(dataRoot) { return (await arvore(dataRoot)).some(item => /rollback-backups/.test(item)); }

test('vaga que sumiu do legado: recusa por padrão; com --aceitar-ausentes importa o resto e nunca apaga a vaga', async t => {
  const a = await ambiente(t);
  assert.equal(a.cli('migrate', '--shadow').status, 0);
  const next = structuredClone(a.pipeline);
  const [sumida] = next.vagas.splice(1, 1);
  next.vagas[0].status = 'mudou-depois-que-uma-sumiu';
  await a.escreveLegado(next);
  const recusado = a.cli('migrate', '--shadow');
  assert.equal(recusado.status, 2);
  assert.match(recusado.json.error, /ausentes/i);
  assert.match(recusado.json.error, /--aceitar-ausentes/);
  const aceito = a.cli('migrate', '--shadow', '--aceitar-ausentes');
  assert.equal(aceito.status, 0, aceito.stdout);
  assert.deepEqual(aceito.json.ausentes_aceitas, [sumida.id]);
  assert.equal(aceito.json.equal, true);
  assert.equal(aceito.json.diferencas, 0);
  const projecao = JSON.parse(await readFile(path.join(a.dataRoot, 'projections/pipeline-vagas.json'), 'utf8'));
  assert.ok(projecao.vagas.some(v => v.id === sumida.id), 'a vaga continua na projeção (nada é apagado)');
  assert.equal(projecao.vagas.find(v => v.id === next.vagas[0].id).status, 'mudou-depois-que-uma-sumiu');
  assert.equal(a.cli('verify').json.equal, true);
  // a opção é explícita: sem ela a recusa continua valendo na rodada seguinte
  assert.equal(a.cli('migrate', '--shadow').status, 2);
  // dry-run com a opção também enxerga a diferença como aceita
  assert.equal(a.cli('migrate', '--dry-run', '--diff', '--aceitar-ausentes').json.diferencas, 0);
});

test('--aceitar-ausentes não combina com --rollback nem --from', async t => {
  const a = await ambiente(t);
  assert.equal(a.cli('migrate', '--rollback', '--out', path.join(a.root, 'x.json'), '--aceitar-ausentes').status, 2);
  assert.equal(a.cli('migrate', '--from', a.legado, '--aceitar-ausentes').status, 2);
});
