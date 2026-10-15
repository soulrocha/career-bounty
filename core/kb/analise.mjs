// Análise da base: lê as fontes, extrai os itens dos modelos de CV, junta as vagas do log e calcula os quadrantes.
import { readEvents } from '../store/events.mjs';
import { projectEvents } from '../store/project.mjs';
import { lerBase } from './base.mjs';
import { extrairItensCv } from './cvItems.mjs';
import { carregarFontes } from './fontes.mjs';
import { calcularQuadrantes } from './quadrants.mjs';

export async function analisarBase({ dataRoot, settings, hoje = new Date() }) {
  const { fontes } = await carregarFontes({ dataRoot, settings });
  const base = await lerBase(fontes);
  const ids = new Set(base.claims.map(c => c.id));
  const itens = base.cvTemplates.flatMap(modelo => extrairItensCv(modelo, ids));
  const { eventos } = await readEvents(dataRoot);
  const vagas = projectEvents(eventos).vagas;
  const quadrantes = calcularQuadrantes({ afirmacoes: base.claims, evidencias: base.evidence, historias: base.historias, arcos: base.arcos, itens, cvCarregado: base.cvTemplates.length > 0, vagas, hoje });
  return { base, itens, vagas, quadrantes: { ...quadrantes, avisos: [...base.avisos, ...quadrantes.avisos] } };
}

export const resumoQuadrantes = ({ contagem }) => `(a) ${contagem.a} dado e CV conferem; (b) ${contagem.b} dado fora do CV; (c) ${contagem.c} CV sem dado; (d) ${contagem.d} lacunas`;
