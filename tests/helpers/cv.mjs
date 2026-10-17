// Ambiente de CV para os testes: base sintética da persona fictícia, perfil, vagas e fábrica de runner fake.
import { cp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot, run, tempDir } from './cli.mjs';
import { lerBase } from '../../core/kb/base.mjs';
import { createMarkdownFolder } from '../../core/kb/sources/markdownFolder.mjs';
import { createRunner } from '../../core/llm/runner.mjs';

export const fixturesCv = path.join(repoRoot, 'tests', 'fixtures', 'cv');

export async function baseCv() {
  return lerBase([{ nome: 'markdown-folder', fonte: createMarkdownFolder(path.join(fixturesCv, 'kb')) }]);
}

export async function perfilCvBruto() {
  return JSON.parse(await readFile(path.join(fixturesCv, 'perfil.json'), 'utf8'));
}

export const requisito = (texto, tipo, avaliacao, afirmacoes = []) => ({ requisito: texto, tipo, avaliacao, afirmacoes });

// Vaga no formato da projeção. Alta aderência com requisitos ligados às afirmações da persona.
export function vagaAlta(extra = {}) {
  return {
    id: 'vaga-cv-01', empresa: 'Empresa 01', cargo: 'Gerente de Produto', url: 'https://vagas.exemplo.test/cv-01', aderencia: 'alta', url_status: 'aberta', status: 'avaliada-sem-envio',
    descricao_completa: 'Gerente de Produto para uma plataforma de dados. Indicadores, migração de sistemas e relação com fornecedores.',
    requisitos: [
      requisito('Indicadores e painéis', 'obrigatorio', 'atendido', ['AF-202']),
      requisito('Migração de sistemas', 'obrigatorio', 'atendido', ['AF-204']),
      requisito('Gestão de fornecedores', 'desejavel', 'parcial', ['AF-210']),
      requisito('Python avançado', 'obrigatorio', 'nao-atendido', []),
    ],
    ...extra,
  };
}

export const vagaMedia = (extra = {}) => vagaAlta({ id: 'vaga-cv-02', empresa: 'Empresa 02', url: 'https://vagas.exemplo.test/cv-02', aderencia: 'media', ...extra });
// Portal Gupy: o domínio só existe aqui, fora das pastas varridas por fixtures.
export const vagaGupy = (extra = {}) => vagaAlta({ id: 'vaga-cv-03', empresa: 'Empresa 03', url: 'https://empresa-03.gupy.io/jobs/1', application_url: 'https://empresa-03.gupy.io/jobs/1', ...extra });

export function runnerFake(fake, opcoes = {}) {
  const chamadas = [];
  const runner = createRunner({ modo: 'fake', fake: async args => { chamadas.push(args); return fake(args.entrada, args.tentativa, args); }, ...opcoes });
  return { runner, chamadas };
}

// DATA_ROOT temporário com a base da persona em kb/.
export async function dataRootComBase(t) {
  const dataRoot = await tempDir(t);
  if (run(['setup', '--json'], { dataRoot }).status !== 0) throw new Error('setup falhou');
  await cp(path.join(fixturesCv, 'kb'), path.join(dataRoot, 'kb'), { recursive: true });
  return dataRoot;
}
