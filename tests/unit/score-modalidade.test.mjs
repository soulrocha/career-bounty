import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { hardFilter } from '../../core/score/hard.mjs';
import { triagemPre } from '../../core/score/prescore.mjs';
import { makeVaga } from '../../core/sources/vaga.mjs';
import { validateSettings } from '../../core/config.mjs';

const criterios = { regiao_presencial: ['cidade exemplo', 'ce'], titulos_alvo: ['gerente de engenharia'] };
const v = extra => makeVaga({ fonte: 'a', portal: 'gupy', requisicao_id: '1', empresa: 'Empresa Alfa', cargo: 'Gerente de Engenharia', local: 'Outra Cidade, SP', modalidade: 'hibrido', regime: 'CLT',
  url: 'https://x.exemplo.test/1', descricao: 'Liderança de times.', ...extra });

// ---- Região citada no título (vaga com várias cidades) ----

test('híbrida com a região no título não é descartada, mesmo com outra cidade no local', () => {
  const r = hardFilter(v({ cargo: 'Gerente de Engenharia | Outra Cidade, Terceira Cidade ou Cidade Exemplo' }), criterios);
  assert.equal(r.descartada, false, r.motivos.join('; '));
});

test('sigla da região só casa como palavra inteira no título', () => {
  assert.equal(hardFilter(v({ cargo: 'Gerente de Engenharia | Remoto ou CE' }), criterios).descartada, false);
  const dentro = hardFilter(v({ cargo: 'Gerente de Engenharia de Licenças' }), criterios);
  assert.equal(dentro.descartada, true);
  assert.match(dentro.motivos.join(' '), /fora da região/);
});

// ---- Modalidades aceitas e preferida ----

test('modalidade fora das aceitas é descartada; modalidade desconhecida não', () => {
  const pref = { ...criterios, modalidades: ['remoto', 'hibrido'] };
  const presencial = hardFilter(v({ modalidade: 'presencial', local: 'Cidade Exemplo, MG' }), pref);
  assert.equal(presencial.descartada, true);
  assert.deepEqual(presencial.motivos, ['Modalidade fora das preferências (aceitas: remoto, hibrido)']);
  assert.equal(hardFilter(v({ modalidade: 'remoto' }), pref).descartada, false);
  assert.equal(hardFilter(v({ modalidade: 'híbrido', local: 'Cidade Exemplo, MG' }), pref).descartada, false);
  assert.equal(hardFilter(v({ modalidade: null, local: 'Cidade Exemplo, MG' }), pref).descartada, false);
});

test('sem modalidades configuradas, as três seguem aceitas', () => {
  assert.equal(hardFilter(v({ modalidade: 'presencial', local: 'Cidade Exemplo, MG' }), criterios).descartada, false);
});

test('a modalidade preferida pontua mais que as outras aceitas', () => {
  const pref = { ...criterios, modalidades: ['remoto', 'hibrido', 'presencial'], modalidade_preferida: 'remoto' };
  const remoto = triagemPre(v({ modalidade: 'remoto' }), pref);
  const hibrido = triagemPre(v({ modalidade: 'hibrido', local: 'Cidade Exemplo, MG' }), pref);
  const presencial = triagemPre(v({ modalidade: 'presencial', local: 'Cidade Exemplo, MG' }), pref);
  assert.ok(remoto.pre_score > hibrido.pre_score, `${remoto.pre_score} > ${hibrido.pre_score}`);
  assert.ok(hibrido.pre_score > presencial.pre_score, `${hibrido.pre_score} > ${presencial.pre_score}`);
  assert.ok(remoto.motivos.includes('Modalidade preferida: remoto'));
});

test('configuração valida modalidades e exige a preferida entre as aceitas', () => {
  const ok = validateSettings({ radar: { criterios: { modalidades: ['Remoto', 'híbrido'], modalidade_preferida: 'remoto' } } });
  assert.deepEqual(ok.radar.criterios.modalidades, ['remoto', 'hibrido']);
  assert.equal(ok.radar.criterios.modalidade_preferida, 'remoto');
  assert.throws(() => validateSettings({ radar: { criterios: { modalidades: ['teletrabalho'] } } }), /modalidades/);
  assert.throws(() => validateSettings({ radar: { criterios: { modalidades: [] } } }), /modalidades/);
  assert.throws(() => validateSettings({ radar: { criterios: { modalidades: ['hibrido'], modalidade_preferida: 'remoto' } } }), /modalidade_preferida/);
});

// ---- Comando preferencias (usado pelo /setup depois de perguntar) ----

test('preferencias grava modalidades, preferida e região sem apagar o resto do config', async t => {
  const dataRoot = await tempDir(t);
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ panel: { port: 8899 }, radar: { termos: ['gerente'], criterios: { titulos_alvo: ['gerente'] } } }));
  const r = run(['preferencias', '--modalidades', 'remoto,hibrido,presencial', '--preferida', 'remoto', '--regiao', 'Cidade Exemplo, Cidade Vizinha', '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stderr);
  const config = JSON.parse(await readFile(path.join(dataRoot, 'config.yml'), 'utf8'));
  assert.equal(config.panel.port, 8899);
  assert.deepEqual(config.radar.termos, ['gerente']);
  assert.deepEqual(config.radar.criterios, { titulos_alvo: ['gerente'], modalidades: ['remoto', 'hibrido', 'presencial'], modalidade_preferida: 'remoto', regiao_presencial: ['cidade exemplo', 'cidade vizinha'] });
});

test('preferencias recusa valor inválido e não altera o arquivo', async t => {
  const dataRoot = await tempDir(t);
  const original = JSON.stringify({ radar: { criterios: {} } });
  await writeFile(path.join(dataRoot, 'config.yml'), original);
  const r = run(['preferencias', '--modalidades', 'hibrido', '--preferida', 'remoto'], { dataRoot });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /modalidade_preferida/);
  assert.equal(await readFile(path.join(dataRoot, 'config.yml'), 'utf8'), original);
});

test('preferencias sem nenhuma opção mostra as preferências atuais', async t => {
  const dataRoot = await tempDir(t);
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ radar: { criterios: { modalidades: ['remoto'], modalidade_preferida: 'remoto' } } }));
  const r = run(['preferencias', '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { modalidades: ['remoto'], modalidade_preferida: 'remoto', regiao_presencial: [], definidas: true });
});
