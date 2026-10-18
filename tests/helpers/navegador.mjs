// Navegador real (CDP pelo pipe) para os testes de formulário. Sem Chrome/Edge, os testes pulam com motivo.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './cli.mjs';
import { abrirNavegador } from '../../core/browser/cdp.mjs';
import { encontrarNavegador } from '../../core/cv/navegador.mjs';

export const semNavegador = encontrarNavegador() ? false : 'nenhum Chrome, Chromium ou Edge instalado (CAREER_BOUNTY_BROWSER)';
export const portal = nome => pathToFileURL(path.join(repoRoot, 'tests', 'fixtures', 'portais', `${nome}.html`)).href;

// Abre uma página por teste e fecha o navegador ao fim do teste.
export async function pagina(t, url) {
  const navegador = await abrirNavegador();
  t.after(() => navegador.fechar());
  const p = await navegador.novaPagina();
  if (url) await p.ir(url);
  return p;
}
