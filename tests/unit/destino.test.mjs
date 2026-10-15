import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from '../helpers/cli.mjs';
import { montarFila, parseDestino, reservarDestinos, registrarBloqueio, registrarDestino, EXTRATOR_JS } from '../../core/sources/destino.mjs';
import { buildLiveArgs } from '../../core/llm/runner.mjs';
import { readEvents } from '../../core/store/events.mjs';
import { projectEvents } from '../../core/store/project.mjs';
import { descobertaEvent } from '../../core/radar/collect.mjs';
import { appendEvents } from '../../core/store/events.mjs';
import { makeVaga } from '../../core/sources/vaga.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const html = nome => readFile(path.join(repo, 'tests', 'fixtures', 'destino', nome), 'utf8');
const vaga = (id, extra = {}) => ({ id, aderencia: 'alta', destino_pendente: true, aparicoes: [{ fonte: 'linkedin_guest', url: `https://www.linkedin.com/jobs/view/${id}` }], ...extra });

test('a fila só tem vagas alta ou média, não aplicadas, não descartadas e ainda sem destino', () => {
  const projecao = [vaga('a'), vaga('b', { aderencia: 'media' }), vaga('c', { aderencia: 'baixa' }), vaga('d', { candidatura_usuario: { aplicada: true } }),
    vaga('e', { descarte_usuario: { descartada: true } }), vaga('f', { destino_pendente: false }), vaga('g', { destino_bloqueado_em: '2026-10-15' }), vaga('h', { application_url: 'https://x.exemplo.test/1' })];
  assert.deepEqual(montarFila(projecao, { hoje: '2026-10-15' }).map(v => v.id), ['a', 'b']);
});

test('limite de 15 por dia, persistente e zerado na virada', async t => {
  const dataRoot = await tempDir(t);
  const hoje = new Date('2026-10-15T15:00:00Z');
  assert.equal((await reservarDestinos({ dataRoot, quantidade: 10, now: hoje })).concedidas, 10);
  assert.equal((await reservarDestinos({ dataRoot, quantidade: 10, now: hoje })).concedidas, 5);
  assert.equal((await reservarDestinos({ dataRoot, quantidade: 1, now: hoje })).concedidas, 0);
  assert.equal((await reservarDestinos({ dataRoot, quantidade: 3, now: new Date('2026-10-16T15:00:00Z') })).concedidas, 3);
});

test('o extrator devolve application_url e portal limpos, e o resultado vira evento', async t => {
  const r = parseDestino(await html('candidatar-externo.html'));
  assert.equal(r.application_url, 'https://carreiras.exemplo.test/empresa-alfa/vaga/9981');
  assert.equal(r.bloqueada, undefined);
  const dataRoot = await tempDir(t);
  const v = makeVaga({ fonte: 'linkedin_guest', portal: 'linkedin', requisicao_id: '44', empresa: 'Empresa Alfa', cargo: 'Gerente', url: 'https://www.linkedin.com/jobs/view/44', aparicao: true });
  const ts = '2026-10-15T15:00:00.000Z';
  await appendEvents(dataRoot, [descobertaEvent(v, 'empresa-alfa-1', ts, [], { destino_pendente: true })], { now: ts });
  await registrarDestino(dataRoot, { vagaId: 'empresa-alfa-1', applicationUrl: r.application_url }, new Date(ts));
  const [projetada] = projectEvents((await readEvents(dataRoot)).eventos).vagas;
  assert.equal(projetada.application_url, r.application_url);
  assert.equal(projetada.destino_pendente, false);
  assert.equal(projetada.portal_candidatura, 'Pendente', 'host desconhecido continua pendente até a pessoa confirmar');
});

test('login e captcha viram bloqueada:humano, sem insistir', async t => {
  assert.deepEqual(parseDestino(await html('login.html')), { bloqueada: 'humano', motivo: 'login' });
  assert.deepEqual(parseDestino(await html('captcha.html')), { bloqueada: 'humano', motivo: 'captcha' });
  assert.deepEqual(parseDestino(await html('sem-link.html')), { sem_destino: true });
  const dataRoot = await tempDir(t);
  const v = makeVaga({ fonte: 'x', portal: 'linkedin', requisicao_id: '45', empresa: 'Empresa Alfa', cargo: 'Gerente', url: 'https://www.linkedin.com/jobs/view/45', aparicao: true });
  const ts = '2026-10-15T15:00:00.000Z';
  await appendEvents(dataRoot, [descobertaEvent(v, 'empresa-alfa-2', ts, [], { destino_pendente: true })], { now: ts });
  await registrarBloqueio(dataRoot, { vagaId: 'empresa-alfa-2', motivo: 'captcha' }, new Date(ts));
  const projetada = { ...projectEvents((await readEvents(dataRoot)).eventos).vagas[0], aderencia: 'alta' };
  assert.equal(projetada.destino_bloqueado_em, '2026-10-15');
  assert.deepEqual(montarFila([projetada], { hoje: '2026-10-15' }), [], 'não volta à fila no mesmo dia');
  assert.equal(montarFila([projetada], { hoje: '2026-10-16' }).length, 1, 'volta no dia seguinte');
});

test('a skill proíbe captura de tela e leitura da página inteira', async () => {
  const texto = await readFile(path.join(repo, 'skills', 'resolver-destino', 'SKILL.md'), 'utf8');
  assert.match(texto, /Proibido\*\* captura de tela/);
  assert.match(texto, /read_page.*sem `ref_id`/);
  assert.match(texto, /nunca chama o Chrome/);
  assert.ok(EXTRATOR_JS.length < 1500, 'extrator curto');
});

test('o comando montado para o claude -p da rotina não carrega nenhuma ferramenta do Chrome', () => {
  const args = buildLiveArgs({ modelo: 'sonnet' }).join(' ');
  assert.ok(!/chrome/i.test(args));
  assert.match(args, /--strict-mcp-config/);
});

test('destinos fila e registrar pela CLI', async t => {
  const { run } = await import('../helpers/cli.mjs');
  const dataRoot = await tempDir(t);
  const fila = run(['destinos', 'fila', '--json'], { dataRoot });
  assert.equal(fila.status, 0, fila.stdout + fila.stderr);
  assert.deepEqual(fila.json.fila, []);
  const semUrl = run(['destinos', 'registrar', '--vaga', 'x', '--json'], { dataRoot });
  assert.equal(semUrl.status, 2);
  const ruim = run(['destinos', 'registrar', '--vaga', 'x', '--url', 'javascript:alert(1)', '--json'], { dataRoot });
  assert.equal(ruim.status, 2);
});
