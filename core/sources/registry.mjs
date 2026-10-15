// Registro das fontes: id -> fábrica que lê a configuração pessoal.
import { createFake } from './fake.mjs';

const FACTORIES = {
  fake: settings => createFake(settings.fontes.fake?.vagas ?? []),
};

export const sourceIds = () => Object.keys(FACTORIES);

// `only`: ids pedidos na linha de comando. Sem `only`, usa as fontes configuradas (menos a fake).
export function buildSources(settings, { only, deps = {} } = {}) {
  const ids = only?.length ? only : sourceIds().filter(id => id !== 'fake');
  return ids.map(id => {
    if (!Object.hasOwn(FACTORIES, id)) throw new Error(`Fonte desconhecida: ${id}. Disponíveis: ${sourceIds().join(', ')}.`);
    return FACTORIES[id](settings, deps);
  });
}
