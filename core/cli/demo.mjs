// demo: monta uma pasta de demonstração descartável (persona fictícia + vagas de exemplo, modo ativo) para experimentar
// o painel e a base de carreira sem tocar no DATA_ROOT real. Nada daqui é dado de ninguém.
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSkeleton, resolveDataRoot } from '../store/dataRoot.mjs';
import { iniciarInstalacaoNova } from '../migration/legacy.mjs';
import { analisarBase } from '../kb/analise.mjs';
import { loadSettings } from '../config.mjs';

const raiz = fileURLToPath(new URL('../../', import.meta.url));
const PADRAO = path.join(os.tmpdir(), 'career-bounty-demo');

export const demoCommands = {
  async demo(rest, { parseFlags }) {
    const values = parseFlags(rest, { allowed: ['--pasta'], withValue: ['--pasta'] });
    const pasta = path.resolve(values['--pasta'] ?? PADRAO);
    if (pasta === path.resolve(resolveDataRoot())) throw new Error('A pasta da demo não pode ser o seu DATA_ROOT: use outra (--pasta).');
    await mkdir(pasta, { recursive: true });
    if ((await readdir(pasta)).length) throw new Error(`A pasta ${pasta} já existe e não está vazia: escolha outra com --pasta ou apague-a.`);
    await ensureSkeleton(pasta);
    const persona = path.join(raiz, 'examples', 'persona-ficticia');
    for (const parte of ['claims', 'evidence', 'profile', 'story-bank']) await cp(path.join(persona, parte), path.join(pasta, 'kb', parte), { recursive: true });
    await writeFile(path.join(pasta, 'config.yml'), `${JSON.stringify({ perfil: { nome: 'Ana Exemplo', especialidade: 'Produto e operações', regiao: 'Brasil' } }, null, 2)}
`);
    const pipeline = JSON.parse(await readFile(path.join(raiz, 'examples', 'demo', 'pipeline-vagas.json'), 'utf8'));
    await iniciarInstalacaoNova({ dataRoot: pasta, pipeline });
    const settings = await loadSettings({ dataRoot: pasta });
    const { base } = await analisarBase({ dataRoot: pasta, settings });
    const com = process.platform === 'win32' ? `$env:DATA_ROOT="${pasta}"; ` : `DATA_ROOT="${pasta}" `;
    const proximos = [`${com}node bin/career-bounty.mjs panel`, `${com}node bin/career-bounty.mjs doctor`];
    return {
      result: { pasta, vagas: pipeline.vagas.length, afirmacoes: base.claims.length, proximos },
      text: [`Demonstração pronta em ${pasta} (${pipeline.vagas.length} vagas de exemplo, persona fictícia).`, 'Experimente:', ...proximos.map(c => `  ${c}`)].join('\n')
    };
  },
};
