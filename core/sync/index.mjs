// Sincronização do DATA_ROOT com a base central (seam: CLI `sync`). Local primeiro: cada PC trabalha na sua cópia
// e a rodada troca só o que mudou desde a última (plano de três vias). A configuração (comando e raiz remota) e o
// estado da rodada ficam em DATA_ROOT/.sync, que nunca sincroniza.
import { randomBytes } from 'node:crypto';
import { access, readFile, rename } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { atomicJson, atomicWriteFile } from '../store/atomicWrite.mjs';
import { withLock } from '../store/lock.mjs';
import { privateDestination } from '../migration/paths.mjs';
import { projectLegacy } from '../migration/legacy.mjs';
import { absoluto, carimboDe, conflitosPendentes, hashAtual, lerJson, manifesto, paraLixeira, PASTA_SYNC, sha256, snapshotDe } from './arquivos.mjs';
import { planejar } from './plano.mjs';
import { ehLogDeEventos, sincronizavel, unirLinhas } from './regras.mjs';
import { transporteComando } from './transporte.mjs';

const arquivo = (dataRoot, nome) => path.join(dataRoot, PASTA_SYNC, nome);
const RAIZ_VALIDA = /^(\/|[A-Za-z]:[\\/])[\w./\\:~-]*$/; // "~" só no meio (nome curto do Windows, RUNNER~1)
const PALAVRA_REMOTA = /^[\w./@:=+,-]+$/;
const OPCOES_SSH = /^(BatchMode=(yes|no)|ConnectTimeout=\d{1,3}|ServerAliveInterval=\d{1,3}|ServerAliveCountMax=\d{1,2})$/;
const BUSY = 'Outra sincronização está em andamento.';

// O comando salvo roda sem pedir permissão (painel e hooks), então só aceita o ssh, com poucas opções conhecidas,
// um destino usuario@host e palavras remotas sem metacaractere de shell. Nos testes (CAREER_BOUNTY_SYNC_TESTE=1),
// o "servidor" é o próprio node rodando um .mjs local: só esse formato exato é aceito.
function validarComando(comando, env) {
  const erro = new Error('sync: comando deve ser ["ssh", opções -o permitidas (BatchMode, ConnectTimeout, ServerAlive*), "usuario@host", "<node remoto>", "<career-bounty.mjs remoto>"].');
  if (!Array.isArray(comando) || !comando.length || comando.some(parte => typeof parte !== 'string' || !parte)) throw erro;
  const [exe, ...resto] = comando;
  const ehSsh = /^ssh(\.exe)?$/i.test(path.basename(exe)) && (exe === path.basename(exe) || path.isAbsolute(exe));
  if (!ehSsh) {
    if (env.CAREER_BOUNTY_SYNC_TESTE === '1' && exe === process.execPath && resto.length === 1 && path.isAbsolute(resto[0]) && resto[0].endsWith('.mjs')) return;
    throw erro;
  }
  let i = 0;
  while (resto[i] === '-o') {
    if (!OPCOES_SSH.test(resto[i + 1] ?? '')) throw erro;
    i += 2;
  }
  const [destino, ...remoto] = resto.slice(i);
  if (!/^[\w.][\w.-]*@[\w.-]+$/.test(destino ?? '') || !remoto.length || remoto.some(parte => !PALAVRA_REMOTA.test(parte) || parte.startsWith('-'))) throw erro;
}

export function validarConfigSync(config, { env = process.env } = {}) {
  if (!config || typeof config !== 'object') throw new Error('Configuração de sincronização inválida.');
  const { comando, raiz, intervalo_s: intervalo = 120 } = config;
  validarComando(comando, env);
  if (typeof raiz !== 'string' || !RAIZ_VALIDA.test(raiz) || raiz.includes('..')) throw new Error('sync: raiz deve ser caminho absoluto sem espaço.');
  if (!Number.isInteger(intervalo) || intervalo < 30 || intervalo > 3600) throw new Error('sync: intervalo_s deve ser inteiro entre 30 e 3600.');
  return { versao: 1, comando: [...comando], raiz, intervalo_s: intervalo };
}

export async function lerConfigSync(dataRoot) {
  const config = await lerJson(arquivo(dataRoot, 'config.json'), null);
  return config ? validarConfigSync(config) : null;
}

export async function configurarSync(dataRoot, config) {
  await privateDestination(dataRoot);
  const valida = validarConfigSync(config);
  await atomicJson(arquivo(dataRoot, 'config.json'), valida);
  return valida;
}

export const lerStatusSync = dataRoot => lerJson(arquivo(dataRoot, 'status.json'), null);
export const sincronizacaoOcupada = error => error?.ocupado === true;

const hostLocal = () => hostname().replace(/[^A-Za-z0-9_-]/g, '-') || 'host';
const LIMITE_APAGAR = 10;

async function executar({ dataRoot, transporte, agora, permitirApagar }) {
  const base = new Map(Object.entries((await lerJson(arquivo(dataRoot, 'base.json'), {})).arquivos ?? {}));
  const remoto = await transporte.manifest();
  // Vale o snapshot local e o do servidor: quando outro PC refaz a migração, o migration.json novo e os arquivos do
  // snapshot dele chegam na mesma rodada.
  const snapshots = [...new Set([await snapshotDe(dataRoot), remoto.snapshotRoot].filter(Boolean))];
  const regra = rel => snapshots.length ? snapshots.some(snapshotRoot => sincronizavel(rel, { snapshotRoot })) : sincronizavel(rel);
  const local = await manifesto(dataRoot, { snapshots: snapshots.length ? snapshots : [null] });
  const remotoFiltrado = new Map([...remoto.arquivos].filter(([rel]) => regra(rel)));
  const baseFiltrada = new Map([...base].filter(([rel]) => regra(rel)));
  // Ilegível aqui fica fora do plano nesta rodada (nem envia, nem baixa por cima, nem apaga) e mantém a base.
  const ilegiveis = local.ilegiveis ?? new Map();
  const semIlegiveis = mapa => new Map([...mapa].filter(([rel]) => !ilegiveis.has(rel)));
  const plano = planejar({ local, remoto: semIlegiveis(remotoFiltrado), base: semIlegiveis(baseFiltrada) });

  const apagar = plano.apagarLocal.length + plano.apagarRemoto.length;
  const total = new Set([...local.keys(), ...remotoFiltrado.keys()]).size;
  if (!permitirApagar && apagar > LIMITE_APAGAR && apagar > total / 4) {
    throw new Error(`A rodada apagaria ${apagar} de ${total} arquivos; confira e rode de novo com --permitir-apagar se for isso mesmo.`);
  }

  const novaBase = new Map(plano.iguais.map(({ path: rel, sha256: hash }) => [rel, hash]));
  const manter = rel => { if (baseFiltrada.has(rel)) novaBase.set(rel, baseFiltrada.get(rel)); };
  const carimbo = carimboDe(agora);
  const resumo = { baixados: 0, enviados: 0, apagados_local: 0, apagados_remoto: 0, conflitos_novos: [], pendentes: [], motivos: {} };
  const pendente = (rel, motivo) => {
    if (!resumo.pendentes.includes(rel)) resumo.pendentes.push(rel);
    if (motivo) resumo.motivos[rel] = String(motivo).slice(0, 120);
    manter(rel);
  };
  for (const [rel, codigo] of ilegiveis) pendente(rel, `ilegível neste computador (${codigo})`);

  // 1) Baixar (inclusive conflitos). Log de eventos em conflito: une as linhas e reenvia. Outro arquivo: o servidor
  //    vence e a versão local vira cópia ao lado. Falha num arquivo vira pendente e não para a rodada.
  const paraBaixar = new Map([...plano.baixar, ...plano.conflitos].map(item => [item.path, item]));
  const conflitos = new Set(plano.conflitos.map(item => item.path));
  const unidos = [];
  await transporte.baixar([...paraBaixar.keys()], async quadro => {
    const item = paraBaixar.get(quadro.path);
    if (!item) return;
    try {
      if (quadro.erro || sha256(quadro.bytes) !== quadro.sha256) return pendente(quadro.path, quadro.erro ? `servidor: ${quadro.erro}` : 'hash divergente no download');
      const destino = absoluto(dataRoot, quadro.path);
      const atual = await hashAtual(destino);
      if (atual !== item.localEsperado) return pendente(quadro.path, 'mudou durante a rodada');
      if (conflitos.has(quadro.path) && ehLogDeEventos(quadro.path)) {
        // Sob o lock do log, e relendo até o arquivo não mudar entre a leitura e a gravação.
        const uniao = await withLock(path.join(dataRoot, 'state', 'events.lock'), { timeoutMs: 10000 }, async () => {
          for (let tentativa = 0; tentativa < 5; tentativa++) {
            const lido = await readFile(destino);
            const unido = unirLinhas(quadro.bytes, lido);
            if (await hashAtual(destino) !== sha256(lido)) continue;
            await atomicWriteFile(destino, unido);
            return unido;
          }
          return null;
        });
        if (!uniao) return pendente(quadro.path, 'log mudou durante a união');
        unidos.push({ path: quadro.path, sha256: sha256(uniao), esperado: quadro.sha256 });
        resumo.baixados++;
        return;
      }
      if (conflitos.has(quadro.path)) {
        await rename(destino, `${destino}.conflito-${hostLocal()}-${carimbo}-${randomBytes(2).toString('hex')}`);
        resumo.conflitos_novos.push(quadro.path);
      }
      await atomicWriteFile(destino, quadro.bytes);
      novaBase.set(quadro.path, quadro.sha256);
      resumo.baixados++;
    } catch (error) { pendente(quadro.path, error.code ?? error.message); }
  });

  // 2) Apagar local o que o servidor apagou (para a lixeira local).
  for (const { path: rel, esperado } of plano.apagarLocal) {
    try {
      if (await hashAtual(absoluto(dataRoot, rel)) !== esperado) { pendente(rel, 'mudou durante a rodada'); continue; }
      await paraLixeira(dataRoot, rel, carimbo);
      resumo.apagados_local++;
    } catch (error) { pendente(rel, error.code ?? error.message); }
  }

  // 3) Enviar o que mudou aqui e os logs unidos.
  const { resultados: enviados = [], enviados: hashesEnviados = new Map() } = await transporte.enviar([...plano.enviar, ...unidos], async ({ path: rel }) => {
    try { const bytes = await readFile(absoluto(dataRoot, rel)); return { bytes, sha256: sha256(bytes) }; }
    catch (error) { pendente(rel, error.code === 'ENOENT' ? 'sumiu durante a rodada' : error.code ?? error.message); return null; }
  });
  for (const { path: rel, ok, motivo } of enviados) {
    if (ok) { novaBase.set(rel, hashesEnviados.get(rel)); resumo.enviados++; } else pendente(rel, `servidor: ${motivo ?? 'recusou'}`);
  }

  // 4) Apagar no servidor o que foi apagado aqui.
  const { resultados: apagados = [] } = await transporte.apagar(plano.apagarRemoto);
  for (const { path: rel, ok, motivo } of apagados) {
    if (ok) resumo.apagados_remoto++; else pendente(rel, `servidor: ${motivo ?? 'recusou'}`);
  }

  await atomicJson(arquivo(dataRoot, 'base.json'), { versao: 1, arquivos: Object.fromEntries([...novaBase].sort()) });
  resumo.conflitos = await conflitosPendentes(dataRoot);

  // A projeção não sincroniza: é refeita quando chegam eventos ou o estado da migração, ou quando não existe.
  const tocouEventos = [...paraBaixar.keys(), ...plano.apagarLocal.map(item => item.path)].some(rel => rel.startsWith('events/') || rel === 'state/migration.json');
  const semProjecao = await access(path.join(dataRoot, 'projections', 'pipeline-vagas.json')).then(() => false, () => true);
  if ((tocouEventos || semProjecao) && local.size + resumo.baixados > 0) {
    try { resumo.projecao = { refeita: true, vagas: (await projectLegacy({ dataRoot })).vagas }; }
    catch (error) { resumo.projecao = { refeita: false, erro: String(error.message ?? error).slice(0, 200) }; }
  }
  return resumo;
}

// Uma rodada completa. Nunca roda duas ao mesmo tempo no mesmo DATA_ROOT; grava o status para o painel e o hook.
// Perder a disputa pelo lock não é falha: lança com `ocupado` e não mexe no status.
export async function sincronizar({ dataRoot, transporte, agora = new Date(), permitirApagar = false } = {}) {
  await privateDestination(dataRoot);
  const config = await lerConfigSync(dataRoot);
  if (!transporte) {
    if (!config) throw new Error('Sincronização não configurada: rode `career-bounty sync configurar --comando-json <json> --raiz <pasta>`.');
    transporte = transporteComando(config);
  }
  const anterior = await lerStatusSync(dataRoot);
  try {
    const resumo = await withLock(arquivo(dataRoot, 'sync.lock'), { timeoutMs: 1500, busyMessage: BUSY },
      () => executar({ dataRoot, transporte, agora, permitirApagar }));
    const status = { ok: true, ultima: agora.toISOString(), ultima_ok: agora.toISOString(), ...resumo };
    await atomicJson(arquivo(dataRoot, 'status.json'), status);
    return status;
  } catch (error) {
    if (error?.message === BUSY) { error.ocupado = true; throw error; }
    const conflitos = await conflitosPendentes(dataRoot).catch(() => anterior?.conflitos ?? []);
    const status = { ok: false, ultima: agora.toISOString(), ultima_ok: anterior?.ultima_ok ?? null, erro: String(error.message ?? error).slice(0, 300), conflitos };
    await atomicJson(arquivo(dataRoot, 'status.json'), status).catch(() => {});
    throw error;
  }
}
