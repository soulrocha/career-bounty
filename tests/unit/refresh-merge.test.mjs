import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { CONFIG } from '../golden/make-vagas-regras.mjs';
import { cenarios } from '../golden/make-cenarios-merge.mjs';
import { CAMPOS_PROTEGIDOS, mergePipeline } from '../../core/dedup/merge.mjs';
import { roleKey } from '../../core/dedup/keys.mjs';
import { canonicalize } from '../../core/store/canonicalize.mjs';
import { MOTIVO_FORA_DA_REGIAO } from '../../core/score/constraints.mjs';

const golden = JSON.parse(await readFile(new URL('../golden/refresh-merge.json', import.meta.url), 'utf8'));
const dom = (...parts) => parts.join('.');
const executa = cenario => mergePipeline({ pipeline: cenario.pipeline, historico: cenario.historico ?? undefined, pesquisas: cenario.pesquisas, ajustes: cenario.ajustes, config: cenario.config, hoje: cenario.hoje }).pipeline;

test('a golden de merge é regenerável pelos mesmos cenários sintéticos (sem deriva)', () => {
  assert.ok(golden.cenarios.length >= 150);
  assert.deepEqual(golden.cenarios.map(({ saida, erro, ...entrada }) => entrada), JSON.parse(JSON.stringify(cenarios())));
});

test('100% da golden: o merge em Node produz o mesmo pipeline que o refresh.py', () => {
  const divergentes = [];
  for (const cenario of golden.cenarios) {
    let obtido;
    try { obtido = executa(cenario); } catch { divergentes.push(`${cenario.nome}: Node lançou erro`); continue; }
    if (JSON.stringify(canonicalize(JSON.parse(JSON.stringify(obtido).replaceAll(MOTIVO_FORA_DA_REGIAO, 'Presença fora de BH/região metropolitana')))) !== JSON.stringify(canonicalize(cenario.saida))) divergentes.push(cenario.nome);
  }
  assert.deepEqual(divergentes, []);
});

const base = { empresa: 'Empresa Alfa', cargo: 'Manager', url: 'https://vagas.exemplo.test/jobs/123456', regime: 'CLT', modalidade: 'remoto', local: 'Brasil', salario: null };
const merge = (antigas, novas, extra = {}) => mergePipeline({ pipeline: { schema_version: 1, vagas: antigas }, pesquisas: [{ nome: 'pesquisa-a.json', mtime: '2026-10-09', vagas: novas }], config: CONFIG, hoje: '2026-10-14', ...extra }).pipeline;

test('destino mais novo só substitui application_url quando a observação é estritamente posterior', () => {
  const velho = `https://old.${dom('gupy', 'io')}/jobs/123456`;
  const novo = `https://jobs.${dom('lever', 'co')}/company/abc`;
  const casos = [['2026-10-08', novo, velho, novo], ['2026-10-08', null, velho, velho], ['2026-10-06', novo, velho, velho], ['2026-10-07', novo, velho, velho], ['2026-10-06', novo, null, novo]];
  for (const [data, url, anterior, esperado] of casos) {
    const antiga = { ...base, id: 'original', consultado_em: '2026-10-07', status: 'candidatura-enviada-confirmada', ...(anterior ? { application_url: anterior } : {}) };
    const nova = { ...base, consultado_em: data, url_status: 'aberta', aderencia: 'boa', ...(url ? { application_url: url } : {}) };
    const [resultado] = merge([antiga], [nova]).vagas;
    assert.equal(resultado.application_url, esperado, `${data} ${url} ${anterior}`);
    assert.equal(resultado.portal_candidatura, esperado === velho ? 'Gupy' : 'Lever');
  }
});

test('campos protegidos nunca são sobrescritos pela descoberta', () => {
  const protegidos = { curriculo: 'enviado.pdf', comprovante_envio: { recibo: 'original' }, candidatura_usuario: { aplicada: true, data: '2026-10-07' }, historico_marcacoes: [{ original: true }], descarte_usuario: { descartada: true }, historico_descartes: [{ original: true }] };
  for (const campo of Object.keys(protegidos)) assert.ok(CAMPOS_PROTEGIDOS.includes(campo), campo);
  const antiga = { ...base, id: 'original', status: 'candidatura-enviada-confirmada', ...protegidos };
  const nova = { ...base, consultado_em: '2026-10-12', url_status: 'aberta', aderencia: 'boa', curriculo: 'outro.pdf', comprovante_envio: { recibo: 'falso' }, candidatura_usuario: { aplicada: false }, historico_marcacoes: [], descarte_usuario: { descartada: false }, historico_descartes: [] };
  const [resultado] = merge([antiga], [nova]).vagas;
  for (const [campo, valor] of Object.entries(protegidos)) assert.deepEqual(resultado[campo], valor, campo);
  assert.equal(resultado.id, 'original');
});

test('duas descobertas da mesma requisição viram uma vaga, com as duas URLs em republicacoes', () => {
  const direta = { ...base, url: `https://empresa-alfa.${dom('gupy', 'io')}/jobs/24681357`, consultado_em: '2026-10-08', fontes: ['a'] };
  const replica = { ...base, empresa: 'Outra grafia', cargo: 'Outro cargo', url: `https://empresa-alfa.${dom('gupy', 'io')}/job/${Buffer.from(JSON.stringify({ jobId: 24681357 })).toString('base64')}`, consultado_em: '2026-10-09', fontes: ['b'] };
  const { vagas } = merge([], [direta, replica]);
  assert.equal(vagas.length, 1);
  assert.deepEqual(vagas[0].republicacoes, [{ empresa: 'Empresa Alfa', url: direta.url, cargo: 'Manager' }]);
  assert.deepEqual(vagas[0].fontes, ['a', 'b']);
  assert.equal(roleKey(direta), roleKey(replica));
});

test('mesmo cargo e empresa sem ID, em URLs diferentes, não funde', () => {
  const a = { ...base, url: 'https://vagas.exemplo.test/posicao/a' };
  const b = { ...base, url: 'https://vagas.exemplo.test/posicao/b' };
  assert.equal(merge([], [a, b]).vagas.length, 2);
  assert.equal(merge([], [a, { ...a }]).vagas.length, 1);
});

test('vaga aplicada nunca volta a "recomendar": status e histórico são preservados', () => {
  const antiga = { ...base, id: 'x', status: 'candidatura-enviada-informada-pelo-usuario', candidatura_usuario: { aplicada: true, data: '2026-10-07' } };
  const nova = { ...base, consultado_em: '2026-10-12', url_status: 'aberta', aderencia: 'alta' };
  const [resultado] = merge([antiga], [nova]).vagas;
  assert.equal(resultado.status, 'candidatura-enviada-informada-pelo-usuario');
  assert.equal(resultado.historico, true);
  const comEmail = { ...base, id: 'y', url: 'https://vagas.exemplo.test/jobs/222222', candidatura_email: { aplicada: true } };
  const [segundo] = merge([comEmail], [{ ...comEmail, status: undefined, candidatura_email: undefined, consultado_em: '2026-10-12' }]).vagas;
  assert.equal(segundo.historico_anterior, true);
  assert.equal(segundo.status, 'avaliada-sem-envio');
});

test('o merge não altera o pipeline de entrada', () => {
  const entrada = { schema_version: 1, vagas: [{ ...base, id: 'x', status: 'nova' }] };
  const copia = structuredClone(entrada);
  mergePipeline({ pipeline: entrada, pesquisas: [{ nome: 'p.json', mtime: '2026-10-09', vagas: [{ ...base, aderencia: 'alta' }] }], config: CONFIG, hoje: '2026-10-14' });
  assert.deepEqual(entrada, copia);
});
