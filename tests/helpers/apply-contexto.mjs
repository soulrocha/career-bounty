import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run, tempDir } from './cli.mjs';
import { makeLegado } from '../fixtures/make-legado.mjs';
import { ARQUIVOS_CV, gravarCv } from '../../core/cv/artifacts.mjs';

export const TS = '2026-10-17T12:00:00.000Z';
export const H = 'a'.repeat(64);
export const bytes = '%PDF-1.4 fixture';
export async function contexto(t, ativo = false) {
  const dataRoot = await tempDir(t);
  const origem = await tempDir(t);
  const documento = makeLegado({ vagas: 1 });
  const origemVaga = documento.vagas[0];
  const vaga = { id: origemVaga.id, empresa: origemVaga.empresa, cargo: origemVaga.cargo, url: origemVaga.url,
    status: 'avaliada-sem-envio', aderencia: 'alta', url_status: 'aberta', curriculo_necessario: true };
  documento.vagas = [vaga];
  const arquivo = path.join(origem, 'pipeline.json');
  await writeFile(arquivo, JSON.stringify(documento));
  assert.equal(run(['migrate', '--from', arquivo, '--json'], { dataRoot }).status, 0);
  if (ativo) {
    const arquivoEstado = path.join(dataRoot, 'state/migration.json');
    const estado = JSON.parse(await readFile(arquivoEstado, 'utf8'));
    await writeFile(arquivoEstado, JSON.stringify({ ...estado, mode: 'ativo' }));
  }
  return { dataRoot, vaga };
}
export const cv = (dataRoot, vaga, versao = H, ts = TS) => gravarCv(dataRoot, { vagaId: vaga.id, versao, tipo: 'ats', payload: {},
  arquivos: Object.fromEntries(ARQUIVOS_CV.map(n => [n, bytes])), gate: { status: 'ok', motivos: [] }, ts });
