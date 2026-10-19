// Capturas do README a partir da demo (persona fictícia): monta a demo numa pasta temporária, abre o painel no Chrome
// ou Edge headless que o projeto já usa (CDP, sem dependência npm) e grava PNGs em docs/img/. Rode de novo quando a
// interface mudar:  node scripts/capturas-readme.mjs
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { abrirNavegador } from '../core/browser/cdp.mjs';
import { startPanel } from '../panel/server.mjs';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const destino = path.join(raiz, 'docs', 'img');
const pasta = path.join(await mkdtemp(path.join(tmpdir(), 'cb-capturas-')), 'demo');

const demo = spawnSync(process.execPath, [path.join(raiz, 'bin', 'career-bounty.mjs'), 'demo', '--pasta', pasta, '--json'], { encoding: 'utf8' });
if (demo.status !== 0) throw new Error(`demo falhou: ${demo.stderr || demo.stdout}`);

const painel = await startPanel({ dataRoot: pasta, port: 0, hostId: 'capturas' });
const navegador = await abrirNavegador();
const espera = ms => new Promise(r => setTimeout(r, ms));

async function capturar({ arquivo, largura, altura, tema, aba = 'vagas', mobile = false }) {
  const p = await navegador.novaPagina();
  await p.comando('Emulation.setDeviceMetricsOverride', { width: largura, height: altura, deviceScaleFactor: 1, mobile });
  // Fundo parado para a captura sair igual a cada execução; tema escolhido antes de carregar.
  await p.ir(`${painel.url}/`);
  await p.avaliar(`localStorage.setItem('cb_tema', '${tema}'); localStorage.setItem('cb_fundo_parado', '1'); localStorage.setItem('cb-animacao-pausada', 'true'); true`);
  await p.ir(`${painel.url}/`);
  await espera(800);
  if (aba !== 'vagas') {
    await p.avaliar(`document.querySelector('[data-aba="${aba}"]')?.click(); true`);
    await espera(800);
  }
  const { data } = await p.comando('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(destino, arquivo), Buffer.from(data, 'base64'));
  await p.fechar();
  console.log(`docs/img/${arquivo}`);
}

try {
  await capturar({ arquivo: 'painel-claro.png', largura: 1280, altura: 800, tema: 'claro' });
  await capturar({ arquivo: 'painel-escuro.png', largura: 1280, altura: 800, tema: 'escuro' });
  await capturar({ arquivo: 'painel-processos.png', largura: 1280, altura: 800, tema: 'escuro', aba: 'processos' });
  await capturar({ arquivo: 'painel-curriculo.png', largura: 1280, altura: 800, tema: 'claro', aba: 'curriculo' });
  await capturar({ arquivo: 'painel-celular.png', largura: 375, altura: 780, tema: 'escuro', mobile: true });
} finally {
  await navegador.fechar();
  await painel.close();
  await rm(path.dirname(pasta), { recursive: true, force: true });
}
