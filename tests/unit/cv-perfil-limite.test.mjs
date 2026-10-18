import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { perfilCvBruto } from '../helpers/cv.mjs';
import { carregarPerfilCv, itensPorExperiencia } from '../../core/cv/gerar.mjs';
import { ITENS_MAX_PADRAO } from '../../core/cv/redator.mjs';

// O limite de bullets por experiência é do perfil: um histórico longo só cabe nas 2 páginas com menos itens.
async function gravarPerfil(t, extra) {
  const dataRoot = await tempDir(t);
  await mkdir(path.join(dataRoot, 'cv'), { recursive: true });
  await writeFile(path.join(dataRoot, 'cv', 'perfil.json'), JSON.stringify({ ...(await perfilCvBruto()), ...extra }));
  return dataRoot;
}

test('sem itens_por_experiencia no perfil, vale o padrão', async t => {
  const perfil = await carregarPerfilCv(await gravarPerfil(t, {}));
  assert.equal(itensPorExperiencia(perfil), ITENS_MAX_PADRAO);
});

test('itens_por_experiencia do perfil define o limite de bullets', async t => {
  const perfil = await carregarPerfilCv(await gravarPerfil(t, { itens_por_experiencia: 4 }));
  assert.equal(itensPorExperiencia(perfil), 4);
});

test('itens_por_experiencia fora de 1 a 10 ou não inteiro é recusado', async t => {
  for (const valor of [0, 11, 2.5, '4', null]) {
    await assert.rejects(carregarPerfilCv(await gravarPerfil(t, { itens_por_experiencia: valor })), /itens_por_experiencia/, String(valor));
  }
});
