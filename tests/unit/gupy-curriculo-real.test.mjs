// Adaptador da página real "Meu currículo" (gupy-curriculo-v1), com fixture que reproduz a estrutura observada.
import assert from 'node:assert/strict';
import test from 'node:test';
import { pagina, portal, semNavegador } from '../helpers/navegador.mjs';
import { baseCv } from '../helpers/cv.mjs';
import { SCRIPT_ABRIR_EXPERIENCIA, diffPerfil, extrairPerfil, normalizarPerfil, scriptDoItem } from '../../core/apply/gupyProfile.mjs';
import { decidirPerfil } from '../../core/apply/gupyProfileHook.mjs';

const LOCAL = { origin: 'https://login.gupy.io', pathname: '/candidates/curriculum' };
const extrair = (p, loc = LOCAL) => p.avaliar(`(${extrairPerfil.toString()})(document,${JSON.stringify(loc)})`);
const proposta = secoes => ({ tipo: 'proposta', portal: 'gupy', secoes });
const DESCRICAO = 'Economizou R$ 2,3 mi em renegociação de contratos.';

test('a página real vira perfil gupy-curriculo-v1 só com dado profissional, sem contato, documento ou "Sobre você"', { skip: semNavegador }, async t => {
  const p = await pagina(t, portal('gupy-curriculo'));
  const r = normalizarPerfil(await extrair(p));
  assert.equal(r.versao, 'gupy-curriculo-v1');
  assert.equal(r.sobre, null);
  assert.match(r.perfil_id, /^conta-[0-9a-f]{8}$/);
  assert.deepEqual(r.experiencias.map(e => [e.id, e.empresa, e.cargo]), [['p0', 'Empresa Gama', 'Gerente de Produto'], ['p1', 'Empresa Beta', 'Líder de Operações']]);
  assert.equal(r.experiencias[0].descricao, 'Gestão de produto de uma plataforma interna de dados.');
  assert.deepEqual(r.habilidades, ['Scrum', 'SQL']);
  assert.doesNotMatch(JSON.stringify(r), /RG-FICTICIO|linkedin\.example|Universidade/);
  // Mesma conta, mesmo id; outra página ou caminho não é reconhecida.
  assert.equal((await extrair(p)).perfil_id, r.perfil_id);
  assert.match((await extrair(p, { ...LOCAL, pathname: '/candidates/home' })).erro, /não reconhecido/);
  assert.match((await extrair(p, { origin: 'https://gupy.io.evil.test', pathname: '/candidates/curriculum' })).erro, /não reconhecido/);
});

test('o diff tira "Sobre você" com motivo e marca habilidades como manual', { skip: semNavegador }, async t => {
  const p = await pagina(t, portal('gupy-curriculo'));
  const { claims } = await baseCv();
  const d = diffPerfil({ extracao: await extrair(p), afirmacoes: claims, proposta: proposta([
    { campo: 'sobre', atual: '', proposto: 'Analista de produto que implantou um painel de indicadores usado por 41 pessoas.', afirmacoes: ['AF-202'] },
    { campo: 'experiencia:p0', atual: '', proposto: DESCRICAO, afirmacoes: ['AF-209'] },
    { campo: 'habilidades', atual: [], proposto: ['Scrum', 'indicadores'], afirmacoes: ['AF-202', 'AF-212'] },
  ]) });
  assert.deepEqual(d.ignoradas, [{ secao: 'sobre', motivo: 'a página de currículo da Gupy não tem campo Sobre você' }]);
  assert.deepEqual(d.itens.map(i => [i.secao, i.manual === true]), [['experiencia:p0', false], ['habilidades', true]]);
  // Afirmação de outra empresa na experiência da Empresa Gama é recusada.
  assert.throws(() => diffPerfil({ extracao: d.perfil, afirmacoes: claims, proposta: proposta([{ campo: 'experiencia:p0', atual: '', proposto: 'Liderou a migração de 5 sistemas legados para uma plataforma única.', afirmacoes: ['AF-204'] }]) }), /outra experiência/);
});

const preparar = async (p, mudar = '') => {
  const { claims } = await baseCv();
  if (mudar) await p.avaliar(mudar);
  const extracao = await extrair(p);
  const d = diffPerfil({ extracao, afirmacoes: claims, proposta: proposta([{ campo: 'experiencia:p0', atual: '', proposto: DESCRICAO, afirmacoes: ['AF-209'] }]) });
  const script = scriptDoItem({ perfil: d.perfil, observacao: { leitura_id: d.perfil.leitura_id } }, d.itens[0]);
  return () => p.avaliar(`(()=>{const location=${JSON.stringify(LOCAL)};return ${script}})()`);
};

test('o script do item abre a seção fechada, troca só aquela descrição e clica uma vez no Salvar global', { skip: semNavegador }, async t => {
  const p = await pagina(t, portal('gupy-curriculo'));
  const executar = await preparar(p);
  assert.equal(await p.avaliar("getComputedStyle(document.getElementById('sec-exp')).display"), 'none');
  assert.deepEqual(await executar(), { estado: 'incerta', secao: 'experiencia:p0' });
  assert.equal(await p.avaliar('document.body.dataset.salvo'), DESCRICAO);
  assert.equal(await p.avaliar("document.getElementById('activitiesPerformed-1').value"), '');
  assert.equal(await p.avaliar("document.getElementById('companyName-0').value"), 'Empresa Gama');
  // Nunca toca "Mais opções", "Remover experiência" nem o "Salvar" de outra seção.
  assert.deepEqual(await p.avaliar('({ menu: document.body.dataset.menu ?? null, removido: document.body.dataset.removido ?? null, outro: document.body.dataset.salvoHabilidades ?? null })'), { menu: null, removido: null, outro: null });
});

test('alvo ambíguo ou alterado: nada é salvo e o texto original volta', { skip: semNavegador }, async t => {
  const casos = [
    ["document.body.insertAdjacentHTML('beforeend','<button type=\"button\">Salvar</button>')", 'dois botões Salvar visíveis'],
    ["document.getElementById('salvar').disabled=true", 'Salvar desabilitado'],
    ["const f=document.createElement('form');document.getElementById('barra-exp').appendChild(f);f.appendChild(document.getElementById('salvar'))", 'Salvar dentro de form'],
    ["document.getElementById('sec-exp').replaceWith(document.getElementById('sec-exp').cloneNode(true));document.getElementById('abrir-exp').onclick=()=>document.getElementById('sec-exp').classList.toggle('fechado')", 'Salvar nunca aparece'],
    ["document.getElementById('activitiesPerformed-0').readOnly=true", 'descrição somente leitura'],
  ];
  for (const [mudanca, nome] of casos) {
    const p = await pagina(t, portal('gupy-curriculo'));
    const executar = await preparar(p);
    await p.avaliar(mudanca);
    assert.match((await executar()).erro, /ação humana/, nome);
    assert.equal(await p.avaliar('document.body.dataset.salvo ?? null'), null, nome);
    assert.equal(await p.avaliar("document.getElementById('activitiesPerformed-0').value"), 'Gestão de produto de uma plataforma interna de dados.', nome);
  }
  // Empresa trocada no mesmo índice depois da proposta: recusa.
  const p = await pagina(t, portal('gupy-curriculo'));
  const executar = await preparar(p);
  await p.avaliar("document.getElementById('companyName-0').value='Empresa Delta'");
  assert.match((await executar()).erro, /ação humana/);
});

test('o hook libera o script fixo de abrir a seção Experiência na aba de perfil', () => {
  const estado = { abas: [{ tab_id: '9', session_id: 's1', itens: [] }] };
  const entrada = text => ({ tool_name: 'mcp__claude-in-chrome__javascript_tool', session_id: 's1', tool_input: { tabId: 9, text } });
  assert.equal(decidirPerfil(entrada(SCRIPT_ABRIR_EXPERIENCIA), estado).decisao, 'permitir');
  assert.equal(decidirPerfil(entrada("document.getElementById('abrir-exp').click()"), estado).decisao, 'negar');
});

test('na página: o script de abrir a seção abre uma vez e não fecha se já estiver aberta', { skip: semNavegador }, async t => {
  const p = await pagina(t, portal('gupy-curriculo'));
  assert.deepEqual(await p.avaliar(SCRIPT_ABRIR_EXPERIENCIA), { aberta: 'clicada' });
  assert.deepEqual(await p.avaliar(SCRIPT_ABRIR_EXPERIENCIA), { aberta: true });
  assert.equal(await p.avaliar("getComputedStyle(document.getElementById('sec-exp')).display"), 'block');
});
