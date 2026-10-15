import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson } from '../atomicWrite.mjs';
import { appendEvents, defaultHost, readEvents } from '../events.mjs';
import { withLock } from '../lock.mjs';
import { projectEvents } from '../project.mjs';
import { ocupado } from '../errors.mjs';

// Executa um comando de escrita como transação: trava, lê o log, decide sobre a projeção atual,
// grava o evento e atualiza a projeção. `decide` lança DomainError para recusar sem gravar.
export async function executarComando({ dataRoot, host = defaultHost(), now = new Date().toISOString(), decide }) {
  const lock = path.join(dataRoot, 'state', 'pipeline.lock');
  try {
    return await withLock(lock, { timeoutMs: 10000 }, async () => {
      const { eventos, avisos } = await readEvents(dataRoot);
      if (avisos.length) throw new Error(`Log de eventos truncado ou corrompido (${avisos.length} aviso(s)); revisão necessária.`);
      const documento = projectEvents(eventos);
      const { evento, resultado } = decide({ documento, now });
      const { events } = await appendEvents(dataRoot, [{ id: `${evento.tipo}:${randomUUID()}`, ator: 'usuario', evidencia: [], ...evento }], { host, now });
      const depois = projectEvents([...eventos, ...events]);
      await atomicJson(path.join(dataRoot, 'projections', 'pipeline-vagas.json'), depois);
      return resultado(depois);
    });
  } catch (error) {
    if (/Pipeline ocupado/.test(error.message)) throw ocupado('Registro ocupado; tente novamente.');
    throw error;
  }
}
