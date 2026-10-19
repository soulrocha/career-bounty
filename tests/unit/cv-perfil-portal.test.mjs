import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { baseCv, fixturesCv, perfilCvBruto, runnerFake, vagaGupy } from '../helpers/cv.mjs';
import { loadAgent } from '../../core/llm/agents.mjs';
import { LlmSaidaInvalida } from '../../core/llm/runner.mjs';
import { LIMITES_PORTAL, proporPerfilPortal } from '../../core/cv/perfilPortal.mjs';
import { decidirCv, selecionarCv } from '../../core/cv/select.mjs';

const perfilGupy = async () => JSON.parse(await readFile(path.join(fixturesCv, 'perfil-gupy.json'), 'utf8'));

const SOBRE = 'Analista de produto que implantou um painel de indicadores usado por 41 pessoas e liderou a migração de 5 sistemas legados para uma plataforma única.';
const boa = (extra = {}) => ({
  secoes: [
    { campo: 'sobre', proposto: SOBRE, afirmacoes: ['AF-202', 'AF-204'] },
    { campo: 'experiencia:g1', proposto: 'Economizou R$ 2,3 mi em renegociação de contratos. Conduziu alinhamentos técnicos com um fornecedor internacional.', afirmacoes: ['AF-209', 'AF-210'] },
    { campo: 'habilidades', proposto: ['Scrum', 'indicadores', 'backlog'], afirmacoes: ['AF-202', 'AF-211', 'AF-212'] },
  ],
  ...extra,
});

async function ambiente(fake) {
  const base = await baseCv();
  const perfil = await perfilCvBruto();
  const atual = await perfilGupy();
  const { runner, chamadas } = runnerFake(fake);
  const propor = (opcoes = {}) => proporPerfilPortal({ runner, portal: 'gupy', perfilAtual: atual, afirmacoes: base.claims, ...opcoes });
  return { base, perfil, atual, chamadas, propor };
}

test('o agente perfil-portal usa Sonnet e nenhuma ferramenta', async () => {
  const agente = await loadAgent('perfil-portal');
  assert.equal(agente.modelo, 'sonnet');
  assert.deepEqual(agente.tools, ['none']);
});

test('para cada seção, a proposta traz o texto atual, o proposto e as afirmações ligadas', async () => {
  const { propor, atual } = await ambiente(() => boa());
  const r = await propor();
  assert.equal(r.portal, 'gupy');
  assert.deepEqual(r.secoes.map(s => s.campo), ['sobre', 'experiencia:g1', 'habilidades']);
  const [sobre, exp, habilidades] = r.secoes;
  assert.deepEqual(sobre, { campo: 'sobre', atual: atual.sobre, proposto: SOBRE, afirmacoes: ['AF-202', 'AF-204'] });
  assert.equal(exp.atual, atual.experiencias[0].descricao);
  assert.deepEqual(habilidades.atual, ['Scrum']);
  assert.deepEqual(habilidades.proposto, ['Scrum', 'indicadores', 'backlog']);
});

test('só fatos de afirmações ligadas: afirmação de outra experiência, habilidade sem afirmação ou seção sem afirmação rejeitam', async () => {
  const casos = [
    boa({ secoes: [{ campo: 'experiencia:g1', proposto: 'Liderou a migração de 5 sistemas legados para uma plataforma única.', afirmacoes: ['AF-204'] }] }),
    boa({ secoes: [{ campo: 'habilidades', proposto: ['Kubernetes'], afirmacoes: ['AF-202'] }] }),
    boa({ secoes: [{ campo: 'sobre', proposto: 'Analista de produto.', afirmacoes: [] }] }),
    boa({ secoes: [{ campo: 'experiencia:g9', proposto: 'Conduziu alinhamentos técnicos com um fornecedor internacional.', afirmacoes: ['AF-210'] }] }),
  ];
  for (const saida of casos) {
    const { propor } = await ambiente(() => saida);
    await assert.rejects(propor(), LlmSaidaInvalida, JSON.stringify(saida.secoes[0]));
  }
});

test('o limite de caracteres de cada campo é respeitado', async () => {
  const longo = `${SOBRE} `.repeat(Math.ceil(LIMITES_PORTAL.gupy.sobre / SOBRE.length) + 1).trim();
  const { propor } = await ambiente(() => boa({ secoes: [{ campo: 'sobre', proposto: longo, afirmacoes: ['AF-202', 'AF-204'] }] }));
  await assert.rejects(propor(), /excede/);
  const muitas = Array.from({ length: LIMITES_PORTAL.gupy.habilidades + 1 }, () => 'indicadores');
  const { propor: propor2 } = await ambiente(() => boa({ secoes: [{ campo: 'habilidades', proposto: muitas, afirmacoes: ['AF-202'] }] }));
  await assert.rejects(propor2(), /habilidades/);
});

test('número sem afirmação é rejeitado', async () => {
  const { propor } = await ambiente(() => boa({ secoes: [{ campo: 'sobre', proposto: 'Analista de produto com 15 anos de experiência e um painel usado por 41 pessoas.', afirmacoes: ['AF-202'] }] }));
  await assert.rejects(propor(), /sem afirmação|numero|número/);
});

test('afirmação relato (ou proposta, ou não publicável) não entra como fato, e a entrada nem a oferece', async () => {
  for (const id of ['AF-205', 'AF-206', 'AF-208']) {
    const { propor } = await ambiente(() => boa({ secoes: [{ campo: 'sobre', proposto: 'Analista de produto.', afirmacoes: [id] }] }));
    await assert.rejects(propor(), LlmSaidaInvalida, id);
  }
  const { propor, chamadas } = await ambiente(() => boa());
  await propor();
  const oferecidas = chamadas[0].entrada.afirmacoes.map(af => af.id);
  for (const fora of ['AF-205', 'AF-206', 'AF-207', 'AF-208']) assert.ok(!oferecidas.includes(fora), fora);
});

test('a saída é proposta: nenhum campo de ação, envio ou aplicação', async () => {
  const { propor } = await ambiente(() => boa());
  const r = await propor();
  const chaves = JSON.stringify(r, (k, v) => v).match(/"([a-z_]+)":/gi).map(c => c.toLowerCase());
  assert.ok(!chaves.some(c => /aplic|acao|ação|enviar|submit|apply|salvar/.test(c)), chaves.join(' '));
  assert.equal(r.tipo, 'proposta');
  // Campo fora do contrato na saída do modelo (ex.: "aplicar") é rejeitado.
  const { propor: propor2 } = await ambiente(() => ({ ...boa(), aplicar: true }));
  await assert.rejects(propor2(), LlmSaidaInvalida);
});

test('perfil já igual ao proposto dá diff vazio (idempotente)', async () => {
  const { propor, atual } = await ambiente(() => ({
    secoes: [
      { campo: 'experiencia:g1', proposto: `  ${atual.experiencias[0].descricao} `, afirmacoes: ['AF-211'] },
      { campo: 'habilidades', proposto: ['scrum'], afirmacoes: ['AF-212'] },
    ],
  }));
  const r = await propor();
  assert.deepEqual(r.secoes, []);
});

test('vaga na Gupy não gera PDF: o documento é o perfil', async () => {
  const { base, perfil } = await ambiente(() => boa());
  assert.equal(decidirCv(vagaGupy(), {}).gerar, false);
  assert.equal(selecionarCv({ vaga: vagaGupy(), perfil, afirmacoes: base.claims, config: {} }), null);
});

// ---- F9.7 LinkedIn: mesmo validador, com título (headline) e limites do LinkedIn ----

const perfilLinkedin = async () => ({ titulo: 'Analista de Produto', ...(await perfilGupy()) });

test('LinkedIn: o título entra com limite próprio, conferência de número e texto atual ao lado', async () => {
  const base = await baseCv();
  const atual = await perfilLinkedin();
  const titulo = 'Analista de produto | painel de indicadores usado por 41 pessoas';
  const { runner } = runnerFake(() => ({ secoes: [{ campo: 'titulo', proposto: titulo, afirmacoes: ['AF-202'] }] }));
  const r = await proporPerfilPortal({ runner, portal: 'linkedin', perfilAtual: atual, afirmacoes: base.claims });
  assert.deepEqual(r.secoes, [{ campo: 'titulo', atual: 'Analista de Produto', proposto: titulo, afirmacoes: ['AF-202'] }]);
  const casos = [
    [{ campo: 'titulo', proposto: 'x'.repeat(LIMITES_PORTAL.linkedin.titulo + 1), afirmacoes: ['AF-202'] }, /excede/],
    [{ campo: 'titulo', proposto: 'Analista de produto com 15 anos de experiência', afirmacoes: ['AF-202'] }, /sem afirmação|número/],
  ];
  for (const [secao, erro] of casos) {
    const { runner: r2 } = runnerFake(() => ({ secoes: [secao] }));
    await assert.rejects(proporPerfilPortal({ runner: r2, portal: 'linkedin', perfilAtual: atual, afirmacoes: base.claims }), erro);
  }
});

test('Gupy não tem título: a seção é recusada', async () => {
  const { propor } = await ambiente(() => ({ secoes: [{ campo: 'titulo', proposto: 'Analista de produto', afirmacoes: ['AF-202'] }] }));
  await assert.rejects(propor(), /campo desconhecido/);
});

test('LinkedIn aceita Sobre maior que o limite da Gupy', async () => {
  assert.ok(LIMITES_PORTAL.linkedin.sobre > LIMITES_PORTAL.gupy.sobre);
  const base = await baseCv();
  const longo = `${SOBRE} `.repeat(Math.ceil((LIMITES_PORTAL.gupy.sobre + 10) / (SOBRE.length + 1))).trim();
  assert.ok([...longo].length > LIMITES_PORTAL.gupy.sobre && [...longo].length <= LIMITES_PORTAL.linkedin.sobre);
  const { runner } = runnerFake(() => ({ secoes: [{ campo: 'sobre', proposto: longo, afirmacoes: ['AF-202', 'AF-204'] }] }));
  const r = await proporPerfilPortal({ runner, portal: 'linkedin', perfilAtual: await perfilLinkedin(), afirmacoes: base.claims });
  assert.equal(r.secoes[0].campo, 'sobre');
});