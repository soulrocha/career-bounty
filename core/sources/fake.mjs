// Fonte em memória: serve de contrato de teste e de tracer do radar.
export function createFake(vagas = [], { id = 'fake' } = {}) {
  return { id, collect: async () => structuredClone(vagas) };
}
