#!/usr/bin/env node
// Hook UserPromptSubmit (F6.9): a única porta que transforma a frase do lote ("enviar estas N: ...") em aprovações.
// Lê a mensagem que a pessoa digitou (o modelo não forja a mensagem do usuário). Nunca bloqueia a mensagem.
import { aprovarPorMensagem } from '../core/apply/approval.mjs';
import { resolveDataRoot } from '../core/store/dataRoot.mjs';

try {
  let texto = '';
  for await (const pedaco of process.stdin) texto += pedaco;
  const entrada = JSON.parse(texto);
  const mensagem = typeof entrada?.prompt === 'string' ? entrada.prompt : '';
  if (/enviar\s+estas?\s+\d+\s*:/i.test(mensagem)) {
    const ts = process.env.CAREER_BOUNTY_NOW ?? new Date().toISOString();
    const vagas = await aprovarPorMensagem(resolveDataRoot(), { mensagem, ts });
    const contexto = vagas.length
      ? `CareerBounty: envio aprovado pela pessoa para ${vagas.length} vaga(s): ${vagas.join(', ')} (uso único, válido por 2 horas).`
      : 'CareerBounty: a frase não corresponde ao lote proposto (ou o lote venceu); nada foi aprovado.';
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: contexto } }));
  } else console.log('{}');
} catch (error) {
  console.error(`career-bounty: aprovação indisponível (${String(error.message ?? error).slice(0, 120)})`);
  console.log('{}');
}
