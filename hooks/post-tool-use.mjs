#!/usr/bin/env node
// Hook PostToolUse: observa só respostas de chamadas registradas no PreToolUse (extrator do perfil Gupy, F6.13, e script
// de etapa da Gupy, F6.14). Erro ou formato desconhecido: nenhuma observação (o fluxo que dependia dela fica bloqueado).
import { observarExtracaoPerfil } from '../core/apply/gupyProfile.mjs';
import { observarEtapa } from '../core/apply/sessao.mjs';
import { resolveDataRoot } from '../core/store/dataRoot.mjs';

try {
  let texto = '';
  for await (const parte of process.stdin) texto += parte;
  const entrada = JSON.parse(texto);
  const dataRoot = resolveDataRoot();
  await observarExtracaoPerfil(dataRoot, entrada);
  await observarEtapa(dataRoot, entrada, process.env.CAREER_BOUNTY_NOW ?? new Date().toISOString());
} catch { /* Nenhuma observação em caso de erro. */ }
console.log('{}');
