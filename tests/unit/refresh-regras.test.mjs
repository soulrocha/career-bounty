import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { CONFIG, casosRegras } from '../golden/make-vagas-regras.mjs';
import { curriculoNecessario, portalCandidatura } from '../../core/apply/portal.mjs';
import { canonicalUrl, companyKey, idFor, roleKey } from '../../core/dedup/keys.mjs';
import { constraints, MOTIVO_FORA_DA_REGIAO } from '../../core/score/constraints.mjs';

const golden = JSON.parse(await readFile(new URL('../golden/refresh-regras.json', import.meta.url), 'utf8'));

const funcoes = {
  canonicalUrl: e => canonicalUrl(e.url),
  company_key: e => companyKey(e.nome),
  role_key: e => roleKey(e.job),
  id_for: e => idFor(e.job),
  portal_candidatura: e => portalCandidatura(e.job),
  curriculo_necessario: e => curriculoNecessario(e.job, e.config),
  constraints: e => constraints(e.job, e.config),
};

test('a golden cobre as sete funções e é regenerável pelas mesmas entradas sintéticas', () => {
  assert.ok(golden.casos.length > 900);
  assert.deepEqual([...new Set(golden.casos.map(c => c.funcao))].sort(), Object.keys(funcoes).sort());
  // a entrada gravada na golden é exatamente a que o gerador sintético produz hoje (sem deriva)
  const gerado = JSON.parse(JSON.stringify(casosRegras()));
  assert.deepEqual(golden.casos.map(({ funcao, entrada }) => ({ funcao, entrada })), gerado);
});

test('100% da golden: cada função Node devolve a saída gravada do Python (ou falha onde o Python falhou)', () => {
  const divergencias = [];
  for (const [index, caso] of golden.casos.entries()) {
    let obtido;
    let falhou = false;
    try { obtido = funcoes[caso.funcao](caso.entrada); } catch { falhou = true; }
    if (Object.hasOwn(caso, 'erro')) { if (!falhou) divergencias.push(`#${index} ${caso.funcao}: o Python falha (${caso.erro}) e o Node não`); continue; }
    if (falhou) { divergencias.push(`#${index} ${caso.funcao}: o Node lançou erro e o Python não`); continue; }
    // O texto do legado nomeava a cidade; o Node usa o texto genérico da região configurada. O resto da saída é idêntico.
    try { assert.deepEqual(JSON.parse(JSON.stringify(obtido).replaceAll(MOTIVO_FORA_DA_REGIAO, 'Presença fora de BH/região metropolitana')), caso.saida); } catch { divergencias.push(`#${index} ${caso.funcao}`); }
  }
  assert.deepEqual(divergencias, []);
});

const job = extra => ({ empresa: 'Empresa Alfa', cargo: 'Gestor', url: 'https://vagas.exemplo.test/jobs/123456', regime: 'CLT', modalidade: 'remoto', local: 'Brasil', salario: null, ...extra });

test('salário desconhecido deixa a situação pendente', () => {
  assert.equal(constraints(job(), CONFIG).situacao, 'pendente');
});

test('URL Gupy codificada e direta com o mesmo ID dão a mesma chave de vaga', () => {
  const host = ['empresa-alfa', 'gupy', 'io'].join('.');
  const direta = { empresa: 'Empresa Alfa', cargo: 'A', url: `https://${host}/jobs/24681357` };
  const codificada = { empresa: 'Outra grafia', cargo: 'B', url: `https://${host}/job/${Buffer.from(JSON.stringify({ jobId: 24681357, source: 'gupy_portal' })).toString('base64')}` };
  assert.equal(roleKey(direta), roleKey(codificada));
  assert.equal(roleKey(direta), 'gupy:24681357');
});

test('remoto fora do Brasil é incompatível', () => {
  assert.equal(constraints(job({ elegivel_brasil: false }), CONFIG).situacao, 'incompativel');
});

test('cv_skip_portals dispensa o currículo do portal listado e só dele', () => {
  const gupy = job({ url: `https://x.${['gupy', 'io'].join('.')}/jobs/1` });
  assert.equal(curriculoNecessario(gupy, { cv_skip_portals: ['gupy'] }), false);
  assert.equal(curriculoNecessario(gupy, {}), false);
  assert.equal(curriculoNecessario(gupy, { cv_skip_portals: [] }), true);
  assert.equal(curriculoNecessario(job(), { cv_skip_portals: ['gupy'] }), true);
});

test('piso de CLT remoto e PJ: no limite atende, um abaixo é incompatível', () => {
  assert.equal(constraints(job({ salario: CONFIG.clt.remote_hybrid_min }), CONFIG).situacao, 'atende');
  assert.equal(constraints(job({ salario: CONFIG.clt.remote_hybrid_min - 1 }), CONFIG).situacao, 'incompativel');
  assert.equal(constraints(job({ regime: 'PJ', salario: CONFIG.pj.min - 1 }), CONFIG).situacao, 'incompativel');
});

test('entrada nula ou vazia nunca lança nas funções de tratamento de texto e portal', () => {
  for (const vazio of [undefined, null, {}, { url: null, empresa: null, cargo: null }]) {
    assert.doesNotThrow(() => roleKey(vazio));
    assert.doesNotThrow(() => idFor(vazio));
    assert.doesNotThrow(() => portalCandidatura(vazio));
    assert.doesNotThrow(() => constraints(vazio, CONFIG));
  }
  assert.doesNotThrow(() => canonicalUrl(null));
  assert.doesNotThrow(() => companyKey(undefined));
});

test('apelidos de empresa vêm da configuração, não do código', () => {
  const a = { empresa: 'Empresa Alfa Carreiras', cargo: 'Gestor' };
  const b = { empresa: 'Empresa Alfa', cargo: 'Gestor' };
  assert.notEqual(roleKey(a), roleKey(b));
  const aliases = { 'empresa alfa carreiras': 'empresaalfa' };
  assert.equal(roleKey(a, { aliases }), roleKey(b, { aliases }));
});

test('portal privado de recrutamento vem da configuração (portais_extras), não do código', () => {
  const vaga = { url: 'https://vagas.empresa-exemplo.test/vaga/1' };
  assert.equal(portalCandidatura(vaga), 'Pendente');
  const config = { ...CONFIG, portais_extras: { 'Portal Exemplo': ['empresa-exemplo.test'] } };
  assert.equal(portalCandidatura(vaga, config), 'Portal Exemplo');
  assert.equal(portalCandidatura({ url: 'https://empresa-exemplo.test/vaga/1' }, config), 'Portal Exemplo');
  assert.equal(portalCandidatura({ url: 'https://outra-empresa-exemplo.test/vaga/1' }, config), 'Pendente');
  assert.equal(portalCandidatura({ url: 'https://boards.greenhouse.io/x/jobs/1' }, config), 'Greenhouse');
  assert.equal(curriculoNecessario(vaga, { ...config, cv_skip_portals: ['Portal Exemplo'] }), false);
  assert.equal(curriculoNecessario(vaga, { ...config, cv_skip_portals: [] }), true);
});

test('motivo de presença fora da região não nomeia cidade e vale para qualquer regiao_presencial', () => {
  const resultado = constraints(job({ modalidade: 'presencial', local: 'Cidade Distante' }), { ...CONFIG, regiao_presencial: ['cidade perto'] });
  assert.equal(resultado.situacao, 'incompativel');
  assert.deepEqual(resultado.motivos, [MOTIVO_FORA_DA_REGIAO]);
  assert.doesNotMatch(MOTIVO_FORA_DA_REGIAO, /BH|Belo|metropolitana/i);
});
