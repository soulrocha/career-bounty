import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, run, tempDir } from '../helpers/cli.mjs';
import { readEvents } from '../../core/store/events.mjs';
import { createRunner } from '../../core/llm/runner.mjs';
import { contatoCommands } from '../../core/cli/contato.mjs';

const kbDir = path.join(repoRoot, 'tests', 'fixtures', 'kb-quadrantes');
const NOW = '2026-10-18T15:00:00.000-03:00';

async function ambiente(t) {
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  await cp(kbDir, path.join(dataRoot, 'kb'), { recursive: true });
  return dataRoot;
}

test('contato registrar grava evento contato.registrado no log', async t => {
  const dataRoot = await ambiente(t);

  const res = run([
    'contato', 'registrar',
    '--canal', 'linkedin',
    '--direcao', 'recebido',
    '--nome', 'Mariana Recruiter',
    '--papel', 'Senior Recruiter',
    '--resumo', 'Abordagem sobre vaga de liderança técnica',
    '--pergunta', 'Qual sua pretensão PJ?',
    '--data', '2026-10-18',
    '--endereco', 'linkedin.com/in/mariana-test',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot });

  assert.equal(res.status, 0, res.stderr);
  assert.ok(res.json?.id);
  assert.equal(res.json.ok, true);

  const { eventos } = await readEvents(dataRoot);
  const evento = eventos.find(e => e.tipo === 'contato.registrado');
  assert.ok(evento);
  assert.equal(evento.entidade_id, res.json.id);
  assert.equal(evento.dados.canal, 'linkedin');
  assert.equal(evento.dados.direcao, 'recebido');
  assert.equal(evento.dados.pessoa.nome, 'Mariana Recruiter');
  assert.equal(evento.dados.resumo, 'Abordagem sobre vaga de liderança técnica');
  assert.equal(evento.dados.pergunta, 'Qual sua pretensão PJ?');
});

test('contato listar filtra por vaga e por ativos', async t => {
  const dataRoot = await ambiente(t);

  // Registra 1 contato antigo (> 30 dias) e sem vaga
  run([
    'contato', 'registrar',
    '--canal', 'email',
    '--direcao', 'recebido',
    '--resumo', 'Contato antigo',
    '--data', '2026-08-01',
    '--now', NOW,
    '--teste',
  ], { dataRoot });

  // Registra 1 contato recente com vaga vaga-1
  run([
    'contato', 'registrar',
    '--vaga', 'vaga-1',
    '--canal', 'whatsapp',
    '--direcao', 'enviado',
    '--resumo', 'Contato recente vaga 1',
    '--data', '2026-10-18',
    '--now', NOW,
    '--teste',
  ], { dataRoot });

  // Registra 1 contato recente com vaga vaga-2
  run([
    'contato', 'registrar',
    '--vaga', 'vaga-2',
    '--canal', 'telefone',
    '--direcao', 'recebido',
    '--resumo', 'Contato recente vaga 2',
    '--data', '2026-10-17',
    '--now', NOW,
    '--teste',
  ], { dataRoot });

  // Listar todos
  const todos = run(['contato', 'listar', '--now', NOW, '--teste', '--json'], { dataRoot });
  assert.equal(todos.status, 0);
  assert.equal(todos.json.total, 3);

  // Listar por vaga
  const porVaga = run(['contato', 'listar', '--vaga', 'vaga-1', '--now', NOW, '--teste', '--json'], { dataRoot });
  assert.equal(porVaga.status, 0);
  assert.equal(porVaga.json.total, 1);
  assert.equal(porVaga.json.contatos[0].resumo, 'Contato recente vaga 1');

  // Listar ativos (exclui o contato de agosto)
  const ativos = run(['contato', 'listar', '--ativos', '--now', NOW, '--teste', '--json'], { dataRoot });
  assert.equal(ativos.status, 0);
  assert.equal(ativos.json.total, 2);
});

test('contato vincular associa contato existente a uma vaga', async t => {
  const dataRoot = await ambiente(t);

  // Cria uma vaga sintética na projeção
  const pipeline = {
    vagas: [{ id: 'vaga-100', cargo: 'Tech Lead', empresa: 'Empresa Teste' }],
  };
  await writeFile(path.join(dataRoot, 'projections', 'pipeline-vagas.json'), JSON.stringify(pipeline));

  // Registra contato avulso
  const reg = run([
    'contato', 'registrar',
    '--canal', 'linkedin',
    '--direcao', 'recebido',
    '--resumo', 'Conversa com RH',
    '--data', '2026-10-18',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot });
  const contatoId = reg.json.id;

  // Tenta vincular a vaga inexistente -> erro
  const falha = run(['contato', 'vincular', '--contato', contatoId, '--vaga', 'vaga-fantasma', '--now', NOW, '--teste'], { dataRoot });
  assert.notEqual(falha.status, 0);
  assert.match(falha.stderr, /Vaga não encontrada/i);

  // Vincula com sucesso
  const ok = run(['contato', 'vincular', '--contato', contatoId, '--vaga', 'vaga-100', '--now', NOW, '--teste', '--json'], { dataRoot });
  assert.equal(ok.status, 0);
  assert.equal(ok.json.ok, true);

  const { eventos } = await readEvents(dataRoot);
  const eventoVinculo = eventos.find(e => e.tipo === 'contato.vinculado');
  assert.ok(eventoVinculo);
  assert.equal(eventoVinculo.dados.contato_id, contatoId);
  assert.equal(eventoVinculo.dados.vaga_id, 'vaga-100');
});

test('contato sugerir gera rascunho em outbox/contatos sem enviar mensagem', async t => {
  const dataRoot = await ambiente(t);

  // Registra contato com pergunta
  const reg = run([
    'contato', 'registrar',
    '--canal', 'email',
    '--direcao', 'recebido',
    '--nome', 'Recrutador Teste',
    '--resumo', 'Sondagem',
    '--pergunta', 'Qual sua experiência com Node.js?',
    '--data', '2026-10-18',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot });
  const contatoId = reg.json.id;

  // Executa sugerir com runner fake injetado
  const fakeRunner = createRunner({
    modo: 'fake',
    dataRoot,
    fake: async () => ({
      rascunhos: [
        {
          ref: 'resposta',
          texto: 'Trabalho com Node.js em microsserviços com foco em alta concorrência.',
          afirmacoes: ['AF-104'],
        },
      ],
    }),
  });

  const resposta = await contatoCommands.contato(['sugerir', '--contato', contatoId, '--now', NOW, '--teste'], {
    parseFlags: (rest, { allowed, withValue }) => {
      const v = {};
      for (let i = 0; i < rest.length; i++) {
        if (withValue.includes(rest[i])) v[rest[i]] = rest[++i];
        else v[rest[i]] = true;
      }
      return v;
    },
    runner: fakeRunner,
    dataRoot,
  });

  assert.equal(resposta.result.ok, true);
  const arquivoRascunho = path.join(dataRoot, 'outbox', 'contatos', `${contatoId}.md`);
  const conteudo = await readFile(arquivoRascunho, 'utf8');
  assert.match(conteudo, /Qual sua experiência com Node\.js\?/);
  assert.match(conteudo, /Trabalho com Node\.js/);
  assert.match(conteudo, new RegExp(contatoId));
});

test('contato remover grava contato.removido e remove o contato da listagem', async t => {
  const dataRoot = await ambiente(t);

  // Registra um contato de teste
  const reg = run([
    'contato', 'registrar',
    '--canal', 'linkedin',
    '--direcao', 'recebido',
    '--resumo', 'Contato teste para remover',
    '--data', '2026-10-18',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot });
  assert.equal(reg.status, 0);
  const contatoId = reg.json.id;

  // Verifica que consta na listagem
  const antes = run(['contato', 'listar', '--now', NOW, '--teste', '--json'], { dataRoot });
  assert.equal(antes.json.total, 1);

  // Tenta remover sem --contato -> erro
  const semId = run(['contato', 'remover', '--now', NOW, '--teste'], { dataRoot });
  assert.notEqual(semId.status, 0);
  assert.match(semId.stderr, /Informe --contato/i);

  // Tenta remover ID inexistente -> erro
  const naoExiste = run(['contato', 'remover', '--contato', 'con-fantasma', '--now', NOW, '--teste'], { dataRoot });
  assert.notEqual(naoExiste.status, 0);
  assert.match(naoExiste.stderr, /Contato não encontrado/i);

  // Remove com motivo
  const rem = run([
    'contato', 'remover',
    '--contato', contatoId,
    '--motivo', 'Inserido por engano em teste manual',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot });
  assert.equal(rem.status, 0, rem.stderr);
  assert.equal(rem.json.ok, true);
  assert.equal(rem.json.contato_id, contatoId);

  // Verifica que evento contato.removido foi gravado
  const { eventos } = await readEvents(dataRoot);
  const eventoRem = eventos.find(e => e.tipo === 'contato.removido');
  assert.ok(eventoRem);
  assert.equal(eventoRem.entidade_id, contatoId);
  assert.equal(eventoRem.dados.contato_id, contatoId);
  assert.equal(eventoRem.dados.motivo, 'Inserido por engano em teste manual');

  // Verifica que a listagem agora está vazia
  const depois = run(['contato', 'listar', '--now', NOW, '--teste', '--json'], { dataRoot });
  assert.equal(depois.json.total, 0);
  assert.deepEqual(depois.json.contatos, []);
});

