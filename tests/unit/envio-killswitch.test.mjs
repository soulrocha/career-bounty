import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isEnvioPausado, pausarEnvio, retomarEnvio, auditarDecisoes } from '../../core/apply/policy/killswitch.mjs';
import { orquestrarEnvio } from '../../core/apply/policy/orquestrador.mjs';
import { appendEvents } from '../../core/store/events.mjs';

test('F7.10: kill switch pausar, retomar e auditar decisões do dia', async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'cb-killswitch-'));
  try {
    assert.equal(await isEnvioPausado(dataRoot), false);

    // Pausar
    const pausa = await pausarEnvio(dataRoot, { motivo: 'manutenção de teste', ts: '2026-10-18T12:00:00.000Z' });
    assert.equal(pausa.ok, true);
    assert.equal(await isEnvioPausado(dataRoot), true);

    // Simular evento de tentativa negada
    await appendEvents(dataRoot, [{
      id: 'neg-1',
      ts: '2026-10-18T12:05:00.000Z',
      ator: 'hook',
      tipo: 'envio.negado',
      entidade: 'vaga',
      entidade_id: 'vaga-x',
      dados: { ferramenta: 'javascript_tool', motivo: 'kill switch ligado' }
    }], { now: '2026-10-18T12:05:00.000Z' });

    // Auditar
    const decisoes = await auditarDecisoes(dataRoot, { dia: '2026-10-18' });
    assert.equal(decisoes.length, 2); // envio.pausado + envio.negado
    assert.equal(decisoes[0].tipo, 'envio.pausado');
    assert.equal(decisoes[1].tipo, 'envio.negado');

    // Retomar
    const retomada = await retomarEnvio(dataRoot, { ts: '2026-10-18T12:10:00.000Z' });
    assert.equal(retomada.ok, true);
    assert.equal(await isEnvioPausado(dataRoot), false);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test('F7.10: orquestrador encadeia kill switch, política, reserva e driver', async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'cb-orq-'));
  try {
    const ts = '2026-10-18T12:00:00.000Z';
    const regras = [{
      id: 'regra-gh',
      acao: 'enviar_automatico',
      limite_dia: 2,
      quando: {
        portal: ['greenhouse'],
        aderencia: ['alta'],
        rascunhos_llm: 0,
        respostas_novas_na_rodada: 0,
        cv_gate: 'ok',
        ja_aplicada: false
      }
    }];

    const candidaturaValida = {
      id: 'vaga-gh-1',
      vaga_id: 'vaga-gh-1',
      portal: 'greenhouse',
      aderencia: 'alta',
      rascunhos_llm: 0,
      respostas_novas_na_rodada: 0,
      cv_gate: 'ok',
      ja_aplicada: false,
      url: 'https://boards.greenhouse.io/exemplo/jobs/123'
    };

    // 1. Com kill switch ativo, o orquestrador bloqueia antes de avaliar
    await pausarEnvio(dataRoot, { motivo: 'teste', ts });
    const rPausado = await orquestrarEnvio({
      dataRoot,
      regras,
      candidatura: candidaturaValida,
      respostas: {},
      ts
    });
    assert.equal(rPausado.estado, 'blocked');
    assert.equal(rPausado.motivo, 'envio_pausado');

    await retomarEnvio(dataRoot, { ts });

    // 2. Com condição falhando (ex: aderência média), o orquestrador para antes de enviar
    const rParar = await orquestrarEnvio({
      dataRoot,
      regras,
      candidatura: { ...candidaturaValida, aderencia: 'media' },
      respostas: {},
      ts
    });
    assert.equal(rParar.estado, 'parar_antes_de_enviar');

    // 3. Em dry-run simulado (fake driver), reserva e libera
    let driverChamado = false;
    const rDry = await orquestrarEnvio({
      dataRoot,
      regras,
      candidatura: candidaturaValida,
      respostas: {},
      dryRun: true,
      ts,
      executarDriverFake: async () => {
        driverChamado = true;
        return { estado: 'dry_run', preenchidos: ['nome', 'email'] };
      }
    });
    assert.equal(driverChamado, true);
    assert.equal(rDry.estado, 'dry_run');
    assert.equal(rDry.regra, 'regra-gh');
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
