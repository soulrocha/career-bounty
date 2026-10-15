// Processo filho mínimo: grava um evento no log. Uso: node append-child.mjs <dataRoot> <id> <host>
import { appendEvent } from '../../core/store/events.mjs';

const [dataRoot, id, host] = process.argv.slice(2);
await appendEvent(dataRoot, { id, ator: 'filho', tipo: 'nota.registrada', entidade: 'nota', entidade_id: id, dados: { id } }, { host });
