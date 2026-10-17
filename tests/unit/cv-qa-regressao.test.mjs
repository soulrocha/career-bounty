// Regressões dos achados do QA adversarial da F5: cada teste reproduz um contorno encontrado e prova que ele está fechado.
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { baseCv, dataRootComBase, fixturesCv, perfilCvBruto, runnerFake, vagaAlta } from '../helpers/cv.mjs';
import { makeLegado } from '../fixtures/make-legado.mjs';
import { encontrarNavegador } from '../../core/cv/navegador.mjs';
import { avaliarGate, podeCandidatar } from '../../core/cv/gates.mjs';
import { gravarCv, lerManifesto } from '../../core/cv/artifacts.mjs';
import { gerarCvDaVaga, proporPerfilDoPortal } from '../../core/cv/gerar.mjs';
import { LlmSaidaInvalida } from '../../core/llm/runner.mjs';
import { redigirCv } from '../../core/cv/redator.mjs';
import { proporPerfilPortal } from '../../core/cv/perfilPortal.mjs';
import { renderVisual } from '../../core/cv/renderVisual.mjs';
import { renderAts } from '../../core/cv/renderAts.mjs';
import { selecionarCv } from '../../core/cv/select.mjs';
import { loadSettings } from '../../core/config.mjs';
import { appendEvents, readEvents } from '../../core/store/events.mjs';
import { projectEvents } from '../../core/store/project.mjs';
import { startPanel } from '../../panel/server.mjs';

const semNavegador = encontrarNavegador() ? false : 'nenhum Chrome, Chromium ou Edge instalado (CAREER_BOUNTY_BROWSER)';
const textoDoHtml = html => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<\/(p|h\d|li)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');

async function payloadOk() {
  const base = await baseCv();
  const perfil = await perfilCvBruto();
  const payload = selecionarCv({ vaga: vagaAlta(), perfil, afirmacoes: base.claims, config: {} });
  const gate = async p => avaliarGate({ payload: p, afirmacoes: base.claims, textoAts: textoDoHtml(await renderAts(p)) });
  return { base, perfil, payload, gate };
}

async function ambienteCli(t, { vagas = [vagaAlta()], sombra = false } = {}) {
  const dataRoot = await dataRootComBase(t);
  await mkdir(path.join(dataRoot, 'cv'), { recursive: true });
  await copyFile(path.join(fixturesCv, 'perfil.json'), path.join(dataRoot, 'cv', 'perfil.json'));
  await copyFile(path.join(fixturesCv, 'foto.svg'), path.join(dataRoot, 'cv', 'foto.svg'));
  const ts = '2026-10-17T12:00:00.000Z';
  await appendEvents(dataRoot, vagas.map(vaga => ({ id: `imp:${vaga.id}`, ts, ator: 'teste', tipo: 'vaga.importada', entidade: 'vaga', entidade_id: vaga.id, dados: { legado: vaga } })), { now: ts });
  if (sombra) await writeFile(path.join(dataRoot, 'state', 'migration.json'), JSON.stringify({ version: 1, mode: 'shadow', snapshotRoot: null }));
  return dataRoot;
}
const projetada = async (dataRoot, id) => (projectEvents((await readEvents(dataRoot)).eventos).vagas ?? []).find(v => v.id === id);

test('QA 1: afirmação rebaixada bloqueia também a versão antiga aprovada; o painel não volta a oferecê-la', { skip: semNavegador }, async t => {
  const dataRoot = await ambienteCli(t);
  const v1 = run(['cv', 'gerar', '--vaga', 'vaga-cv-01', '--json'], { dataRoot });
  assert.equal(v1.status, 0, v1.stderr);
  const perfil = path.join(dataRoot, 'cv', 'perfil.json');
  await writeFile(perfil, (await readFile(perfil, 'utf8')).replace('Foco em reduzir o tempo de ciclo', 'Foco em encurtar o tempo de ciclo'));
  const v2 = run(['cv', 'gerar', '--vaga', 'vaga-cv-01', '--json'], { dataRoot });
  assert.equal(v2.status, 0, v2.stderr);
  assert.notEqual(v2.json.versao, v1.json.versao);
  const af = path.join(dataRoot, 'kb', 'claims', 'AF-202.md');
  await writeFile(af, (await readFile(af, 'utf8')).replace('nivel_prova: entregue', 'nivel_prova: relato'));
  const g = run(['cv', 'gate', '--vaga', 'vaga-cv-01', '--json'], { dataRoot });
  assert.equal(g.json.gate.status, 'bloqueado');
  assert.equal(g.json.aprovada, null);
  const manifesto = await lerManifesto(dataRoot, 'vaga-cv-01');
  assert.deepEqual(manifesto.versoes.map(v => v.gate.status), ['bloqueado', 'bloqueado']);
  assert.equal(podeCandidatar(await projetada(dataRoot, 'vaga-cv-01')), false);
});

test('QA 2: número com escala ou moeda trocada não passa no gate, no redator nem no perfil de portal', async () => {
  const { base, payload, gate } = await payloadOk();
  for (const resumo of ['Liderou projetos que somaram R$ 5 bilhões.', 'Painel usado por 41k usuários.', 'Painel usado por 41M de usuários.', 'Economizou R$ 41 em contratos.']) {
    const r = await gate({ ...structuredClone(payload), resumo });
    assert.equal(r.status, 'bloqueado', resumo);
  }
  const saida = { resumo: 'Painel usado por 41k usuários.', palavras_chave: [], experiencias: [{ id: 'exp-alfa', itens: [{ afirmacao: 'AF-202' }] }] };
  const { runner } = runnerFake(() => saida);
  const perfil = await perfilCvBruto();
  await assert.rejects(redigirCv({ runner, vaga: vagaAlta(), afirmacoes: base.claims, experiencias: perfil.experiencias }), LlmSaidaInvalida);
  const atual = JSON.parse(await readFile(path.join(fixturesCv, 'perfil-gupy.json'), 'utf8'));
  const { runner: r2 } = runnerFake(() => ({ secoes: [{ campo: 'sobre', proposto: 'Liderou a migração de 5 bilhões de sistemas.', afirmacoes: ['AF-204'] }] }));
  await assert.rejects(proporPerfilPortal({ runner: r2, portal: 'gupy', perfilAtual: atual, afirmacoes: base.claims }), LlmSaidaInvalida);
});

test('QA 3: em modo sombra cv gerar grava o artefato, mas não grava evento', { skip: semNavegador }, async t => {
  const dataRoot = await ambienteCli(t, { sombra: true });
  const antes = (await readEvents(dataRoot)).eventos.length;
  const r = run(['cv', 'gerar', '--vaga', 'vaga-cv-01', '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.evento, false);
  assert.ok(r.json.avisos.some(a => /modo sombra/.test(a)));
  assert.equal((await readEvents(dataRoot)).eventos.length, antes);
  assert.ok(await lerManifesto(dataRoot, 'vaga-cv-01'));
});

test('QA 4: com o redator, vaga sem alvo continua no CV-base e o modelo nem é chamado', { skip: semNavegador }, async t => {
  const dataRoot = await ambienteCli(t, { vagas: [vagaAlta({ requisitos: [] })] });
  const { runner, chamadas } = runnerFake(() => { throw new Error('não devia chamar'); });
  const r = await gerarCvDaVaga({ dataRoot, settings: await loadSettings({ dataRoot }), vagaId: 'vaga-cv-01', runner });
  assert.equal(r.tipo, 'base');
  assert.equal(chamadas.length, 0);
});

test('QA 5: número em título, intro, competência ou curso, card com afirmação inexistente e termo anonimizado com acento ou hífen bloqueiam', async () => {
  const { payload, gate } = await payloadOk();
  const casos = [
    p => { p.titulo = 'Analista de Produto com 15 anos'; },
    p => { p.experiencias[0].intro = 'Gestão de 300 pessoas.'; },
    p => { p.competencias = [{ grupo: 'Dados', itens: 'SQL avançado em 13 bancos.' }]; },
    p => { p.cursos = ['Curso de 900 horas | Instituto Exemplo']; },
    p => { p.cards[0] = { ...p.cards[0], claim_ids: ['AF-201', 'AF-999'] }; },
    p => { p.competencias = [{ grupo: 'Sistemas', itens: 'Integração com o Sistema-Órion.' }]; },
    p => { p.resumo = 'Analista de produto que atendeu o cliente secreto.'; },
  ];
  for (const [i, mudar] of casos.entries()) {
    const p = structuredClone(payload);
    mudar(p);
    assert.equal((await gate(p)).status, 'bloqueado', `caso ${i + 1}`);
  }
});

test('QA 6: quantidade por extenso sem afirmação não passa no resumo do gate nem do redator', async () => {
  const { base, payload, gate } = await payloadOk();
  for (const resumo of ['Tornou a consulta dez vezes mais rápida.', 'Dobrou a receita da área.', 'Uma década de experiência.', 'Atendeu centenas de clientes.']) {
    assert.equal((await gate({ ...structuredClone(payload), resumo })).status, 'bloqueado', resumo);
  }
  const perfil = await perfilCvBruto();
  const { runner } = runnerFake(() => ({ resumo: 'Dobrou a receita da área.', palavras_chave: [], experiencias: [{ id: 'exp-alfa', itens: [{ afirmacao: 'AF-202' }] }] }));
  await assert.rejects(redigirCv({ runner, vaga: vagaAlta(), afirmacoes: base.claims, experiencias: perfil.experiencias }), LlmSaidaInvalida);
});

test('QA 7: "{{conteudo}}" no cargo da vaga não sequestra o template', async () => {
  const { base, perfil } = await payloadOk();
  const payload = selecionarCv({ vaga: vagaAlta({ cargo: 'Analista {{conteudo}} $& $1' }), perfil, afirmacoes: base.claims, config: {} });
  for (const html of [await renderVisual(payload), await renderAts(payload)]) {
    assert.equal((html.match(/<h1>/g) ?? []).length, 1);
    assert.match(html, /<title>[^<]*Analista \{\{conteudo\}\} \$&amp; \$1[^<]*<\/title>/);
    assert.match(textoDoHtml(html), /Resumo/);
  }
});

test('QA 8 e 9: marcar candidatura no painel congela o CV aprovado; PDF listado mas ausente responde 404', async t => {
  const dataRoot = await tempDir(t);
  const origem = await tempDir(t);
  const pipeline = makeLegado({ vagas: 2 });
  for (const vaga of pipeline.vagas) { delete vaga.candidatura_usuario; delete vaga.historico_marcacoes; delete vaga.descarte_usuario; delete vaga.historico_descartes; delete vaga.candidatura_email; delete vaga.requisicao_id; delete vaga.id_requisicao; vaga.status = 'avaliada-sem-envio'; }
  const arquivo = path.join(origem, 'pipeline-vagas.json');
  await writeFile(arquivo, JSON.stringify(pipeline));
  assert.equal(run(['migrate', '--from', arquivo, '--json'], { dataRoot }).status, 0);
  const estado = path.join(dataRoot, 'state/migration.json');
  await writeFile(estado, JSON.stringify({ ...JSON.parse(await readFile(estado, 'utf8')), mode: 'ativo' }));
  const [vaga, outra] = pipeline.vagas.map(v => v.id);
  const H1 = '1'.repeat(64);
  const pacote = id => ({ vagaId: id, versao: H1, tipo: 'adaptado', payload: {}, gate: { status: 'ok', motivos: [], versao: H1 }, ts: '2026-10-17T12:00:00.000Z',
    arquivos: { 'cv-visual.html': 'v', 'cv-visual.pdf': Buffer.from('%PDF-v'), 'cv-ats.html': 'a', 'cv-ats.pdf': Buffer.from('%PDF-a') } });
  await gravarCv(dataRoot, pacote(vaga));
  await gravarCv(dataRoot, pacote(outra));
  await rm(path.join(dataRoot, 'artifacts', 'cv', outra, H1, 'cv-ats.pdf'), { force: true });
  const panel = await startPanel({ dataRoot, port: 0, now: () => new Date().toISOString(), hostId: 'pc-a' });
  t.after(panel.close);
  const page = await (await fetch(panel.url)).text();
  const token = JSON.parse(page.match(/window\.PAINEL_API=(\{[^;]+\});/)[1]).token;
  const hoje = new Date().toISOString().slice(0, 10);
  const r = await fetch(`${panel.url}/api/candidaturas`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: panel.url, 'X-Painel-Token': token }, body: JSON.stringify({ id: vaga, aplicada: true, data: hoje }) });
  assert.equal(r.status, 200, await r.text());
  assert.equal((await lerManifesto(dataRoot, vaga)).enviado.hash, H1);
  await assert.rejects(gravarCv(dataRoot, pacote(vaga)), /imutável/);
  assert.equal((await fetch(`${panel.url}/artifacts/cv/${outra}/${H1}/cv-ats.pdf`)).status, 404);
});

test('a proposta de perfil de portal vai para outbox/cv em JSON e Markdown, sem nada aplicado', async t => {
  const dataRoot = await dataRootComBase(t);
  await mkdir(path.join(dataRoot, 'cv'), { recursive: true });
  await copyFile(path.join(fixturesCv, 'perfil-gupy.json'), path.join(dataRoot, 'cv', 'perfil-gupy.json'));
  const { runner } = runnerFake(() => ({ secoes: [{ campo: 'experiencia:g1', proposto: 'Economizou R$ 2,3 mi em renegociação de contratos.', afirmacoes: ['AF-209'] }] }));
  const r = await proporPerfilDoPortal({ dataRoot, settings: await loadSettings({ dataRoot }), runner, ts: '2026-10-17T12:00:00.000Z' });
  assert.equal(r.arquivo, path.join(dataRoot, 'outbox', 'cv', 'perfil-gupy-2026-10-17.md'));
  const md = await readFile(r.arquivo, 'utf8');
  assert.match(md, /nada foi aplicado no portal/);
  assert.match(md, /Economizou R\$ 2,3 mi/);
  const json = JSON.parse(await readFile(path.join(dataRoot, 'outbox', 'cv', 'perfil-gupy-2026-10-17.json'), 'utf8'));
  assert.equal(json.tipo, 'proposta');
  assert.equal(json.secoes.length, 1);
});
