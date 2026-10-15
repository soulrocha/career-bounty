// Registro das fontes: id -> fábrica que lê a configuração pessoal.
import { createFake } from './fake.mjs';
import { createGupy } from './gupy.mjs';
import { createCareerOps } from './careerOps.mjs';
import { createFreehire } from './freehire.mjs';
import { createJobSpy } from './jobspy.mjs';
import { createInhire } from './inhire.mjs';
import { createSolides } from './solides.mjs';

const FACTORIES = {
  fake: settings => createFake(settings.fontes.fake?.vagas ?? []),
  gupy: (settings, deps) => createGupy(settings.fontes.gupy ?? {}, deps),
  freehire: (settings, deps) => createFreehire(settings.fontes.freehire ?? {}, deps),
  jobspy: settings => createJobSpy(settings.fontes.jobspy ?? {}),
  inhire: (settings, deps) => createInhire(settings.fontes.inhire ?? {}, deps),
  solides: (settings, deps) => createSolides(settings.fontes.solides ?? {}, deps),
  careerops: settings => createCareerOps(settings.fontes.careerops ?? {}),
};

export const sourceIds = () => Object.keys(FACTORIES);

// `only`: ids pedidos na linha de comando. Sem `only`, usa as fontes com bloco em `fontes` no config pessoal (menos a fake).
export function buildSources(settings, { only, deps = {} } = {}) {
  const ids = only?.length ? only : sourceIds().filter(id => id !== 'fake' && settings.fontes[id]);
  return ids.map(id => {
    if (!Object.hasOwn(FACTORIES, id)) throw new Error(`Fonte desconhecida: ${id}. Disponíveis: ${sourceIds().join(', ')}.`);
    return FACTORIES[id](settings, deps);
  });
}
