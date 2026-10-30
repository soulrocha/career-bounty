import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import { appendEvents, readEvents } from '../../core/store/events.mjs';
import { configurarSync, lerStatusSync, sincronizar, validarConfigSync } from '../../core/sync/index.mjs';
import { manifesto, sha256 } from '../../core/sync/arquivos.mjs';
import { sincronizavel } from '../../core/sync/regras.mjs';
import { remotoDel, remotoGet, remotoPut } from '../../core/sync/remoto.mjs';
import { cli, repoRoot, run, tempDir } from '../helpers/cli.mjs';

// O "servidor" dos testes é `node <cli>` local; a validação do comando só aceita isso com esta variável.
process.env.CAREER_BOUNTY_SYNC_TESTE = '1';

// QA adversarial da F11. Os testes marcados "ACHADO" descrevem o comportamento correto e FALHAM hoje, provando o defeito.
// Os marcados "SONDA" passam: registram o que foi atacado e se sustentou. Só pastas temporárias; sem ssh, sem rede.

async function cenario(t) {
  const raiz = await tempDir(t, 'cb-qa-sync-');
  const pcA = path.join(raiz, 'pc-a');
  const pcB = path.join(raiz, 'pc-b');
  const hub = path.join(raiz, 'hub');
  for (const pasta of [pcA, pcB]) {
    await mkdir(pasta, { recursive: true });
    const r = run(['sync', 'configurar', '--comando-json', JSON.stringify([process.execPath, cli]), '--raiz', hub, '--json'], { dataRoot: pasta });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  return { pcA, pcB, hub, raiz };
}
async function escrever(raiz, rel, conteudo) {
  await mkdir(path.dirname(path.join(raiz, rel)), { recursive: true });
  await writeFile(path.join(raiz, rel), conteudo);
}
const ler = (raiz, rel) => readFile(path.join(raiz, rel), 'utf8');
const existe = (raiz, rel) => readFile(path.join(raiz, rel)).then(() => true, () => false);
const sync = (dataRoot, extra = []) => run(['sync', ...extra, '--json'], { dataRoot });
const evento = (id, ts) => ({ id, ts, ator: 'humano', tipo: 'vaga.marcada', entidade: 'vaga', entidade_id: 'v1', dados: { marca: id } });

// Servidor em memória para exercitar sincronizar() sem processo filho.
function servidor(arquivos = {}, snapshotRoot = null) {
  const estado = { snapshotRoot, mapa: new Map(Object.entries(arquivos).map(([p, c]) => [p, Buffer.from(c)])), enviar: [], apagar: [] };
  estado.transporte = {
    async manifest() { return { snapshotRoot: estado.snapshotRoot, arquivos: new Map([...estado.mapa].map(([p, b]) => [p, sha256(b)])) }; },
    async baixar(paths, aoReceber) { for (const p of paths) await aoReceber({ path: p, sha256: sha256(estado.mapa.get(p)), bytes: estado.mapa.get(p) }); },
    async enviar(itens, lerBytes) {
      estado.enviar.push(itens.map(i => i.path));
      const resultados = [];
      const enviados = new Map();
      for (const item of itens) {
        const atual = await lerBytes(item);
        if (!atual) continue;
        enviados.set(item.path, atual.sha256);
        estado.mapa.set(item.path, atual.bytes);
        resultados.push({ path: item.path, ok: true });
      }
      return { resultados, enviados };
    },
    async apagar(itens) { estado.apagar.push(...itens.map(i => i.path)); for (const i of itens) estado.mapa.delete(i.path); return { resultados: itens.map(i => ({ path: i.path, ok: true })) }; },
  };
  return estado;
}
const rodada = (dataRoot, srv, agora = new Date('2026-10-30T22:00:00Z')) => sincronizar({ dataRoot, transporte: srv.transporte, agora });

// ---------------------------------------------------------------------------------------------------------------------
// ACHADOS

test('ACHADO A1 (alta): base perdida faz o log do próprio host, mais novo que o do servidor, sair do log vivo', async t => {
  const { pcA } = await cenario(t);
  await appendEvents(pcA, [evento('e1', '2026-10-28T15:00:00.000Z')], { host: 'pc-a' });
  assert.equal(sync(pcA).status, 0);
  await appendEvents(pcA, [evento('e2', '2026-10-28T16:00:00.000Z')], { host: 'pc-a' });
  // Restauração de backup, .sync apagado, reinstalação: a base some, o log local fica mais novo que o do servidor.
  await rm(path.join(pcA, '.sync', 'base.json'));
  assert.equal(sync(pcA).status, 0);
  const ids = (await readEvents(pcA)).eventos.map(e => e.id).sort();
  assert.deepEqual(ids, ['e1', 'e2'], 'o evento e2, gravado só neste PC, sumiu do log lido (foi para um .conflito- que o leitor ignora)');
});

test('ACHADO A2 (alta): dois PCs com o mesmo hostname perdem eventos de um deles, sem aviso', async t => {
  const { pcA, pcB } = await cenario(t);
  await appendEvents(pcA, [evento('a1', '2026-10-28T15:00:00.000Z')], { host: 'mesmo-nome' });
  await appendEvents(pcB, [evento('b1', '2026-10-28T16:00:00.000Z')], { host: 'mesmo-nome' });
  for (const pc of [pcA, pcB, pcA, pcB]) assert.equal(sync(pc).status, 0);
  for (const pc of [pcA, pcB]) {
    const ids = (await readEvents(pc)).eventos.map(e => e.id).sort();
    assert.deepEqual(ids, ['a1', 'b1'], `o log de ${path.basename(pc)} perdeu eventos`);
  }
});

test('ACHADO A3 (média): o aviso de conflito some na rodada seguinte, mas a cópia .conflito- continua em disco', async t => {
  const { pcA, pcB } = await cenario(t);
  await escrever(pcA, 'kb/answers.yml', 'v0');
  sync(pcA); sync(pcB);
  await escrever(pcA, 'kb/answers.yml', 'versao-a');
  await escrever(pcB, 'kb/answers.yml', 'versao-b');
  sync(pcA);
  assert.deepEqual(sync(pcB).json.conflitos, ['kb/answers.yml']);
  sync(pcB); // o painel faz isso a cada 120 s
  const pendentes = (await readdir(path.join(pcB, 'kb'))).filter(n => n.includes('.conflito-'));
  assert.equal(pendentes.length, 1);
  const status = run(['sync', 'status', '--json'], { dataRoot: pcB });
  assert.deepEqual(status.json.conflitos, ['kb/answers.yml'], 'a cópia continua sem ninguém ter resolvido, mas o status já não conta');
});

test('ACHADO A4 (média): um download que falha aborta a rodada inteira e nada local é enviado', async t => {
  const dir = await tempDir(t);
  await escrever(dir, 'kb/dir', 'arquivo local onde o servidor tem uma pasta');
  await escrever(dir, 'state/novo.json', '{"trabalho":"importante"}');
  const srv = servidor({ 'kb/dir/x.md': 'do servidor' });
  await rodada(dir, srv).catch(() => {});
  assert.ok(srv.enviar.flat().includes('state/novo.json'), 'state/novo.json devia subir; uma falha isolada vira pendente, não bloqueia o envio');
});

test('ACHADO A5 (média): trocar o snapshot em outro PC deixa migration.json apontando para backups que ainda não vieram', async t => {
  const dir = await tempDir(t);
  await escrever(dir, 'state/migration.json', JSON.stringify({ version: 1, mode: 'ativo', snapshotRoot: 'backups/X' }));
  await escrever(dir, 'backups/X/carreira/pipeline-vagas.json', '{}');
  const srv = servidor({}, 'backups/X');
  await rodada(dir, srv);
  // Outro PC refez a migração: servidor passa a ter o snapshot Y.
  srv.snapshotRoot = 'backups/Y';
  srv.mapa.set('state/migration.json', Buffer.from(JSON.stringify({ version: 1, mode: 'ativo', snapshotRoot: 'backups/Y' })));
  srv.mapa.set('backups/Y/carreira/pipeline-vagas.json', Buffer.from('{}'));
  await rodada(dir, srv, new Date('2026-10-30T22:05:00Z'));
  const estado = JSON.parse(await ler(dir, 'state/migration.json'));
  assert.equal(estado.snapshotRoot, 'backups/Y');
  assert.equal(await existe(dir, 'backups/Y/carreira/pipeline-vagas.json'), true, 'estado novo sem os arquivos do snapshot: o painel não abre até a rodada seguinte');
});

test('ACHADO A6 (média): estado de sessão de candidatura e de aprovação é por máquina e não deve ir para a base central', () => {
  // sessao-candidatura.json guarda ids de aba do navegador DESTE PC e libera scripts nelas; aprovacoes.json é consumida no envio.
  assert.equal(sincronizavel('state/sessao-candidatura.json', { snapshotRoot: null }), false);
  assert.equal(sincronizavel('state/aprovacoes.json', { snapshotRoot: null }), false);
});

test('ACHADO A7 (baixa): guarda de recuperação de lock (.recuperando) não é filtrada e pode subir', () => {
  assert.equal(sincronizavel('state/events.lock.recuperando', { snapshotRoot: null }), false);
});

test('ACHADO A8 (média): o comando salvo pode ser qualquer executável ou opção do ssh, e os hooks o executam sem pedir permissão', () => {
  const raiz = '/srv/cb';
  for (const comando of [['cmd.exe', '/c', 'calc.exe'], ['ssh', '-oProxyCommand=calc.exe', 'u@h', 'node', '/x.mjs'], ['ssh', '-oLocalCommand=calc.exe', '-oPermitLocalCommand=yes', 'u@h']]) {
    assert.throws(() => validarConfigSync({ comando, raiz }), undefined, `aceitou ${JSON.stringify(comando)}`);
  }
});

test('ACHADO A9 (baixa): validarConfigSync deixa passar metacaracteres do shell remoto além dos listados', () => {
  for (const parte of ['(id)', 'a\\b', '*', '?', '{a,b}', '#', '!x', '~', '[a]']) {
    assert.throws(() => validarConfigSync({ comando: ['ssh', 'u@h', 'node', parte], raiz: '/srv/cb' }), undefined, `aceitou ${JSON.stringify(parte)}`);
  }
});

test('ACHADO A10 (baixa): caminhos que o Windows não cria passam na regra e viram erro permanente na rodada', () => {
  for (const rel of ['kb/pergunta?.md', 'kb/a*b.md', 'kb/"x".md', 'kb/a|b.md', 'kb/nota.', 'kb/nota ', 'kb/CON.md', 'kb/nul']) {
    assert.equal(sincronizavel(rel, { snapshotRoot: '*' }), false, rel);
  }
});

test('ACHADO A11 (baixa): rodada que perde a disputa pelo lock grava ok:false em status.json', async t => {
  const dir = await tempDir(t);
  const lenta = servidor({});
  let soltar;
  const trava = new Promise(done => { soltar = done; });
  const original = lenta.transporte.manifest;
  lenta.transporte.manifest = async () => { await trava; return original(); };
  const primeira = rodada(dir, lenta);
  await new Promise(done => setTimeout(done, 150));
  await assert.rejects(rodada(dir, servidor({}), new Date('2026-10-30T22:01:00Z')), /em andamento/);
  const status = await lerStatusSync(dir);
  soltar();
  await primeira;
  assert.notEqual(status?.ok, false, 'a rodada concorrente não falhou de verdade; status.json não deveria virar "falhou" nem o hook avisar "dados desatualizados"');
});

test('ACHADO A12 (baixa): cache de hash por tamanho+mtime devolve hash velho quando o arquivo muda sem mudar de tamanho e mtime', async t => {
  const dir = await tempDir(t);
  const quando = new Date('2026-10-30T12:00:00Z');
  await escrever(dir, 'kb/a.md', 'AAAA');
  await utimes(path.join(dir, 'kb/a.md'), quando, quando);
  const antes = await manifesto(dir, { snapshotRoot: null });
  await writeFile(path.join(dir, 'kb/a.md'), 'BBBB');
  await utimes(path.join(dir, 'kb/a.md'), quando, quando);
  const depois = await manifesto(dir, { snapshotRoot: null });
  assert.notEqual(antes.get('kb/a.md'), depois.get('kb/a.md'));
  assert.equal(depois.get('kb/a.md'), sha256(Buffer.from('BBBB')));
});

test('ACHADO A13 (baixa): sync-remote get segue link dentro da raiz e lê arquivo fora dela', async t => {
  const hub = await tempDir(t);
  const fora = await tempDir(t);
  await writeFile(path.join(fora, 'segredo.txt'), 'fora da raiz');
  await symlink(fora, path.join(hub, 'kb'), 'junction');
  const saida = new PassThrough();
  const partes = [];
  saida.on('data', p => partes.push(p));
  await remotoGet({ raiz: hub, entrada: JSON.stringify({ paths: ['kb/segredo.txt'] }), saida });
  assert.doesNotMatch(Buffer.concat(partes).toString('utf8'), /fora da raiz/);
});

test('ACHADO A14 (média): o prazo de 25 s do hook SessionStart não limita o tempo de vida do processo', { timeout: 90000 }, async t => {
  const dir = await tempDir(t, 'cb-qa-hook-');
  const lento = path.join(dir, 'lento.mjs');
  await writeFile(lento, 'setTimeout(() => {}, 34000);\n');
  const dataRoot = path.join(dir, 'dados');
  await mkdir(dataRoot, { recursive: true });
  await configurarSync(dataRoot, { comando: [process.execPath, lento], raiz: dir });
  const env = { ...process.env, DATA_ROOT: dataRoot };
  const inicio = Date.now();
  const filho = spawn(process.execPath, [path.join(repoRoot, 'hooks', 'session-start.mjs')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let primeiraSaida = null;
  filho.stdout.on('data', () => { primeiraSaida ??= Date.now(); });
  filho.stdin.end('{}');
  await new Promise(done => filho.on('close', done));
  const fim = Date.now();
  assert.ok(primeiraSaida, 'o hook devia ter emitido o contexto');
  assert.ok(fim - primeiraSaida < 3000, `o hook respondeu em ${Math.round((primeiraSaida - inicio) / 1000)} s mas só terminou em ${Math.round((fim - inicio) / 1000)} s`);
});

// ---------------------------------------------------------------------------------------------------------------------
// SONDAS (passam)

const quadro = (cab, bytes) => Buffer.concat([Buffer.from(`${JSON.stringify({ ...cab, size: bytes.length })}\n`), bytes]);
const FIM = Buffer.from('{"fim":true}\n');

test('SONDA: sync-remote recusa traversal em put, get e del e nada sai da raiz', async t => {
  const base = await tempDir(t);
  const hub = path.join(base, 'hub');
  await mkdir(hub, { recursive: true });
  await writeFile(path.join(base, 'fora.txt'), 'intacto');
  const ruins = ['../fora.txt', 'kb/../../fora.txt', '/etc/passwd', 'C:/x.txt', 'kb\\..\\..\\fora.txt', 'kb/./a.md', 'kb//a.md', '.sync/base.json', '.git/config', 'kb/.x/a.md', 'secrets/t', 'projections/p.json', 'kb/a.md.bak', 'kb/a\u0000.md'];
  const bytes = Buffer.from('x');
  const entrada = Buffer.concat([...ruins.map(rel => quadro({ path: rel, sha256: sha256(bytes), esperado: null }, bytes)), FIM]);
  const r = await remotoPut({ raiz: hub, entrada: Readable.from([entrada]) });
  assert.deepEqual(r.resultados.map(i => i.ok), ruins.map(() => false));
  const d = await remotoDel({ raiz: hub, entrada: JSON.stringify({ itens: ruins.map(rel => ({ path: rel, esperado: sha256(Buffer.from('intacto')) })) }) });
  assert.deepEqual(d.resultados.map(i => i.ok), ruins.map(() => false));
  const saida = new PassThrough();
  const partes = [];
  saida.on('data', p => partes.push(p));
  await remotoGet({ raiz: hub, entrada: JSON.stringify({ paths: ruins }), saida });
  assert.doesNotMatch(Buffer.concat(partes).toString('utf8'), /intacto|root:/);
  assert.equal(await readFile(path.join(base, 'fora.txt'), 'utf8'), 'intacto');
});

test('SONDA: dois PCs enviando ao mesmo tempo com o mesmo hash esperado, só um grava (compare-and-swap sob lock)', async t => {
  const hub = await tempDir(t);
  const v0 = Buffer.from('v0');
  await remotoPut({ raiz: hub, entrada: Readable.from([Buffer.concat([quadro({ path: 'kb/a.md', sha256: sha256(v0), esperado: null }, v0), FIM])]) });
  const envio = texto => {
    const b = Buffer.from(texto);
    return remotoPut({ raiz: hub, entrada: Readable.from([Buffer.concat([quadro({ path: 'kb/a.md', sha256: sha256(b), esperado: sha256(v0) }, b), FIM])]) });
  };
  const resultados = await Promise.all(Array.from({ length: 6 }, (_, i) => envio(`pc-${i}`)));
  const ok = resultados.filter(r => r.resultados[0].ok);
  assert.equal(ok.length, 1);
  assert.ok(resultados.filter(r => !r.resultados[0].ok).every(r => r.resultados[0].motivo === 'mudou_no_servidor'));
});

test('SONDA: fluxo de put cortado antes do fim não corrompe e a repetição converge', async t => {
  const hub = await tempDir(t);
  const a = Buffer.from('aaaa');
  const b = Buffer.from('bbbbbbbb');
  const completo = Buffer.concat([quadro({ path: 'kb/a.md', sha256: sha256(a), esperado: null }, a), quadro({ path: 'kb/b.md', sha256: sha256(b), esperado: null }, b)]);
  await assert.rejects(remotoPut({ raiz: hub, entrada: Readable.from([completo.subarray(0, completo.length - 3)]) }), /cortado/);
  assert.equal(await ler(hub, 'kb/a.md'), 'aaaa');
  assert.equal(await existe(hub, 'kb/b.md'), false);
  const r = await remotoPut({ raiz: hub, entrada: Readable.from([Buffer.concat([completo, FIM])]) });
  assert.deepEqual(r.resultados.map(i => i.ok), [true, true]);
  assert.equal(await ler(hub, 'kb/b.md'), 'bbbbbbbb');
});

test('SONDA: arquivo binário de 6 MB faz a viagem de ida e volta pelo CLI sem truncar', async t => {
  const { pcA, pcB } = await cenario(t);
  const grande = Buffer.alloc(6 * 1024 * 1024);
  for (let i = 0; i < grande.length; i++) grande[i] = (i * 31 + (i >> 8)) & 0xff;
  await mkdir(path.join(pcA, 'artifacts/cv'), { recursive: true });
  await writeFile(path.join(pcA, 'artifacts/cv/grande.pdf'), grande);
  assert.equal(sync(pcA).status, 0);
  assert.equal(sync(pcB).status, 0);
  assert.equal(sha256(await readFile(path.join(pcB, 'artifacts/cv/grande.pdf'))), sha256(grande));
});

test('SONDA: servidor vazio por engano não apaga o PC acima do limite, e a lixeira local guarda o resto', async t => {
  const dir = await tempDir(t);
  for (let i = 0; i < 20; i++) await escrever(dir, `kb/claims/c${i}.md`, `c${i}`);
  const srv = servidor({});
  await rodada(dir, srv);
  srv.mapa.clear(); // servidor restaurado vazio / --raiz errada
  await assert.rejects(rodada(dir, srv, new Date('2026-10-30T22:10:00Z')), /--permitir-apagar/);
  assert.equal(await existe(dir, 'kb/claims/c0.md'), true);
});

// ---------------------------------------------------------------------------------------------------------------------
// RE-QA (correções)

import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync } from 'node:fs';
import { sincronizarComPrazo } from '../../core/sync/hook.mjs';

function trocarReadFile(t, substituto) {
  const original = fsPromises.readFile;
  fsPromises.readFile = (arquivo, ...resto) => substituto(original, arquivo, ...resto);
  syncBuiltinESMExports();
  t.after(() => { fsPromises.readFile = original; syncBuiltinESMExports(); });
}

test('ACHADO N1 (média): um arquivo local ilegível (EBUSY/EACCES) aborta a rodada inteira e nada sobe', async t => {
  const dir = await tempDir(t);
  await escrever(dir, 'kb/travado.md', 'aberto por outro programa');
  await escrever(dir, 'state/ok.json', '{"ok":1}');
  trocarReadFile(t, async (original, arquivo, ...resto) => {
    if (String(arquivo).endsWith('travado.md')) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    return original(arquivo, ...resto);
  });
  const srv = servidor({});
  await rodada(dir, srv).catch(() => {});
  assert.ok(srv.mapa.has('state/ok.json'), 'state/ok.json devia subir; o arquivo travado deveria virar pendente');
});

test('ACHADO N2 (média): arquivo pendente para sempre não aparece no hook nem no status (só no texto do CLI)', async t => {
  const dir = await tempDir(t);
  await configurarSync(dir, { comando: [process.execPath, path.join(dir, 'x.mjs')], raiz: dir });
  await escrever(dir, 'kb/dir', 'arquivo local onde o servidor tem uma pasta');
  const srv = servidor({ 'kb/dir/x.md': 'do servidor' });
  const executar = () => sincronizarComPrazo(dir, { rodada: ({ dataRoot }) => sincronizar({ dataRoot, transporte: srv.transporte }) });
  await executar();
  const aviso = await executar();
  const status = await lerStatusSync(dir);
  assert.deepEqual(status.pendentes, ['kb/dir/x.md']);
  assert.match(String(aviso), /kb\/dir\/x\.md|pendente/i, 'a mesma pendência se repete a cada rodada e ninguém é avisado');
});

test('ACHADO N3 (baixa): a união do log de eventos substitui o arquivo sem o events.lock e perde o evento gravado no meio', async t => {
  const dir = await tempDir(t);
  const rel = 'events/2026/10/28.pc-x.jsonl';
  await escrever(dir, rel, 'local-1\n');
  const srv = servidor({ [rel]: 'remoto-1\n' });
  let leituras = 0;
  trocarReadFile(t, async (original, arquivo, ...resto) => {
    const dados = await original(arquivo, ...resto);
    if (String(arquivo).endsWith('28.pc-x.jsonl') && ++leituras === 3) appendFileSync(arquivo, 'gravado-agora\n'); // o painel grava neste instante
    return dados;
  });
  await rodada(dir, srv);
  assert.match(await ler(dir, rel), /gravado-agora/);
});

test('ACHADO N5 (baixa): o destino do ssh pode começar com "-" e virar opção', () => {
  assert.throws(() => validarConfigSync({ comando: ['ssh', '-Jx@y', 'node', '/a.mjs'], raiz: '/srv/cb' }));
  assert.throws(() => validarConfigSync({ comando: ['ssh', '-o', 'BatchMode=yes', '-F@x', 'node', '/a.mjs'], raiz: '/srv/cb' }));
});

test('SONDA N6: união de eventos em conflito mantém as linhas dos dois lados, sem duplicar, e converge nos dois PCs', async t => {
  const { pcA, pcB } = await cenario(t);
  await escrever(pcA, 'events/2026/10/28.pc-x.jsonl', 'a1\na2\n');
  await escrever(pcB, 'events/2026/10/28.pc-x.jsonl', 'a1\nb1\n');
  for (const pc of [pcA, pcB, pcA, pcB]) assert.equal(sync(pc).status, 0);
  const a = (await ler(pcA, 'events/2026/10/28.pc-x.jsonl')).trim().split('\n').sort();
  const b = (await ler(pcB, 'events/2026/10/28.pc-x.jsonl')).trim().split('\n').sort();
  assert.deepEqual(a, ['a1', 'a2', 'b1']);
  assert.deepEqual(b, a);
});
