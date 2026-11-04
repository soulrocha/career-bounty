import assert from 'node:assert/strict';
import test from 'node:test';
import { gerarCvsAutomaticos, vagasParaCvAutomatico } from '../../core/cv/lote.mjs';

const vaga = (id, extra = {}) => ({ id, aderencia: 'alta', url_status: 'aberta', portal_candidatura: 'Lever', ...extra });

test('CV automático: alta, boa, média e condicional abertas, sem CV, sem candidatura e sem descarte', () => {
  const vagas = [
    vaga('alta'), vaga('boa', { aderencia: 'boa' }), vaga('media', { aderencia: 'media' }), vaga('cond', { aderencia: 'condicional' }),
    vaga('baixa', { aderencia: 'baixa' }), vaga('incomp', { aderencia: 'incompativel' }), vaga('pend', { aderencia: 'pendente' }),
    vaga('encerrada', { url_status: 'encerrada' }), vaga('ja-tem'), vaga('aplicada', { candidatura_usuario: { aplicada: true } }),
    vaga('descartada', { descarte_usuario: { descartada: true } }), vaga('gupy', { portal_candidatura: 'Gupy', url: 'https://exemplo.gupy.io/jobs/1' }),
  ];
  assert.deepEqual(vagasParaCvAutomatico(vagas, { comCv: new Set(['ja-tem']), settings: { cv_skip_portals: ['gupy'] } }).map(v => v.id), ['alta', 'boa', 'media', 'cond']);
});

test('lote gera uma por vez, conta gerados e bloqueados, e falha de uma vaga não para as outras', async () => {
  const chamadas = [];
  const gerar = async ({ vagaId }) => {
    chamadas.push(vagaId);
    if (vagaId === 'b') throw new Error('navegador ausente');
    return { gerado: true, gate: { status: vagaId === 'c' ? 'bloqueado' : 'ok' } };
  };
  const r = await gerarCvsAutomaticos({ dataRoot: 'x', settings: { cv_skip_portals: ['gupy'] }, vagas: [vaga('a'), vaga('b'), vaga('c')], comCv: new Set(), gerar, navegador: '/x' });
  assert.deepEqual(chamadas, ['a', 'b', 'c']);
  assert.deepEqual(r, { gerados: ['a'], bloqueados: ['c'], falhas: [{ id: 'b', erro: 'navegador ausente' }] });
});

test('lote sem navegador não chama gerar e devolve pulado sem_navegador', async () => {
  const chamadas = [];
  const gerar = async ({ vagaId }) => { chamadas.push(vagaId); return { gerado: true, gate: { status: 'ok' } }; };
  const r = await gerarCvsAutomaticos({ dataRoot: 'x', settings: { cv_skip_portals: ['gupy'] }, vagas: [vaga('a')], comCv: new Set(), gerar, navegador: null });
  assert.deepEqual(chamadas, []);
  assert.deepEqual(r, { gerados: [], bloqueados: [], falhas: [], pulado: 'sem_navegador' });
});
