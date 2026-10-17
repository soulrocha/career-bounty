import assert from 'node:assert/strict';
import test from 'node:test';
import { baseCv, dataRootComBase, perfilCvBruto, vagaAlta } from '../helpers/cv.mjs';
import { selecionarCv } from '../../core/cv/select.mjs';
import { renderAts } from '../../core/cv/renderAts.mjs';
import { avaliarGate, eventoGate, podeCandidatar, versaoDoCv } from '../../core/cv/gates.mjs';
import { appendEvents, readEvents } from '../../core/store/events.mjs';
import { projectEvents } from '../../core/store/project.mjs';
import { renderPainel } from '../../panel/render.mjs';
import { PUBLIC_TEMPLATE } from '../../panel/template.mjs';
import { readFile } from 'node:fs/promises';

// Texto "extraído do PDF ATS" sem imprimir: o HTML do ATS sem tags. O caminho real (PDF) é coberto em cv-render.
const textoDoHtml = html => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<\/(p|h\d|li)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');

async function ambiente() {
  const base = await baseCv();
  const perfil = await perfilCvBruto();
  const payload = selecionarCv({ vaga: vagaAlta(), perfil, afirmacoes: base.claims, config: {} });
  const gate = async (p = payload, textoAts) => avaliarGate({ payload: p, afirmacoes: base.claims, textoAts: textoAts ?? textoDoHtml(await renderAts(p)) });
  return { base, perfil, payload, gate };
}

const codigos = r => r.motivos.map(m => m.codigo);
const comItem = (payload, indiceExp, item) => {
  const copia = structuredClone(payload);
  copia.experiencias[indiceExp].itens.unshift(item);
  return copia;
};

test('CV montado só com afirmações liberadas, texto fiel e ATS extraível passa no gate', async () => {
  const { payload, gate } = await ambiente();
  const r = await gate();
  assert.deepEqual(r.motivos, []);
  assert.equal(r.status, 'ok');
  assert.equal(r.versao, versaoDoCv(payload));
  assert.match(r.versao, /^[0-9a-f]{64}$/);
});

test('número órfão bloqueia, com o número no motivo (bullet, resumo e card)', async () => {
  const { payload, gate } = await ambiente();
  const bullet = comItem(payload, 0, { afirmacao: 'AF-210', texto: 'Conduziu alinhamentos técnicos com um fornecedor internacional em 7 países.' });
  const rBullet = await gate(bullet);
  assert.equal(rBullet.status, 'bloqueado');
  assert.ok(rBullet.motivos.some(m => m.numero === '7'), JSON.stringify(rBullet.motivos));

  const resumo = { ...structuredClone(payload), resumo: 'Analista de produto com 12 anos de experiência e 99% de entregas no prazo.' };
  const rResumo = await gate(resumo);
  assert.equal(rResumo.status, 'bloqueado');
  assert.ok(rResumo.motivos.some(m => m.numero === '99%' && m.onde === 'resumo'), JSON.stringify(rResumo.motivos));

  const card = structuredClone(payload);
  card.cards[1] = { ...card.cards[1], valor: '410' };
  const rCard = await gate(card);
  assert.equal(rCard.status, 'bloqueado');
  assert.ok(rCard.motivos.some(m => m.numero === '410' && m.onde === 'card 2'), JSON.stringify(rCard.motivos));
});

test('texto do PDF ATS não extraível (vazio ou sem os bullets) bloqueia', async () => {
  const { gate } = await ambiente();
  assert.deepEqual(codigos(await gate(undefined, '')), ['ats_nao_extraivel']);
  const r = await gate(undefined, 'Ana Exemplo\nResumo\n');
  assert.equal(r.status, 'bloqueado');
  assert.deepEqual([...new Set(codigos(r))], ['ats_nao_extraivel']);
});

test('afirmação relato (ou proposta, ou não publicável) usada como fato bloqueia', async () => {
  const { payload, gate } = await ambiente();
  const relato = await gate(comItem(payload, 1, { afirmacao: 'AF-205', texto: 'Gerou ganho de 80% em produtividade.' }));
  assert.equal(relato.status, 'bloqueado');
  assert.ok(codigos(relato).includes('afirmacao_sem_prova'), JSON.stringify(relato.motivos));
  const naoPublicavel = await gate(comItem(payload, 0, { afirmacao: 'AF-208', texto: 'Corrigiu uma falha de segurança que afetava 99 contas.' }));
  assert.ok(codigos(naoPublicavel).includes('nao_publicavel'));
  const inexistente = await gate(comItem(payload, 0, { afirmacao: 'AF-999', texto: 'Algo.' }));
  assert.ok(codigos(inexistente).includes('afirmacao_inexistente'));
});

test('bullet com texto diferente da afirmação e das variantes cadastradas bloqueia; variante cadastrada passa', async () => {
  const { payload, gate } = await ambiente();
  const alfa = payload.experiencias.findIndex(exp => exp.id === 'exp-alfa');
  const alterado = structuredClone(payload);
  alterado.experiencias[alfa].itens = alterado.experiencias[alfa].itens.filter(i => i.afirmacao !== 'AF-201');
  const comVariante = structuredClone(alterado);
  alterado.experiencias[alfa].itens.unshift({ afirmacao: 'AF-201', texto: 'Reduziu drasticamente o tempo de fechamento de pedidos em 34%, de 12 para 8 dias.' });
  assert.ok(codigos(await gate(alterado)).includes('texto_alterado'));
  comVariante.experiencias[alfa].itens.unshift({ afirmacao: 'AF-201', texto: 'Cortou o tempo de fechamento de pedidos em 34%, de 12 para 8 dias.' });
  assert.equal((await gate(comVariante)).status, 'ok');
});

test('termo marcado para anonimizar em afirmação usada bloqueia se aparecer no CV', async () => {
  const { payload, gate } = await ambiente();
  const vazado = { ...structuredClone(payload), resumo: 'Analista de produto que atendeu o Cliente Secreto.' };
  const r = await gate(vazado);
  assert.ok(r.motivos.some(m => m.codigo === 'termo_anonimizado' && m.motivo.includes('AF-211')), JSON.stringify(r.motivos));
});

test('o gate registra evento com a versão do CV e a projeção marca a vaga', async t => {
  const { payload, gate } = await ambiente();
  const dataRoot = await dataRootComBase(t);
  const ok = await gate();
  const ts = '2026-10-17T12:00:00.000Z';
  await appendEvents(dataRoot, [eventoGate({ vagaId: 'vaga-cv-01', gate: ok, ts })], { now: ts });
  // Mesmo CV avaliado de novo não duplica o evento.
  await appendEvents(dataRoot, [eventoGate({ vagaId: 'vaga-cv-01', gate: ok, ts })], { now: ts });
  const { eventos } = await readEvents(dataRoot);
  const gates = eventos.filter(e => e.tipo === 'cv.gate');
  assert.equal(gates.length, 1);
  assert.deepEqual(gates[0].dados, { status: 'ok', motivos: [], versao: versaoDoCv(payload), tipo_cv: 'adaptado' });
  assert.equal(gates[0].entidade_id, 'vaga-cv-01');
});

test('o painel e a candidatura não oferecem a vaga com CV bloqueado', async () => {
  const { payload, gate } = await ambiente();
  const vaga = { ...vagaAlta(), status: 'avaliada-sem-envio' };
  const bloqueado = await gate({ ...structuredClone(payload), resumo: 'Analista com 99% de entregas no prazo.' });
  const eventos = [
    { id: 'e1', ts: '2026-10-17T12:00:00.000Z', host: 'h', seq: 1, ator: 'teste', tipo: 'vaga.importada', entidade: 'vaga', entidade_id: vaga.id, dados: { legado: vaga } },
    eventoGate({ vagaId: vaga.id, gate: bloqueado, ts: '2026-10-17T12:01:00.000Z' }),
  ].map((e, i) => ({ host: 'h', seq: i + 1, ...e }));
  const projecao = projectEvents(eventos);
  const projetada = (projecao.vagas ?? []).find(v => v.id === vaga.id);
  assert.ok(projetada, 'vaga projetada');
  assert.equal(projetada.cv_gate.status, 'bloqueado');
  assert.equal(podeCandidatar(projetada), false);
  assert.equal(podeCandidatar(vagaAlta()), true);

  const html = renderPainel({ ...projecao, vagas: [projetada] }, { template: await readFile(PUBLIC_TEMPLATE, 'utf8') });
  // O template decide no navegador: o dado chega com o gate, e o card troca o envio pelo motivo.
  assert.match(html, /"cv_gate":\{"status":"bloqueado"/);
  assert.match(html, /CV bloqueado/);
});
