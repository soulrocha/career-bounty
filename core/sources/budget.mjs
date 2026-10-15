// Orçamento diário de requisições por fonte, persistido em DATA_ROOT/state. O dia é o civil de São Paulo.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from '../store/atomicWrite.mjs';
import { withLock } from '../store/lock.mjs';
import { localDay } from '../store/schema.mjs';

const file = (dataRoot, nome) => path.join(dataRoot, 'state', `orcamento-${nome}.json`);

async function read(dataRoot, nome, dia) {
  try {
    const state = JSON.parse(await readFile(file(dataRoot, nome), 'utf8'));
    if (state?.dia === dia && Number.isInteger(state.usado)) return { dia, usado: state.usado, bloqueado: state.bloqueado === true };
  } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  return { dia, usado: 0, bloqueado: false };
}

// `limite` é um teto rígido: gastar além dele devolve false sem efeito colateral.
export function createBudget({ dataRoot, nome, limite, now = new Date() }) {
  const dia = localDay(now);
  const lock = path.join(dataRoot, 'state', `orcamento-${nome}.lock`);
  const mutate = update => withLock(lock, { timeoutMs: 5000 }, async () => {
    const state = await read(dataRoot, nome, dia);
    const result = update(state);
    await atomicJson(file(dataRoot, nome), state);
    return result;
  });
  return {
    state: () => read(dataRoot, nome, dia),
    // Gasta uma requisição. Falso se o dia está bloqueado ou o limite acabou.
    consume: () => mutate(state => {
      if (state.bloqueado || state.usado >= limite) return false;
      state.usado += 1;
      return true;
    }),
    // Bloqueio (429, desafio): a fonte descansa até o dia seguinte.
    blockForDay: () => mutate(state => { state.bloqueado = true; }),
  };
}
