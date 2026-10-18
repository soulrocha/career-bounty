// Segurança do envio automático (revisão do PR #8): cada teste prova um furo achado na revisão independente, usando o
// orquestrador com o driver REAL contra um portal sintético local, e não um driver de mentira.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { HOJE, bancoPersona } from '../helpers/apply.mjs';
import { tempDir } from '../helpers/cli.mjs';
import { semNavegador } from '../helpers/navegador.mjs';
import { servidorPortais } from '../helpers/servidor-portais.mjs';
import { abrirNavegador } from '../../core/browser/cdp.mjs';
import { consumirAprovacao, emitirAprovacaoPolitica, lerAprovacoes } from '../../core/apply/approval.mjs';
import { hashRespostas } from '../../core/apply/drivers/base.mjs';
import { PORTAIS } from '../../core/apply/drivers/portais.mjs';
import { pausarEnvio } from '../../core/apply/policy/killswitch.mjs';
import { reservarEnvio, concluirEnvio } from '../../core/apply/policy/limits.mjs';
import { orquestrarEnvio } from '../../core/apply/policy/orquestrador.mjs';
import { readEvents } from '../../core/store/events.mjs';

const TS = '2026-10-18T14:00:00.000Z';
const regra = (id, extra = {}) => ({ id, acao: 'enviar_automatico', limite_dia: 3, quando: { portal: ['greenhouse'], aderencia: ['alta'], rascunhos_llm: 0, respostas_novas_na_rodada: 0, cv_gate: 'ok', ja_aplicada: false }, ...extra });
const candidatura = (url, extra = {}) => ({ id: 'vaga-s1', portal: 'greenhouse', aderencia: 'alta', rascunhos_llm: 0, respostas_novas_na_rodada: 0, cv_gate: 'ok', ja_aplicada: false, url, ...extra });
const portaisLocais = s => ({ ...PORTAIS, greenhouse: { ...PORTAIS.greenhouse, origens: [s.origin] } });

async function ambiente(t) {
  const dataRoot = await tempDir(t);
  const dir = await tempDir(t);
  const caminho = path.join(dir, 'cv-ats.pdf');
  await writeFile(caminho, '%PDF-1.4 cv ficticio');
  const cv = { caminho, sha256: createHash('sha256').update(await readFile(caminho)).digest('hex') };
  return { dataRoot, cv, respostas: bancoPersona() };
}
const rodar = (a, s, extra = {}) => orquestrarEnvio({ dataRoot: a.dataRoot, regras: [regra('r1')], candidatura: candidatura(s.url('/greenhouse')), respostas: a.respostas, cv: a.cv, hoje: HOJE, ts: TS, dryRun: false, portais: portaisLocais(s), ...extra });
const resultados = async dataRoot => (await readEvents(dataRoot)).eventos.filter(e => e.tipo === 'envio.concluido').map(e => e.dados.resultado);

test('contexto incompleto nunca libera o envio: o orquestrador não preenche padrões', async t => {
  const a = await ambiente(t);
  let chamou = false;
  const r = await orquestrarEnvio({ dataRoot: a.dataRoot, regras: [regra('r1')], ts: TS, dryRun: false, executarDriverFake: async () => { chamou = true; return { estado: 'enviada' }; },
    candidatura: { id: 'v', portal: 'greenhouse', aderencia: 'alta', url: 'https://boards.greenhouse.io/e/jobs/1' } });
  assert.equal(r.estado, 'parar_antes_de_enviar');
  assert.match(r.motivos.join(' '), /contexto incompleto/);
  assert.equal(chamou, false);
});

test('dryRun é o padrão do orquestrador: sem pedir envio real, nada é enviado', { skip: semNavegador }, async t => {
  const a = await ambiente(t);
  const s = await servidorPortais(t);
  const r = await rodar(a, s, { dryRun: undefined });
  assert.equal(r.estado, 'dry_run');
  assert.deepEqual(s.recebidos, []);
  assert.deepEqual((await lerAprovacoes(a.dataRoot)).aprovacoes, [], 'dry-run não emite aprovação');
});

test('só origens https do portal: domínio de atacante, http e credencial na URL são bloqueados antes do driver', async t => {
  const a = await ambiente(t);
  for (const url of ['https://atacante.example/form', 'http://boards.greenhouse.io/e/jobs/1', 'https://boards.greenhouse.io@atacante.example/e/jobs/1', 'https://boards.greenhouse.io.atacante.example/x', 'javascript:alert(1)']) {
    let chamou = false;
    const r = await orquestrarEnvio({ dataRoot: a.dataRoot, regras: [regra('r1')], candidatura: candidatura(url), ts: TS, dryRun: false, executarDriverFake: async () => { chamou = true; return { estado: 'enviada' }; } });
    assert.equal(r.estado, 'blocked', url);
    assert.equal(r.motivo, 'origem_nao_permitida', url);
    assert.equal(chamou, false, url);
  }
  assert.equal((await orquestrarEnvio({ dataRoot: a.dataRoot, regras: [regra('r1')], candidatura: candidatura('https://job-boards.greenhouse.io/e/jobs/1'), ts: TS, dryRun: true, executarDriverFake: async () => ({ estado: 'dry_run' }) })).estado, 'dry_run');
});

test('redirecionamento para fora do portal para antes de preencher: nada é enviado nem preenchido', { skip: semNavegador }, async t => {
  const a = await ambiente(t);
  const s = await servidorPortais(t);
  const atacante = await servidorPortais(t);
  const r = await rodar(a, s, { candidatura: candidatura(s.url(`/redirecionar?para=${encodeURIComponent(atacante.url('/greenhouse'))}`)) });
  assert.equal(r.estado, 'blocked');
  assert.equal(r.motivo, 'origem_inesperada');
  assert.deepEqual(atacante.recebidos, []);
  assert.deepEqual(s.recebidos, []);
});

test('página que já mostra texto de sucesso antes do envio é suspeita: bloqueia sem clicar', { skip: semNavegador }, async t => {
  const a = await ambiente(t);
  const s = await servidorPortais(t);
  const r = await rodar(a, s, { candidatura: candidatura(s.url('/greenhouse-sucesso-falso')) });
  assert.equal(r.estado, 'blocked');
  assert.equal(r.motivo, 'dom_suspeito');
  assert.deepEqual(s.recebidos, []);
});

test('kill switch acionado com o driver em voo (depois de abrir a página) impede o clique', { skip: semNavegador }, async t => {
  const a = await ambiente(t);
  const s = await servidorPortais(t);
  const abrir = async opcoes => {
    const browser = await abrirNavegador(opcoes);
    const nova = browser.novaPagina.bind(browser);
    browser.novaPagina = async () => {
      const p = await nova();
      const ir = p.ir.bind(p);
      p.ir = async url => { await ir(url); await pausarEnvio(a.dataRoot, { motivo: 'teste em voo', ts: TS }); };
      return p;
    };
    return browser;
  };
  const r = await rodar(a, s, { abrir });
  assert.equal(r.estado, 'blocked');
  assert.equal(r.motivo, 'envio_pausado');
  assert.deepEqual(s.recebidos, [], 'o portal não recebeu nada');
  assert.deepEqual(await resultados(a.dataRoot), ['bloqueou']);
});

test('envio real: o token da política é consumido uma vez, com os dois hashes, e a vaga não reenvia', { skip: semNavegador }, async t => {
  const a = await ambiente(t);
  const s = await servidorPortais(t);
  const r = await rodar(a, s);
  assert.equal(r.estado, 'enviada', JSON.stringify(r));
  assert.equal(s.recebidos.length, 1);
  const { aprovacoes } = await lerAprovacoes(a.dataRoot);
  assert.equal(aprovacoes.length, 1);
  assert.ok(aprovacoes[0].usada_em, 'aprovação consumida pelo driver');
  assert.equal(aprovacoes[0].hash_pdf, a.cv.sha256);
  assert.equal(aprovacoes[0].hash_respostas, hashRespostas(a.respostas));
  const de_novo = await rodar(a, s);
  assert.equal(de_novo.estado, 'blocked');
  assert.match(de_novo.motivo, /já enviada|em dúvida/);
  assert.equal(s.recebidos.length, 1, 'a mesma vaga não é enviada duas vezes');
});

test('PDF trocado depois da aprovação: o hash conferido na hora do clique bloqueia', { skip: semNavegador }, async t => {
  const a = await ambiente(t);
  const s = await servidorPortais(t);
  const abrir = async opcoes => {
    const browser = await abrirNavegador(opcoes);
    const nova = browser.novaPagina.bind(browser);
    browser.novaPagina = async () => {
      const p = await nova();
      const anexar = p.anexar.bind(p);
      p.anexar = async (...args) => { await anexar(...args); await writeFile(a.cv.caminho, '%PDF-1.4 OUTRO conteudo'); };
      return p;
    };
    return browser;
  };
  const r = await rodar(a, s, { abrir });
  assert.equal(r.estado, 'blocked');
  assert.equal(r.motivo, 'pdf_diferente');
  assert.deepEqual(s.recebidos, []);
});

test('desfecho incerto ou sem comprovante conta no limite e trava a vaga', async t => {
  const a = await ambiente(t);
  const regras = [regra('r1', { limite_dia: 1 })];
  const url = 'https://boards.greenhouse.io/e/jobs/1';
  const incerta = await orquestrarEnvio({ dataRoot: a.dataRoot, regras, candidatura: candidatura(url, { id: 'v1' }), ts: TS, dryRun: false, executarDriverFake: async () => ({ estado: 'incerta', motivo: 'tempo esgotado depois do clique' }) });
  assert.equal(incerta.estado, 'incerta');
  const outra = await orquestrarEnvio({ dataRoot: a.dataRoot, regras, candidatura: candidatura(url, { id: 'v2' }), ts: TS, dryRun: false, executarDriverFake: async () => ({ estado: 'enviada' }) });
  assert.equal(outra.estado, 'blocked', 'o limite do dia foi consumido pela tentativa incerta');
  assert.match(outra.motivo, /limite diário/);
  const mesma = await orquestrarEnvio({ dataRoot: a.dataRoot, regras: [regra('r1', { limite_dia: 9 })], candidatura: candidatura(url, { id: 'v1' }), ts: TS, dryRun: false, executarDriverFake: async () => ({ estado: 'enviada' }) });
  assert.equal(mesma.estado, 'blocked', 'a vaga em dúvida não é reenviada');
  assert.deepEqual(await resultados(a.dataRoot), ['incerta']);
});

test('enviada_sem_comprovante é registrada como incerta, nunca como enviou', async t => {
  const a = await ambiente(t);
  const r = await orquestrarEnvio({ dataRoot: a.dataRoot, regras: [regra('r1')], candidatura: candidatura('https://boards.greenhouse.io/e/jobs/1'), ts: TS, dryRun: false, executarDriverFake: async () => ({ estado: 'enviada_sem_comprovante' }) });
  assert.equal(r.estado, 'enviada_sem_comprovante');
  assert.deepEqual(await resultados(a.dataRoot), ['incerta']);
});

test('limite diário global vale entre regras diferentes', async t => {
  const a = await ambiente(t);
  const regras = [regra('r1', { limite_dia: 5, quando: { ...regra('x').quando, aderencia: ['alta'] } }), regra('r2', { limite_dia: 5, quando: { ...regra('x').quando, aderencia: ['media'] } })];
  const fake = async () => ({ estado: 'enviada' });
  const url = 'https://boards.greenhouse.io/e/jobs/1';
  assert.equal((await orquestrarEnvio({ dataRoot: a.dataRoot, regras, limiteGlobal: 1, candidatura: candidatura(url, { id: 'v1', aderencia: 'alta' }), ts: TS, dryRun: false, executarDriverFake: fake })).estado, 'enviada');
  const segunda = await orquestrarEnvio({ dataRoot: a.dataRoot, regras, limiteGlobal: 1, candidatura: candidatura(url, { id: 'v2', aderencia: 'media' }), ts: TS, dryRun: false, executarDriverFake: fake });
  assert.equal(segunda.estado, 'blocked');
  assert.match(segunda.motivo, /global/);
});

test('reservas concorrentes da mesma vaga: só uma passa', async t => {
  const a = await ambiente(t);
  const rs = await Promise.all(Array.from({ length: 4 }, (_, i) => reservarEnvio(a.dataRoot, { regraId: 'r1', limiteRegra: 9, vagaId: 'mesma', ts: new Date(Date.parse(TS) + i).toISOString() }).catch(() => ({ ok: false }))));
  assert.equal(rs.filter(r => r.ok).length, 1);
});

test('aprovação da política exige os dois hashes e só vale uma vez; a humana não é bloqueada por ela', async t => {
  const dataRoot = await tempDir(t);
  const hashes = { hashPdf: 'a'.repeat(64), hashRespostas: 'b'.repeat(64) };
  await emitirAprovacaoPolitica(dataRoot, { vagaId: 'v', ts: TS, ...hashes });
  assert.equal((await consumirAprovacao(dataRoot, { vagaId: 'v', ts: TS, contexto: 'driver' })).ok, false, 'hash ausente nega');
  assert.equal((await consumirAprovacao(dataRoot, { vagaId: 'v', ts: TS, contexto: 'driver', hashPdf: hashes.hashPdf })).ok, false, 'falta o hash das respostas');
  assert.equal((await consumirAprovacao(dataRoot, { vagaId: 'v', ts: TS, contexto: 'driver', ...hashes, hashRespostas: 'c'.repeat(64) })).ok, false);
  assert.equal((await consumirAprovacao(dataRoot, { vagaId: 'v', ts: TS, contexto: 'driver', ...hashes })).ok, true);
  assert.equal((await consumirAprovacao(dataRoot, { vagaId: 'v', ts: TS, contexto: 'driver', ...hashes })).ok, false, 'uso único');
});

test('concluirEnvio aceita o resultado incerta', async t => {
  const dataRoot = await tempDir(t);
  const r = await reservarEnvio(dataRoot, { regraId: 'r1', limiteRegra: 2, vagaId: 'v', ts: TS });
  await concluirEnvio(dataRoot, { reservaId: r.reserva_id, vagaId: 'v', resultado: 'incerta', ts: TS });
  assert.deepEqual(await resultados(dataRoot), ['incerta']);
});
