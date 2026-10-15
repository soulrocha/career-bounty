import { activeRules } from '../config.mjs';

// Esqueleto do plano de candidatura. A política real (PolicyEngine, S7) chega na F7;
// aqui só vale o padrão seguro: sem regra ativa nunca há envio automático.
export function planApply(settings) {
  return { acao: settings.envio.padrao, regras_ativas: activeRules(settings).length };
}
