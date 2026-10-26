import assert from 'node:assert/strict';
import test from 'node:test';
import { hardFilter } from '../../core/score/hard.mjs';
import { preScore, triagemPre } from '../../core/score/prescore.mjs';
import { makeVaga } from '../../core/sources/vaga.mjs';
import { validateSettings } from '../../core/config.mjs';

const criterios = {
  regiao_presencial: ['cidade exemplo'], clt: { onsite_min: 10000, remote_hybrid_min: 12000 }, pj: { min: 15000 },
  titulos_alvo: ['gerente de engenharia', 'tech lead'], palavras_chave: ['plataforma', 'lideranca', 'cloud', 'arquitetura'],
  palavras_negativas: ['estagio', 'junior'], corte_prescore: 0.4,
};
const v = extra => makeVaga({ fonte: 'a', portal: 'gupy', requisicao_id: '1', empresa: 'Empresa Alfa', cargo: 'Gerente de Engenharia', local: 'Cidade Exemplo, MG', modalidade: 'remoto', regime: 'CLT',
  url: 'https://x.exemplo.test/1', descricao: 'Lideranca de plataforma cloud e arquitetura.', ...extra });

test('local fora do Brasil é descartado com motivo', () => {
  const r = hardFilter(v({ local: 'Austin, United States' }), criterios);
  assert.equal(r.descartada, true);
  assert.deepEqual(r.motivos, ['Local fora do Brasil']);
  assert.equal(hardFilter(v({ local: 'Brasil' }), criterios).descartada, false);
});

test('presencial fora da região descarta; regime e modalidade seguem a configuração', () => {
  assert.equal(hardFilter(v({ modalidade: 'presencial', local: 'Outra Cidade, SP' }), criterios).descartada, true);
  assert.equal(hardFilter(v({ modalidade: 'presencial', local: 'Cidade Exemplo, MG' }), criterios).descartada, false);
  assert.equal(hardFilter(v({ regime: 'PJ', salario_min: 9000, salario_max: 20000 }), criterios).descartada, false);
});

// Decisão de 22/10/2026: a vaga quase nunca divulga salário (997 de 1030 no pipeline real),
// então o piso deixou de ser portão. Ele continua no config.yml como referência de negociação.
test('salário nunca descarta no portão, divulgado ou não', () => {
  assert.equal(hardFilter(v({ salario_min: null, salario_max: null }), criterios).descartada, false);
  const baixo = hardFilter(v({ salario_min: 4000, salario_max: 6000 }), criterios);
  assert.equal(baixo.descartada, false);
  assert.doesNotMatch(baixo.motivos.join(' '), /piso/i);
  const fixo = hardFilter(v({ salario: 3000 }), criterios);
  assert.equal(fixo.descartada, false);
  assert.doesNotMatch(fixo.motivos.join(' '), /piso/i);
});

test('o portão não expõe piso nas condições, mesmo com piso configurado', () => {
  const r = hardFilter(v({ salario_min: 4000, salario_max: 6000 }), criterios);
  assert.equal(r.condicoes.piso, null);
  assert.notEqual(r.condicoes.situacao, 'incompativel');
});

test('sem região presencial configurada, presencial não elimina', () => {
  assert.equal(hardFilter(v({ modalidade: 'presencial', local: 'Qualquer Lugar' }), { ...criterios, regiao_presencial: [] }).descartada, false);
});

test('pré-score abaixo do corte vira baixa e fica fora do delta; acima entra', () => {
  const fraca = triagemPre(v({ cargo: 'Estagiario de Marketing', descricao: 'estagio sem relacao.' }), criterios);
  assert.equal(fraca.nivel, 'baixa');
  assert.equal(fraca.delta, false);
  const forte = triagemPre(v(), criterios);
  assert.equal(forte.nivel, 'candidata');
  assert.equal(forte.delta, true);
  assert.ok(forte.pre_score > fraca.pre_score);
});

test('vaga descartada pelo filtro duro nunca entra no delta, mesmo com pré-score alto', () => {
  const r = triagemPre(v({ local: 'Austin, United States' }), criterios);
  assert.equal(r.descartada, true);
  assert.equal(r.delta, false);
});

test('os motivos são lista legível, estável e em ordem determinística', () => {
  const a = triagemPre(v({ cargo: 'Junior de Dados', descricao: 'estagio' }), criterios).motivos;
  const b = triagemPre(v({ cargo: 'Junior de Dados', descricao: 'estagio' }), criterios).motivos;
  assert.deepEqual(a, b);
  assert.ok(a.every(m => typeof m === 'string' && m.length > 3));
});

test('fluência e certificação ausentes nunca viram atendido', () => {
  const r = preScore(v({ descricao: 'Ingles fluente obrigatorio. Certificacao PMP desejavel. Plataforma cloud.' }), criterios);
  const tipos = r.criticos.map(c => c.tipo).sort();
  assert.deepEqual(tipos, ['certificacao', 'fluencia']);
  assert.ok(r.criticos.every(c => c.status === 'nao_comprovado'));
});

test('a configuração valida os critérios do radar', () => {
  const ok = validateSettings({ radar: { criterios } });
  assert.equal(ok.radar.criterios.corte_prescore, 0.4);
  assert.throws(() => validateSettings({ radar: { criterios: { corte_prescore: 3 } } }), /corte_prescore/);
  assert.throws(() => validateSettings({ radar: { criterios: { titulos_alvo: 'x' } } }), /titulos_alvo/);
});
