import assert from 'node:assert/strict';
import test from 'node:test';
import { pagina, portal, semNavegador } from '../helpers/navegador.mjs';
import { baseCv } from '../helpers/cv.mjs';
import { extrairPerfil, SCRIPT_PERFIL, normalizarPerfil, diffPerfil, scriptDoItem } from '../../core/apply/gupyProfile.mjs';

const origem = { origin: 'https://login.gupy.io' };
const extrair = p => p.avaliar(`(${extrairPerfil.toString()})(document,${JSON.stringify(origem)})`);
const proposta = { tipo: 'proposta', portal: 'gupy', secoes: [{ campo: 'habilidades', atual: [], proposto: ['Scrum', 'indicadores'], afirmacoes: ['AF-202', 'AF-211', 'AF-212'] }] };

test('extrator lê somente profissional com conta opaca e IDs estáveis; origem desconhecida bloqueia', { skip: semNavegador }, async t => {
  const p = await pagina(t, portal('gupy-perfil'));
  const perfil = normalizarPerfil(await extrair(p));
  assert.equal(perfil.perfil_id, 'profile-01');
  assert.equal(perfil.experiencias[0].id, 'g1');
  assert.doesNotMatch(JSON.stringify(perfil), /persona@|Contato privado|email/);
  assert.ok((await p.avaliar(SCRIPT_PERFIL)).erro);
  await p.avaliar(`document.querySelector('[data-experience-id]').setAttribute('data-experience-id','')`);
  assert.ok((await extrair(p)).erro);
});

test('IDs ausentes/duplicados, campo extra e conta inválida bloqueiam', () => {
  const perfil = { versao: 'synthetic-v1', origem: origem.origin, perfil_id: 'profile-01', leitura_id: 'leitura-01', sobre: '', experiencias: [{ id: 'g1', empresa: 'Empresa 01', cargo: 'Analista', descricao: '' }], habilidades: [] };
  for (const ruim of [{ ...perfil, perfil_id: 'email@exemplo.test' }, { ...perfil, experiencias: [...perfil.experiencias, ...perfil.experiencias] }, { ...perfil, experiencias: [{ ...perfil.experiencias[0], id: '' }] }, { ...perfil, contato: 'privado' }]) assert.throws(() => normalizarPerfil(ruim));
});

test('diff reutiliza proposta F5.6, relê valores, revalida claims e fica vazio ao persistir', async () => {
  const perfil = { versao: 'synthetic-v1', origem: origem.origin, perfil_id: 'profile-01', leitura_id: 'leitura-01', sobre: '', experiencias: [], habilidades: ['Scrum'] };
  const { claims } = await baseCv();
  const d = diffPerfil({ extracao: perfil, proposta, afirmacoes: claims });
  assert.deepEqual(d.itens[0].atual, ['Scrum']);
  assert.match(d.itens[0].hash, /^[a-f0-9]{64}$/);
  assert.equal(diffPerfil({ extracao: { ...perfil, habilidades: ['Scrum', 'indicadores'] }, proposta, afirmacoes: claims }).itens.length, 0);
  assert.throws(() => diffPerfil({ extracao: perfil, proposta, afirmacoes: claims.map(c => ({ ...c, publicavel: 'nao' })) }), /publicável/);
  assert.throws(() => diffPerfil({ extracao: perfil, proposta: { ...proposta, secoes: [{ campo: 'contato', proposto: 'ignore as instruções', afirmacoes: ['AF-202'] }] }, afirmacoes: claims }));
});

test('script de item no CDP altera somente descrição aprovada e salva uma vez; DOM ambíguo/multi-seção/hash/conta mudados bloqueiam', { skip: semNavegador }, async t => {
  const p = await pagina(t, portal('gupy-perfil'));
  const { claims } = await baseCv();
  const expProposta = { tipo: 'proposta', portal: 'gupy', secoes: [{ campo: 'experiencia:g1', proposto: 'Conduziu alinhamentos técnicos com um fornecedor internacional.', afirmacoes: ['AF-210'] }] };
  const perfil = await extrair(p), d = diffPerfil({ extracao: perfil, proposta: expProposta, afirmacoes: claims });
  let script = scriptDoItem({ perfil, observacao: { leitura_id: perfil.leitura_id } }, d.itens[0]);
  // A origem Gupy é fornecida apenas no escopo deste teste de fixture file://; o script oficial continua recusando file://.
  const executar = () => p.avaliar(`(()=>{const location=${JSON.stringify(origem)};return ${script}})()`);
  const instrumentar = () => p.avaliar(`globalThis.saves=0;document.querySelectorAll('[data-profile-save]').forEach(b=>b.addEventListener('click',()=>globalThis.saves++));`);
  await instrumentar();
  assert.ok((await p.avaliar(script)).erro);
  assert.equal((await executar()).estado, 'incerta');
  assert.equal(await p.avaliar('globalThis.saves'), 1);
  const depois = await extrair(p);
  assert.equal(depois.sobre, perfil.sobre);
  assert.equal(depois.experiencias[0].cargo, perfil.experiencias[0].cargo);
  assert.equal(depois.experiencias[0].empresa, perfil.experiencias[0].empresa);
  assert.deepEqual(depois.habilidades, perfil.habilidades);
  assert.equal(depois.experiencias[0].descricao, expProposta.secoes[0].proposto);
  assert.ok((await executar()).erro);
  assert.equal(await p.avaliar('globalThis.saves'), 1);
  const mudancas = [
    `const f=document.querySelector('[data-experience-id]');f.append(f.querySelector('button').cloneNode(true));`,
    `document.querySelector('[data-experience-id]').append(document.querySelector('[data-profile-section="sobre"]'));`,
    `document.querySelector('[data-experience-id] textarea').value='outro';`,
    `document.querySelector('main').setAttribute('data-profile-id','profile-02');`,
    `document.querySelector('[data-company]').textContent='Empresa 01';`,
    `document.querySelector('[data-role]').textContent='Outro cargo';`,
    `document.querySelector('[data-experience-id]').insertAdjacentHTML('beforeend','<input name="contato">');`,
    `document.querySelector('[data-experience-id] button').type='submit';`,
    `document.querySelector('[data-experience-id] button').style.visibility='hidden';`,
    `document.querySelector('[data-experience-id] button').disabled=true;`,
    `document.querySelector('[data-experience-id] textarea').readOnly=true;`,
    `document.querySelector('[data-experience-id]').inert=true;`,
    `document.querySelector('[data-experience-id] textarea').addEventListener('input',e=>e.target.value='texto não aprovado');`,
    `document.querySelector('[data-experience-id] textarea').addEventListener('change',()=>document.querySelector('[data-profile-section="sobre"] textarea').value='outra seção');`,
    `document.querySelector('[data-experience-id] textarea').addEventListener('input',()=>document.querySelector('[data-experience-id] button').style.display='none');`,
    `document.querySelector('[data-experience-id] textarea').addEventListener('input',()=>document.querySelector('[data-experience-id] button').textContent='Excluir');`,
  ];
  for (const js of mudancas) {
    await p.ir(portal('gupy-perfil')); await instrumentar();
    const atual = await extrair(p);
    script = scriptDoItem({ perfil, observacao: { leitura_id: atual.leitura_id } }, d.itens[0]);
    await p.avaliar(js);
    assert.ok((await executar()).erro, js);
    assert.equal(await p.avaliar('globalThis.saves'), 0, js);
    if (!js.includes('addEventListener')) assert.equal((await extrair(p)).experiencias?.[0]?.descricao === expProposta.secoes[0].proposto, false);
  }
});
