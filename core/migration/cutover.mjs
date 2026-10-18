// Corte da migração (F1.15, A3): desliga o modo sombra com segurança.
// Exige que o diff entre projeção e legado seja zero e pede flag explícita de confirmação.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyMigration } from './legacy.mjs';
import { atomicJson } from '../store/atomicWrite.mjs';
import { withLock } from '../store/lock.mjs';
import { appendEvents } from '../store/events.mjs';

export async function cutoverMigration({ dataRoot, confirmo = false, now = new Date().toISOString() }) {
  const stateFile = path.join(dataRoot, 'state', 'migration.json');
  let state = null;
  try {
    state = JSON.parse(await readFile(stateFile, 'utf8'));
  } catch (e) {
    throw new Error(`Estado de migração ilegível em ${stateFile}: execute a migração em sombra primeiro.`);
  }

  if (state?.mode === 'ativo') {
    return { ok: true, mode: 'ativo', mensagem: 'O corte já havia sido realizado anteriormente.' };
  }

  // Verificar se o modo sombra tem paridade estrita
  const verificado = await verifyMigration({ dataRoot });
  if (!verificado.equal) {
    throw new Error('Não é seguro cortar: existem diferenças entre a projeção sombra e o legado. Rode verify e resolva as diferenças antes do corte.');
  }

  if (!confirmo) {
    throw new Error('O corte desliga o modo sombra e ativa a gravação definitiva no painel. Passe --confirmar-corte para confirmar a transição.');
  }

  return withLock(path.join(dataRoot, '.migration.lock'), {}, async () => {
    const novoEstado = {
      ...state,
      mode: 'ativo',
      cortadoEm: now
    };
    await atomicJson(stateFile, novoEstado);
    const id = `corte-${Date.now()}`;
    await appendEvents(dataRoot, [{
      id,
      ts: now,
      ator: 'humano',
      tipo: 'migracao.concluida',
      entidade: 'sistema',
      entidade_id: 'migracao',
      dados: { cortadoEm: now }
    }], { now });
    return { ok: true, mode: 'ativo', cortadoEm: now };
  });
}
