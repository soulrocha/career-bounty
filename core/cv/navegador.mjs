// Impressão de HTML em PDF pelo Chrome, Chromium ou Edge já instalados (modo headless pela linha de comando), sem dependência npm.
// O HTML é local e autocontido (a foto entra como data URI); o navegador roda com perfil temporário e sem rede de fundo.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TEMPO_MAX_MS = 60_000;

function candidatos(env, plataforma) {
  if (plataforma === 'win32') {
    const bases = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    return bases.flatMap(base => [
      path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(base, 'Chromium', 'Application', 'chrome.exe'),
    ]);
  }
  if (plataforma === 'darwin') {
    return ['Google Chrome', 'Chromium', 'Microsoft Edge'].map(app => `/Applications/${app}.app/Contents/MacOS/${app}`);
  }
  const dirs = String(env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'].flatMap(nome => dirs.map(dir => path.join(dir, nome)));
}

// Caminho do navegador: CAREER_BOUNTY_BROWSER (ou cv.navegador da config) tem precedência; senão, o primeiro instalado. null se nenhum.
export function encontrarNavegador({ env = process.env, plataforma = process.platform, configurado = null } = {}) {
  const explicito = env.CAREER_BOUNTY_BROWSER || configurado;
  if (explicito) return existsSync(explicito) ? explicito : null;
  return candidatos(env, plataforma).find(caminho => existsSync(caminho)) ?? null;
}

// Grava o HTML num diretório temporário, imprime e devolve os bytes do PDF.
export async function imprimirPdf({ html, navegador = encontrarNavegador() }) {
  if (!navegador) throw new Error('Nenhum Chrome, Chromium ou Edge encontrado para gerar o PDF. Defina CAREER_BOUNTY_BROWSER com o caminho do executável.');
  const dir = await mkdtemp(path.join(tmpdir(), 'cb-pdf-'));
  try {
    const origem = path.join(dir, 'cv.html');
    const saida = path.join(dir, 'cv.pdf');
    await writeFile(origem, html, 'utf8');
    const args = [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--disable-background-networking', '--disable-sync', '--no-pdf-header-footer', '--run-all-compositor-stages-before-draw',
      `--user-data-dir=${path.join(dir, 'perfil')}`, `--print-to-pdf=${saida}`, pathToFileURL(origem).href,
    ];
    // O Ubuntu 24 restringe namespaces sem privilégio e o sandbox do Chrome não sobe; o HTML é nosso, local e sem script.
    if (process.platform === 'linux') args.unshift('--no-sandbox');
    const r = spawnSync(navegador, args, { timeout: TEMPO_MAX_MS, windowsHide: true, encoding: 'utf8' });
    if (!existsSync(saida)) {
      const detalhe = r.error?.message ?? String(r.stderr ?? '').trim().split(/\r?\n/).slice(-3).join(' ');
      throw new Error(`O navegador não gerou o PDF (status ${r.status ?? 'sem status'}): ${detalhe.slice(0, 300)}`);
    }
    return await readFile(saida);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}
