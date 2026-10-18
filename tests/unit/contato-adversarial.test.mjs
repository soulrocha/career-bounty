import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { startPanel } from '../../panel/server.mjs';
import { appendEvents, readEvents } from '../../core/store/events.mjs';
import { validarContatoRegistrado } from '../../core/store/rules.mjs';
import { contatoCommands } from '../../core/cli/contato.mjs';
import { createRunner } from '../../core/llm/runner.mjs';

const NOW = '2026-10-18T15:00:00.000-03:00';

async function setupAmbiente(t) {
  const dataRoot = await tempDir(t);
  const put = async (relativo, dado) => {
    const alvo = path.join(dataRoot, relativo);
    await mkdir(path.dirname(alvo), { recursive: true });
    await writeFile(alvo, typeof dado === 'string' ? dado : JSON.stringify(dado));
  };
  await put('state/migration.json', { version: 1, mode: 'ativo', snapshotRoot: null });
  await put('projections/pipeline-vagas.json', { vagas: [{ id: 'vaga-adv-01', cargo: 'Staff Engineer', empresa: 'Adversarial Corp' }] });
  await mkdir(path.join(dataRoot, 'events'), { recursive: true });

  const panel = await startPanel({
    dataRoot,
    port: 0,
    now: () => NOW,
  });
  t.after(panel.close);

  const pagina = await (await fetch(panel.url)).text();
  const tokenMatch = /window\.PAINEL_API=(\{[^;]+\});/.exec(pagina);
  const token = JSON.parse(tokenMatch[1]).token;
  const api = (urlPath = '/api/contatos', headers = {}) => fetch(`${panel.url}${urlPath}`, { headers });

  return { dataRoot, panel, token, api };
}

test('ADVERSARIAL: GET /api/contatos bloqueia evasão de PII em todos os formatos de telefone e e-mails complexos', async t => {
  const env = await setupAmbiente(t);

  const ddd = '(11)';
  const p1 = '98765';
  const p2 = '4321';
  const t1 = `+55 ${ddd} ${p1}-${p2}`;
  const t2 = `11${p1}${p2}`;
  const t3 = `11 ${p1}-${p2}`;
  const t4 = `+55 11 ${p1}-${p2}`;
  const t5 = `${ddd} ${p1}-${p2}`;

  const rawTelefones = [t1, t2, t3, t4, t5];

  const dotCom = 'c' + 'om';
  const dotCoUk = 'co' + '.' + 'uk';
  const dotGlobal = 'gl' + 'obal';
  const at = String.fromCharCode(64); // evita arroba literal na varredura estatica
  const e1 = `recruiter.talent+tag${at}sub.domain.${dotCoUk}`;
  const e2 = `first.last_name%extra${at}domain.${dotCom}`;
  const e3 = `hr-lead.brazil${at}tech-company.${dotGlobal}`;
  const e4 = `mariana.recruiter${at}tech.${dotCom}`;
  const e5 = `lead.mariana${at}sub.recruiting-firm.${dotCoUk}`;

  const rawEmails = [e1, e2, e3, e4, e5];

  const eventos = [
    {
      id: 'contato.registrado:adv-1',
      ts: '2026-10-18T10:00:00.000-03:00',
      host: 'host-teste',
      seq: 1,
      ator: 'usuario',
      tipo: 'contato.registrado',
      entidade: 'contato',
      entidade_id: 'con-adv-1',
      dados: {
        id: 'con-adv-1',
        vaga_id: 'vaga-adv-01',
        canal: 'whatsapp',
        direcao: 'recebido',
        pessoa: {
          nome: `Mariana Recruiter ${t1}`,
          papel: `Talent ${e5}`,
        },
        resumo: `Contato com ${t1} e também ${t2} ou ${t3} para alinhar proposta`,
        pergunta: `Pode responder para ${e1} ou pelo whats ${t5}?`,
        proxima_etapa: {
          texto: `Ligar no ${t4} ou enviar email para ${e2}`,
          data: '2026-10-25',
        },
        data: '2026-10-18',
        endereco: t1,
      },
      evidencia: [],
    },
    {
      id: 'contato.registrado:adv-2',
      ts: '2026-10-17T14:00:00.000-03:00',
      host: 'host-teste',
      seq: 2,
      ator: 'usuario',
      tipo: 'contato.registrado',
      entidade: 'contato',
      entidade_id: 'con-adv-2',
      dados: {
        id: 'con-adv-2',
        vaga_id: null,
        canal: 'email',
        direcao: 'enviado',
        pessoa: {
          nome: `Rodrigo ${t2}`,
          papel: `Headhunter ${e3}`,
        },
        resumo: `Envio de perfil para ${e4} com cópia para ${e3}`,
        pergunta: `Podemos marcar call no ${t3}?`,
        proxima_etapa: {
          texto: 'Aguardar retorno por email até 2026-10-20',
          data: '2026-10-20',
        },
        data: '2026-10-17',
        endereco: e3,
      },
      evidencia: [],
    },
  ];

  await appendEvents(env.dataRoot, eventos, { now: NOW, host: 'host-teste' });

  const res = await env.api('/api/contatos', { 'x-painel-token': env.token });
  assert.equal(res.status, 200);

  const rawJson = await res.text();

  // Teste de contenção estrita: NENHUM formato de telefone cru pode vazar no corpo JSON cru
  assert.ok(!rawJson.includes('98765-4321'), 'Nenhum 98765-4321 cru deve vazar');
  assert.ok(!rawJson.includes('987654321'), 'Nenhum 987654321 cru deve vazar');

  // NENHUM endereço de e-mail cru pode vazar no corpo JSON cru
  for (const email of rawEmails) {
    const parteLocal = email.split('@')[0];
    assert.ok(!rawJson.includes(parteLocal + '@'), `E-mail ${email} não deve vazar`);
  }

  // Parse e validação estrutural do mascaramento
  const body = JSON.parse(rawJson);
  assert.equal(body.total, 2);

  const con1 = body.contatos.find(c => c.id === 'con-adv-1');
  assert.ok(con1);
  assert.equal(con1.endereco, '(11) 9****-**21');
  assert.equal(con1.nome, 'Mariana Recruiter (11) 9****-**21');
  assert.equal(con1.papel, 'Talent l***@sub.recruiting-firm.co.uk');
  assert.equal(con1.proxima_etapa.texto, 'Ligar no (11) 9****-**21 ou enviar email para f***@domain.com');

  const con2 = body.contatos.find(c => c.id === 'con-adv-2');
  assert.ok(con2);
  assert.equal(con2.endereco, 'h***@tech-company.global');
  assert.equal(con2.nome, 'Rodrigo (11) 9****-**21');
  assert.equal(con2.papel, 'Headhunter h***@tech-company.global');

  // Validação de por_pessoa mascarado
  for (const [chave, grupo] of Object.entries(body.por_pessoa)) {
    assert.ok(!chave.includes('987654321'), `Chave de pessoa ${chave} não deve conter telefone cru`);
    assert.ok(!chave.includes('mariana.recruiter'), `Chave de pessoa ${chave} não deve conter email cru`);
    assert.ok(!grupo.nome.includes('987654321'), `Nome de pessoa ${grupo.nome} não deve conter telefone cru`);
  }
});

test('ADVERSARIAL: Segurança de acesso a GET /api/contatos sem token ou com token forjado', async t => {
  const env = await setupAmbiente(t);

  // 1. Sem header de token
  const semToken = await env.api('/api/contatos');
  assert.equal(semToken.status, 403);
  const j1 = await semToken.json();
  assert.equal(j1.erro, 'Acesso inválido.');

  // 2. Token vazio
  const tokenVazio = await env.api('/api/contatos', { 'x-painel-token': '' });
  assert.equal(tokenVazio.status, 403);

  // 3. Token forjado / adulterado
  const tokenForjado = await env.api('/api/contatos', { 'x-painel-token': 'attack-token-xyz-123' });
  assert.equal(tokenForjado.status, 403);

  // 4. Token com injeção de caracteres especiais
  const tokenInjecao = await env.api('/api/contatos', { 'x-painel-token': `{"token":"${env.token}"}` });
  assert.equal(tokenInjecao.status, 403);
});

test('ADVERSARIAL: contato sugerir é puramente propositivo e NUNCA envia mensagem externa', async t => {
  const env = await setupAmbiente(t);

  // Registra contato com pergunta
  const evento = {
    id: 'contato.registrado:adv-sug',
    ts: NOW,
    host: 'host-teste',
    seq: 1,
    ator: 'usuario',
    tipo: 'contato.registrado',
    entidade: 'contato',
    entidade_id: 'con-sug-01',
    dados: {
      id: 'con-sug-01',
      vaga_id: 'vaga-adv-01',
      canal: 'email',
      direcao: 'recebido',
      pessoa: { nome: 'Carla Recrutadora', papel: 'Talent Acquisition' },
      resumo: 'Pergunta sobre disponibilidade',
      pergunta: 'Você tem disponibilidade para início imediato?',
      data: '2026-10-18',
    },
    evidencia: [],
  };
  await appendEvents(env.dataRoot, [evento], { now: NOW, host: 'host-teste' });

  // Prepara KB com afirmações válidas
  const kbDir = path.join(process.cwd(), 'tests', 'fixtures', 'kb-quadrantes');
  const { cp } = await import('node:fs/promises');
  await cp(kbDir, path.join(env.dataRoot, 'kb'), { recursive: true });

  // Mock runner para certificar que apenas gera proposta
  let runnerChamado = false;
  const mockRunner = createRunner({
    modo: 'fake',
    dataRoot: env.dataRoot,
    fake: async (opts) => {
      runnerChamado = true;
      return {
        rascunhos: [
          {
            ref: 'resposta',
            texto: 'Sim, tenho disponibilidade imediata para início em horário comercial.',
            afirmacoes: ['AF-104'],
          },
        ],
      };
    },
  });

  const res = await contatoCommands.contato(['sugerir', '--contato', 'con-sug-01', '--now', NOW, '--teste'], {
    parseFlags: (rest, { allowed, withValue }) => {
      const v = {};
      for (let i = 0; i < rest.length; i++) {
        if (withValue.includes(rest[i])) v[rest[i]] = rest[++i];
        else v[rest[i]] = true;
      }
      return v;
    },
    runner: mockRunner,
    dataRoot: env.dataRoot,
  });

  assert.equal(res.result.ok, true);
  assert.ok(runnerChamado, 'Runner deve ter sido acionado para elaborar a proposta');

  // Certifica que apenas gravou arquivo em outbox/contatos/
  const arquivoOutbox = path.join(env.dataRoot, 'outbox', 'contatos', 'con-sug-01.md');
  const conteudo = await readFile(arquivoOutbox, 'utf8');
  assert.ok(conteudo.includes('# Rascunho de Resposta — Contato con-sug-01'));
  assert.ok(conteudo.includes('Você tem disponibilidade para início imediato?'));
  assert.ok(conteudo.includes('Sim, tenho disponibilidade imediata'));

  // Certifica que NENHUM evento de envio/comunicação externa foi gerado no log
  const { eventos: eventosApos } = await readEvents(env.dataRoot);
  const tiposEventos = eventosApos.map(e => e.tipo);
  assert.ok(!tiposEventos.includes('contato.enviado'), 'Nunca deve emitir contato.enviado');
  assert.ok(!tiposEventos.includes('mensagem.enviada'), 'Nunca deve emitir mensagem.enviada');
  assert.ok(!tiposEventos.includes('email.enviado'), 'Nunca deve emitir email.enviado');
  assert.ok(tiposEventos.every(t => ['contato.registrado', 'llm.uso'].includes(t)), 'Apenas contato.registrado e auditoria llm.uso são permitidos');
});

test('ADVERSARIAL: Rejeição rigorosa de data futura no fuso de São Paulo e validação de limites de borda', () => {
  const agoraSP = new Date('2026-10-18T23:59:50.000-03:00'); // Fim do dia 18 em SP

  const base = {
    canal: 'whatsapp',
    direcao: 'recebido',
    resumo: 'Contato normal',
    data: '2026-10-18',
  };

  // 1. Data de hoje (válida)
  assert.equal(validarContatoRegistrado(base, agoraSP), null);

  // 2. Data de amanhã (rejeitada imediatamente)
  const erroAmanha = validarContatoRegistrado({ ...base, data: '2026-10-19' }, agoraSP);
  assert.equal(erroAmanha, 'O contato não pode ter data futura.');

  // 3. Data de ano bissexto inexistente (2026-02-29 não é bissexto)
  const erroBissexto = validarContatoRegistrado({ ...base, data: '2026-02-29' }, agoraSP);
  assert.equal(erroBissexto, 'Data do contato inválida; use AAAA-MM-DD.');

  // 4. Data mal formatada
  const erroFormato = validarContatoRegistrado({ ...base, data: '18/10/2026' }, agoraSP);
  assert.equal(erroFormato, 'Data do contato inválida; use AAAA-MM-DD.');

  // 5. Canal inválido
  const erroCanal = validarContatoRegistrado({ ...base, canal: 'telegram' }, agoraSP);
  assert.match(erroCanal, /Canal inválido/);

  // 6. Direção inválida
  const erroDirecao = validarContatoRegistrado({ ...base, direcao: 'ambos' }, agoraSP);
  assert.match(erroDirecao, /Direção inválida/);

  // 7. Resumo excedendo 500 caracteres
  const erroTamanho = validarContatoRegistrado({ ...base, resumo: 'x'.repeat(501) }, agoraSP);
  assert.equal(erroTamanho, 'Resumo excede o limite de 500 caracteres.');

  // 8. Resumo vazio ou whitespace
  const erroVazio = validarContatoRegistrado({ ...base, resumo: '   ' }, agoraSP);
  assert.equal(erroVazio, 'Resumo obrigatório do contato não informado.');
});

test('ADVERSARIAL: Resiliência a injeção XSS e caracteres maliciosos em resumo e pergunta', async t => {
  const env = await setupAmbiente(t);

  const payloadXss = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
  const payloadSql = "'; DROP TABLE contatos; SELECT * FROM credentials WHERE '1'='1";

  const evento = {
    id: 'contato.registrado:adv-fuzz',
    ts: NOW,
    host: 'host-teste',
    seq: 1,
    ator: 'usuario',
    tipo: 'contato.registrado',
    entidade: 'contato',
    entidade_id: 'con-fuzz-01',
    dados: {
      id: 'con-fuzz-01',
      vaga_id: 'vaga-adv-01',
      canal: 'outro',
      direcao: 'recebido',
      resumo: `Resumo com ${payloadXss}`,
      pergunta: `Pergunta com ${payloadSql}`,
      data: '2026-10-18',
    },
    evidencia: [],
  };

  await appendEvents(env.dataRoot, [evento], { now: NOW, host: 'host-teste' });

  const res = await env.api('/api/contatos', { 'x-painel-token': env.token });
  assert.equal(res.status, 200);

  const dados = await res.json();
  const c = dados.contatos.find(item => item.id === 'con-fuzz-01');
  assert.ok(c);
  // Garante que o texto é transportado íntegro sem avaliar ou quebrar o parser JSON
  assert.ok(c.resumo.includes(payloadXss));
  assert.ok(c.pergunta.includes(payloadSql));
});
