#!/usr/bin/env node
import { observarExtracaoPerfil } from '../core/apply/gupyProfile.mjs';
import { resolveDataRoot } from '../core/store/dataRoot.mjs';

try {
  let texto = '';
  for await (const parte of process.stdin) texto += parte;
  await observarExtracaoPerfil(resolveDataRoot(), JSON.parse(texto));
} catch { /* Nenhuma observação em caso de erro; confirmar permanece bloqueado. */ }
console.log('{}');
