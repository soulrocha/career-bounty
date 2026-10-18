// Corte da migração (F1.15, A3): desliga o modo sombra com segurança.
// Só corta se (1) a projeção bate com o log, (2) o legado em disco ainda é exatamente o que a sombra importou (senão há
// trabalho mais novo lá que o corte abandonaria) e (3) há confirmação explícita. A checagem do legado se repete dentro do lock.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { semanticHash, verifyMigration } from './legacy.mjs';
import { atomicJson } from '../store/atomicWrite.mjs';
import { withLock } from '../store/lock.mjs';
import { appendEvents } from '../store/events.mjs';

async function lerEstado(stateFile) {
  try {
    return JSON.parse(await readFile(stateFile, 'utf8'));
  } catch {
    throw new Error(`Estado de migração ilegível em ${stateFile}: execute a migração em sombra primeiro.`);
  }
}

async function conferirLegado({ careerRoot, state }) {
  if (!careerRoot) throw new Error('Corte exige a pasta do legado (careerRoot) para conferir que nada mais novo ficou lá.');
  let legado;
  try {
    legado = JSON.parse(await readFile(path.join(careerRoot, 'pipeline-vagas.json'), 'utf8'));
  } catch {
    throw new Error('Legado ilegível ou ausente: não é seguro cortar sem conferir o pipeline-vagas.json.');
  }
  if (typeof state.sourceHash !== 'string' || semanticHash(legado) !== state.sourceHash) {
    throw new Error('Não é seguro cortar: o legado mudou depois da última importação. Rode migrate --shadow para importar o que é novo e confira com verify.');
  }
}

export async function cutoverMigration({ dataRoot, careerRoot, confirmo = false, now = new Date().toISOString() }) {
  const stateFile = path.join(dataRoot, 'state', 'migration.json');
  const state = await lerEstado(stateFile);

  if (state.mode === 'ativo') {
    return { ok: true, mode: 'ativo', mensagem: 'O corte já havia sido realizado anteriormente.' };
  }
  if (state.mode !== 'shadow') throw new Error(`Modo de migração inesperado (${state.mode}): o corte só parte do modo sombra.`);

  const verificado = await verifyMigration({ dataRoot });
  if (!verificado.equal) {
    throw new Error('Não é seguro cortar: existem diferenças entre a projeção sombra e o legado. Rode verify e resolva as diferenças antes do corte.');
  }
  await conferirLegado({ careerRoot, state });

  if (!confirmo) {
    throw new Error('O corte desliga o modo sombra e ativa a gravação definitiva no painel. Passe --confirmar-corte para confirmar a transição.');
  }

  return withLock(path.join(dataRoot, '.migration.lock'), {}, async () => {
    // Relê sob o lock: outro processo pode ter mudado o estado ou o legado entre a checagem e a gravação.
    const atual = await lerEstado(stateFile);
    if (atual.mode !== 'shadow') return { ok: true, mode: atual.mode, mensagem: 'O estado mudou durante o corte; nada foi alterado.' };
    await conferirLegado({ careerRoot, state: atual });
    await atomicJson(stateFile, { ...atual, mode: 'ativo', cortadoEm: now });
    await appendEvents(dataRoot, [{
      id: `corte-${Date.parse(now)}`,
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
