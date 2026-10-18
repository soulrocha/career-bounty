#!/usr/bin/env node
// Hook PreToolUse (seam S9): nega escrita do Gmail no processo do leitor de e-mail (F3.12) e, nas abas de candidatura,
// tudo que possa enviar sem aprovação nominal (F6.9). Ferramenta de navegador com estado ilegível ou erro: nega (falha fechado).
import { decidirFerramenta } from '../core/mail/hook.mjs';
import { NAVEGADOR, decidirNavegador } from '../core/apply/hook.mjs';
import { consumirAprovacao, lerAprovacoes } from '../core/apply/approval.mjs';
import { invalidarEtapa, lerSessao, registrarEtapaPendente } from '../core/apply/sessao.mjs';
import { resolveDataRoot } from '../core/store/dataRoot.mjs';
import { lerPerfil, autorizarPerfil, vincularSessaoExtracao } from '../core/apply/gupyProfile.mjs';
import { decidirPerfil } from '../core/apply/gupyProfileHook.mjs';
import { loadSettings } from '../core/config.mjs';
import { lerBase } from '../core/kb/base.mjs';
import { carregarFontes } from '../core/kb/fontes.mjs';

import { isEnvioPausado } from '../core/apply/policy/killswitch.mjs';
import { appendEvents } from '../core/store/events.mjs';
import { createHash } from 'node:crypto';

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

    if (await isEnvioPausado(dataRoot)) {
      saida('deny', 'envio pausado pelo kill switch (envio.pausado)');
      process.exit(0);
    }

    const registrarNegado = async (vagaId, motivo) => {
      if (!vagaId) return;
      try {
        const id = `negado-${createHash('sha256').update(agora + entrada.tool_name + String(vagaId)).digest('hex').slice(0, 16)}`;
        await appendEvents(dataRoot, [{ id, ts: agora, ator: 'hook', tipo: 'envio.negado', entidade: 'vaga', entidade_id: String(vagaId), dados: { ferramenta: entrada.tool_name, motivo } }], { now: agora });
      } catch { /* falha ao registrar evento não impede negação */ }
    };

    const perfil = decidirPerfil(entrada, await lerPerfil(dataRoot), agora);
    if (perfil) {
      if (perfil.decisao === 'negar') saida('deny', perfil.motivo);
      else if (perfil.vincular) {
        const vinculo = await vincularSessaoExtracao(dataRoot, perfil.vincular);
        saida(vinculo.decisao === 'permitir' ? 'allow' : 'deny', vinculo.motivo);
      }
      else if (perfil.consumir) {
        const settings = await loadSettings();
        const base = await lerBase((await carregarFontes({ dataRoot, settings })).fontes);
        const autorizacao = await autorizarPerfil(dataRoot, { ...perfil.consumir, ts: agora, afirmacoes: base.claims });
        saida(autorizacao.decisao === 'permitir' ? 'allow' : 'deny', autorizacao.motivo);
      } else saida('allow', perfil.motivo);
    } else {
    const r = decidirNavegador(entrada, { sessao: await lerSessao(dataRoot), aprovacoes: await lerAprovacoes(dataRoot), agora });
    // Chamada que pode mudar a página da aba Gupy apaga a etapa observada antes de seguir (mesmo sem decisão própria).
    if (r?.invalidarEtapa?.length && r.decisao !== 'negar') await invalidarEtapa(dataRoot, r.invalidarEtapa);
    if (r?.decisao === 'negar') {
      if (r.vagaId) await registrarNegado(r.vagaId, r.motivo);
      saida('deny', r.motivo);
    } else if (r?.observarEtapa) {
      // Etapa da Gupy: registra esta chamada para o PostToolUse observar a resposta dela (e só dela).
      await registrarEtapaPendente(dataRoot, { tabId: r.observarEtapa.tabId, toolUseId: entrada.tool_use_id, ts: agora });
      saida('allow', r.motivo);
    } else if (r?.consumir) {
      // Cota e aceite da Gupy vêm da config pessoal, lidos agora (aceite revogado vale na hora); config ilegível nega.
      const { gupy } = await loadSettings({ dataRoot });
      const consumo = await consumirAprovacao(dataRoot, { vagaId: r.consumir, ts: agora, limiteGupy: gupy.max_por_dia, aceiteGupy: gupy.aceite_termos === true });
      if (consumo.ok) saida('allow', r.motivo);
      else {
        await registrarNegado(r.consumir, consumo.motivo);
        saida('deny', consumo.motivo);
      }
    }
    }
  } catch (error) {
    saida('deny', `hook de candidatura com erro: negado por padrão (${String(error.message ?? error).slice(0, 120)})`);
  }
}
