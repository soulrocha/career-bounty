#!/usr/bin/env node
// Hook PreToolUse: primeira regra é negar qualquer ferramenta de escrita do Gmail (F3.12). A F6.9 amplia.
import { decidirFerramenta } from '../core/mail/hook.mjs';

let texto = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', pedaco => { texto += pedaco; });
process.stdin.on('end', () => {
  let entrada = null;
  try { entrada = JSON.parse(texto); } catch { /* entrada ilegível: decidirFerramenta nega */ }
  const leitor = process.argv.includes('--leitor') || process.env.CAREER_BOUNTY_MAIL_READER === '1';
  const decisao = decidirFerramenta(entrada, { leitor });
  if (decisao) process.stdout.write(`${JSON.stringify(decisao)}\n`);
});
