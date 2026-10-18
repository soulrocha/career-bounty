import assert from 'node:assert/strict';
import test from 'node:test';
import { HOJE, bancoPersona, resposta } from '../helpers/apply.mjs';
import { pagina, portal, semNavegador } from '../helpers/navegador.mjs';
import { casarCampos } from '../../core/apply/matcher.mjs';
import { scriptDePreenchimento, preenchaVoce } from '../../core/apply/preencher.mjs';
import { SCRIPT_EXTRATOR, normalizarExtracao } from '../../core/apply/extrator.mjs';

const campo = (label, tipo = 'text', extra = {}) => ({ ref: 'c1', label, tipo, obrigatorio: true, ...extra });
const casar = (campos, respostas = bancoPersona(), ctx = {}) => casarCampos({ extracao: { campos }, respostas, hoje: HOJE, ...ctx });

test('rótulo igual preenche', () => {
  const r = casar([campo('LinkedIn Profile', 'text', { obrigatorio: false })]);
  assert.deepEqual(r.preenchimentos, [{ ref: 'c1', tipo: 'text', valor: 'https://linkedin.example/ana', resposta_id: 'linkedin', sensivel: false }]);
});

test('variantes do rótulo levam à mesma resposta', () => {
  for (const label of ['Pretensão salarial', 'Salário desejado', 'What are your salary expectations? *']) {
    assert.equal(casar([campo(label)]).preenchimentos[0]?.resposta_id, 'pretensao-salarial', label);
  }
});

test('normalização pt-BR: acento, caixa e pontuação', () => {
  assert.equal(casar([campo('  SALÁRIO-DESEJADO:  ')]).preenchimentos[0]?.resposta_id, 'pretensao-salarial');
});

test('tipo incompatível tenta opção equivalente; sem opção, vira desconhecido', () => {
  const sel = casar([campo('Are you legally authorized to work in Brazil?', 'select', { opcoes: ['Yes', 'No'] })]);
  assert.equal(sel.preenchimentos[0].valor, 'Yes');
  const banco = [resposta({ id: 'pcd', variantes_label: ['Você é PcD?'], resposta: false, sensivel: true, validade: null })];
  assert.equal(casar([campo('Você é PcD?', 'select', { opcoes: ['Sim', 'Não'] })], banco).preenchimentos[0].valor, 'Não');
  const semOpcao = casar([campo('Are you legally authorized to work in Brazil?', 'select', { opcoes: ['Citizen', 'Visa'] })]);
  assert.equal(semOpcao.preenchimentos.length, 0);
  assert.match(semOpcao.desconhecidos[0].motivo, /sem opção equivalente/);
  const numero = casar([campo('Pretensão salarial', 'number')]);
  assert.match(numero.desconhecidos[0].motivo, /não numérica/);
});

test('o escopo da resposta é respeitado', () => {
  const banco = [resposta({ id: 'sal-e1', escopo: { tipo: 'empresa', valor: 'Empresa 01' } })];
  assert.equal(casar([campo('Pretensão salarial')], banco, { empresa: 'Empresa 01' }).preenchimentos.length, 1);
  assert.equal(casar([campo('Pretensão salarial')], banco, { empresa: 'Empresa 02' }).preenchimentos.length, 0);
});

test('obrigatório sem resposta vira desconhecido; opcional sem resposta é ignorado', () => {
  const r = casar([campo('Por que você quer trabalhar aqui?', 'textarea'), campo('Site pessoal', 'url', { ref: 'c2', obrigatorio: false })]);
  assert.deepEqual(r.desconhecidos.map(d => [d.ref, d.motivo]), [['c1', 'sem resposta no answer bank']]);
  assert.deepEqual(r.ignorados.map(d => d.ref), ['c2']);
});

test('formulário só com campos conhecidos: tudo preenchido e zero chamada ao LLM', { skip: semNavegador }, async t => {
  const p = await pagina(t, portal('greenhouse'));
  const extracao = normalizarExtracao(await p.avaliar(SCRIPT_EXTRATOR));
  const r = casarCampos({ extracao, respostas: bancoPersona(), hoje: HOJE });
  assert.equal(r.chamadas_llm, 0);
  assert.deepEqual(r.desconhecidos, []);
  assert.equal(r.preenchimentos.length, extracao.campos.length);
  assert.deepEqual(r.preenchimentos.find(x => x.tipo === 'file'), { ref: 'c5', tipo: 'file', arquivo: 'cv_ats' });

  // Fluxo assistido: o script não leva resposta sensível; ela volta como "preencha você".
  const script = scriptDePreenchimento(r.preenchimentos);
  assert.doesNotMatch(script, /10\.000|90000|Decline/);
  assert.deepEqual(preenchaVoce(r).map(x => x.ref).sort(), ['c4', 'c7', 'c9']);
  const res = await p.avaliar(script);
  assert.deepEqual(res.falharam, []);
  const lido = await p.avaliar(`({ nome: document.getElementById('first_name').value, email: document.getElementById('email').value, auth: document.getElementById('auth').value, sal: document.getElementById('salary').value })`);
  assert.deepEqual(lido, { nome: 'Ana', email: 'ana@exemplo.test', auth: '1', sal: '' });

  // Driver (sem LLM): com sensíveis, preenche tudo, inclusive rádio. Nunca clica em enviar.
  await p.avaliar(scriptDePreenchimento(r.preenchimentos, { sensiveis: true }));
  const tudo = await p.avaliar(`({ sal: document.getElementById('salary').value, genero: [...document.querySelectorAll('input[name=gender]')].find(e => e.checked)?.value, enviado: location.hash })`);
  assert.deepEqual(tudo, { sal: 'R$ 10.000 (CLT)', genero: 'x', enviado: '' });
});

test('grupo de checkbox e rádio da Gupy preenchidos pela opção', { skip: semNavegador }, async t => {
  const p = await pagina(t, portal('gupy'));
  const extracao = normalizarExtracao(await p.avaliar(SCRIPT_EXTRATOR));
  const banco = [
    resposta({ id: 'hibrido', variantes_label: ['Você possui disponibilidade para trabalho híbrido em Cidade Exemplo?'], resposta: true, sensivel: false, validade: null }),
    resposta({ id: 'ferramentas', variantes_label: ['Quais ferramentas você usa?'], resposta: ['SQL', 'Jira'], sensivel: false, validade: null }),
  ];
  const r = casarCampos({ extracao, respostas: banco, hoje: HOJE });
  await p.avaliar(scriptDePreenchimento(r.preenchimentos));
  const lido = await p.avaliar(`({ hib: document.querySelector('input[name=pergunta_2]:checked')?.value, ferr: [...document.querySelectorAll('input[name=ferramentas]:checked')].map(e => e.value) })`);
  assert.deepEqual(lido, { hib: 'sim', ferr: ['jira', 'sql'] });
  assert.deepEqual(r.desconhecidos.map(d => d.label), ['Qual a sua pretensão salarial?', 'Você é uma pessoa com deficiência (PcD)?', 'Conte sobre um projeto em que você liderou uma migração.']);
});
