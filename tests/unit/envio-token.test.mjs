import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { aprovarPorMensagem, consumirAprovacao, emitirAprovacaoPolitica, proporLote } from '../../core/apply/approval.mjs';

test('F7.9: token vinculado a requisição, hash do PDF e hash das respostas', async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'cb-token-'));
  try {
    const ts = '2026-10-18T10:00:00.000Z';
    // 1. Propor lote com hash do PDF e das respostas
    await proporLote(dataRoot, {
      vagas: [{
        vaga_id: 'vaga-1',
        empresa: 'Empresa Alfa',
        cargo: 'Engenheiro',
        rota: 'greenhouse',
        hash_pdf: 'pdf-sha-123',
        hash_respostas: 'resp-sha-456'
      }],
      ts
    });

    // 2. Aprovar por mensagem
    const aprovadas = await aprovarPorMensagem(dataRoot, {
      mensagem: 'enviar estas 1: Empresa Alfa (Engenheiro)',
      ts
    });
    assert.deepEqual(aprovadas, ['vaga-1']);

    // 3. Tentar consumir com hash diferente de PDF: deve falhar
    const falhaPdf = await consumirAprovacao(dataRoot, {
      vagaId: 'vaga-1',
      hashPdf: 'pdf-sha-errado',
      hashRespostas: 'resp-sha-456',
      ts
    });
    assert.equal(falhaPdf.ok, false);
    assert.match(falhaPdf.motivo, /hash do PDF divergente/);

    // 4. Tentar consumir com hash diferente de respostas: deve falhar
    const falhaResp = await consumirAprovacao(dataRoot, {
      vagaId: 'vaga-1',
      hashPdf: 'pdf-sha-123',
      hashRespostas: 'resp-sha-errado',
      ts
    });
    assert.equal(falhaResp.ok, false);
    assert.match(falhaResp.motivo, /hash das respostas divergente/);

    // 5. Consumir com hashes corretos: sucesso
    const ok = await consumirAprovacao(dataRoot, {
      vagaId: 'vaga-1',
      hashPdf: 'pdf-sha-123',
      hashRespostas: 'resp-sha-456',
      ts
    });
    assert.equal(ok.ok, true);

    // 6. Reuso: deve falhar
    const reuso = await consumirAprovacao(dataRoot, {
      vagaId: 'vaga-1',
      hashPdf: 'pdf-sha-123',
      hashRespostas: 'resp-sha-456',
      ts
    });
    assert.equal(reuso.ok, false);
    assert.match(reuso.motivo, /já usada ou vencida/);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test('F7.9: token emitido pela política só vale para o driver e não para a sessão humana', async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'cb-token-pol-'));
  try {
    const ts = '2026-10-18T10:00:00.000Z';
    await emitirAprovacaoPolitica(dataRoot, {
      vagaId: 'vaga-auto',
      hashPdf: 'pdf-hash-abc',
      hashRespostas: 'resp-hash-def',
      ts
    });

    // Tentativa pelo contexto humano (sessão interativa): recusado
    const tentaHumano = await consumirAprovacao(dataRoot, {
      vagaId: 'vaga-auto',
      contexto: 'humano',
      hashPdf: 'pdf-hash-abc',
      hashRespostas: 'resp-hash-def',
      ts
    });
    assert.equal(tentaHumano.ok, false);
    assert.match(tentaHumano.motivo, /política só vale para o processo do driver/);

    // Pelo contexto do driver: aprovado
    const tentaDriver = await consumirAprovacao(dataRoot, {
      vagaId: 'vaga-auto',
      contexto: 'driver',
      hashPdf: 'pdf-hash-abc',
      hashRespostas: 'resp-hash-def',
      ts
    });
    assert.equal(tentaDriver.ok, true);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test('F7.9: hook PreToolUse nega sob kill switch e emite envio.negado em recusa de envio', async () => {
  const { spawnSync } = await import('node:child_process');
  const { marcarAba, scriptDeEnvio } = await import('../../core/apply/sessao.mjs');
  const { pausarEnvio } = await import('../../core/apply/policy/killswitch.mjs');
  const { readEvents } = await import('../../core/store/events.mjs');

  const dataRoot = await mkdtemp(path.join(tmpdir(), 'cb-hook-neg-'));
  try {
    const ts = '2026-10-18T10:00:00.000Z';
    await marcarAba(dataRoot, { tabId: 10, vagaId: 'vaga-neg', ts });

    const chamarHook = entrada => {
      const r = spawnSync(process.execPath, [path.join(process.cwd(), 'hooks', 'pre-tool-use.mjs')], {
        input: JSON.stringify(entrada),
        encoding: 'utf8',
        env: { ...process.env, DATA_ROOT: dataRoot, CAREER_BOUNTY_NOW: ts }
      });
      return r.stdout ? JSON.parse(r.stdout.trim()) : null;
    };

    // 1. Chamada de scriptDeEnvio sem aprovação: nega e emite envio.negado
    const envioSemAprov = {
      tool_name: 'mcp__claude-in-chrome__javascript_tool',
      tool_input: { action: 'javascript_exec', text: scriptDeEnvio('vaga-neg'), tabId: 10 }
    };
    const r1 = chamarHook(envioSemAprov);
    assert.equal(r1?.hookSpecificOutput?.permissionDecision, 'deny');

    const eventos1 = (await readEvents(dataRoot)).eventos;
    const negados1 = eventos1.filter(e => e.tipo === 'envio.negado');
    assert.equal(negados1.length, 1);
    assert.equal(negados1[0].entidade_id, 'vaga-neg');

    // 2. Com kill switch ligado: nega qualquer ferramenta de navegador na aba
    await pausarEnvio(dataRoot, { motivo: 'bloqueio preventivo', ts });
    const r2 = chamarHook(envioSemAprov);
    assert.equal(r2?.hookSpecificOutput?.permissionDecision, 'deny');
    assert.match(r2.hookSpecificOutput.permissionDecisionReason, /kill switch/);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
