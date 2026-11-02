import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { esperarArquivo } from '../../core/cv/navegador.mjs';

// O Chrome/Edge no Windows pode retornar antes de o filho gravar o PDF: a impressão espera o arquivo aparecer.
test('esperarArquivo devolve true quando o PDF aparece depois do retorno do navegador', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cb-espera-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const arquivo = path.join(dir, 'cv.pdf');
  setTimeout(() => writeFile(arquivo, '%PDF-1.7 conteudo'), 300);
  assert.equal(await esperarArquivo(arquivo, 5000, 50), true);
});

test('esperarArquivo devolve false quando o prazo acaba sem arquivo', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cb-espera-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const inicio = Date.now();
  assert.equal(await esperarArquivo(path.join(dir, 'nunca.pdf'), 300, 50), false);
  assert.ok(Date.now() - inicio < 2000);
});
