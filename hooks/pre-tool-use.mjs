#!/usr/bin/env node
// Hook PreToolUse (seam S9): nega escrita do Gmail no processo do leitor de e-mail (F3.12) e, nas abas de candidatura,
// tudo que possa enviar sem aprovação nominal (F6.9). Ferramenta de navegador com estado ilegível ou erro: nega (falha fechado).
import { decidirFerramenta } from '../core/mail/hook.mjs';
import { NAVEGADOR, decidirNavegador } from '../core/apply/hook.mjs';
import { consumirAprovacao, lerAprovacoes } from '../core/apply/approval.mjs';
import { lerSessao } from '../core/apply/sessao.mjs';
import { resolveDataRoot } from '../core/store/dataRoot.mjs';

const saida = (decisao, motivo) => process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decisao, permissionDecisionReason: motivo } })}\n`);

let texto = '';
for await (const pedaco of process.stdin) texto += pedaco;
let entrada = null;
try { entrada = JSON.parse(texto); } catch { /* entrada ilegível: as decisões abaixo negam */ }

const leitor = process.argv.includes('--leitor') || process.env.CAREER_BOUNTY_MAIL_READER === '1';
const email = decidirFerramenta(entrada, { leitor });
if (email) process.stdout.write(`${JSON.stringify(email)}\n`);
else if (!entrada || typeof entrada.tool_name !== 'string') {
  if (leitor) saida('deny', 'entrada do hook inválida: negado por padrão');
} else if (NAVEGADOR.test(entrada.tool_name)) {
  try {
    const dataRoot = resolveDataRoot();
    const agora = process.env.CAREER_BOUNTY_NOW ?? new Date().toISOString();
    const r = decidirNavegador(entrada, { sessao: await lerSessao(dataRoot), aprovacoes: await lerAprovacoes(dataRoot), agora });
    if (r?.decisao === 'negar') saida('deny', r.motivo);
    else if (r?.consumir) {
      if (await consumirAprovacao(dataRoot, { vagaId: r.consumir, ts: agora })) saida('allow', r.motivo);
      else saida('deny', 'aprovação já usada ou vencida');
    }
  } catch (error) {
    saida('deny', `hook de candidatura com erro: negado por padrão (${String(error.message ?? error).slice(0, 120)})`);
  }
}
