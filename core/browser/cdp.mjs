// Cliente mínimo do Chrome DevTools Protocol pelo canal --remote-debugging-pipe (fd 3 escreve, fd 4 lê), sem rede e sem
// dependência npm. Usado pelos testes do extrator e pelos drivers de envio (F7): navegador headless, perfil temporário
// e efêmero, sem cookies nem sessão do usuário.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encontrarNavegador } from '../cv/navegador.mjs';

const TEMPO_PADRAO_MS = 30_000;

export async function abrirNavegador({ navegador = encontrarNavegador(), tempoMs = TEMPO_PADRAO_MS } = {}) {
  if (!navegador) throw new Error('Nenhum Chrome, Chromium ou Edge encontrado. Defina CAREER_BOUNTY_BROWSER com o caminho do executável.');
  const perfil = await mkdtemp(path.join(tmpdir(), 'cb-cdp-'));
  // Edge no Windows pode reiniciar pela camada de compatibilidade e perder os pipes herdados.
  const args = ['--headless=new', '--remote-debugging-pipe', '--edge-skip-compat-layer-relaunch', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync', `--user-data-dir=${perfil}`, 'about:blank'];
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  const filho = spawn(navegador, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  const escrita = filho.stdio[3];
  const leitura = filho.stdio[4];
  let proximo = 1;
  const pendentes = new Map();
  const ouvintes = new Set();
  let resto = Buffer.alloc(0);
  leitura.on('data', bloco => {
    resto = Buffer.concat([resto, bloco]);
    let fim;
    while ((fim = resto.indexOf(0)) >= 0) {
      const mensagem = JSON.parse(resto.subarray(0, fim).toString('utf8'));
      resto = resto.subarray(fim + 1);
      if (mensagem.id && pendentes.has(mensagem.id)) {
        const { resolve, reject, timer } = pendentes.get(mensagem.id);
        clearTimeout(timer);
        pendentes.delete(mensagem.id);
        if (mensagem.error) reject(new Error(`CDP: ${mensagem.error.message}`)); else resolve(mensagem.result);
      } else if (mensagem.method) for (const ouvir of ouvintes) ouvir(mensagem);
    }
  });
  const encerrado = new Promise(resolve => filho.once('exit', resolve));
  filho.once('exit', () => { for (const { reject, timer } of pendentes.values()) { clearTimeout(timer); reject(new Error('O navegador fechou.')); } pendentes.clear(); });

  const enviar = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = proximo++;
    const timer = setTimeout(() => { pendentes.delete(id); reject(new Error(`CDP: tempo esgotado em ${method}`)); }, tempoMs);
    pendentes.set(id, { resolve, reject, timer });
    escrita.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  });
  const esperarEvento = (method, sessionId, ms = tempoMs) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ouvintes.delete(ouvir); reject(new Error(`CDP: tempo esgotado esperando ${method}`)); }, ms);
    const ouvir = m => { if (m.method === method && (!sessionId || m.sessionId === sessionId)) { clearTimeout(timer); ouvintes.delete(ouvir); resolve(m.params); } };
    ouvintes.add(ouvir);
  });

  async function novaPagina() {
    const { targetId } = await enviar('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await enviar('Target.attachToTarget', { targetId, flatten: true });
    await enviar('Page.enable', {}, sessionId);
    await enviar('Runtime.enable', {}, sessionId);
    const comando = (method, params) => enviar(method, params, sessionId);
    return {
      comando,
      async ir(url) {
        const carregou = esperarEvento('Page.loadEventFired', sessionId);
        await comando('Page.navigate', { url });
        await carregou;
      },
      // Avalia uma expressão na página e devolve o valor (JSON). Erro de script vira exceção.
      async avaliar(expressao) {
        const r = await comando('Runtime.evaluate', { expression: expressao, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(`Script na página falhou: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
        return r.result.value;
      },
      // Anexa arquivos a um <input type=file> pelo seletor CSS.
      async anexar(seletor, arquivos) {
        const { root } = await comando('DOM.getDocument', { depth: 0 });
        const { nodeId } = await comando('DOM.querySelector', { nodeId: root.nodeId, selector: seletor });
        if (!nodeId) throw new Error(`Campo de arquivo não encontrado: ${seletor}`);
        await comando('DOM.setFileInputFiles', { nodeId, files: arquivos });
      },
      fechar: () => enviar('Target.closeTarget', { targetId }),
    };
  }

  async function fechar() {
    try { await enviar('Browser.close'); } catch { filho.kill(); }
    await Promise.race([encerrado, new Promise(r => setTimeout(r, 5000))]);
    if (filho.exitCode === null) filho.kill('SIGKILL');
    await rm(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }

  return { novaPagina, fechar };
}
