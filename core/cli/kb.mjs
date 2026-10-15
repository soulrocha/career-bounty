// Subcomandos da base de conhecimento: kb sync.
import { loadSettings } from '../config.mjs';
import { carregarFontes } from '../kb/fontes.mjs';
import { syncKb } from '../kb/sync.mjs';

export const kbCommands = {
  async kb(rest, { parseFlags }) {
    const [sub, ...flags] = rest;
    if (sub === 'sync') {
      parseFlags(flags, { allowed: [] });
      const settings = await loadSettings();
      const { fontes } = await carregarFontes({ dataRoot: settings.dataRoot, settings });
      const result = await syncKb({ dataRoot: settings.dataRoot, fontes });
      const c = result.contagem;
      const linhas = [`snapshot ${result.hash}${result.mudou ? ' (alterado)' : ' (sem mudança)'}: ${c.afirmacoes} afirmações, ${c.evidencias} evidências, ${c.historias} histórias, ${c.arcos} arcos, ${c.modelos_cv} modelos de CV`,
        ...(result.invalidou.length ? [`caches invalidados: ${result.invalidou.join(', ')}`] : []), ...result.avisos.map(a => `aviso: ${a}`)];
      return { result, text: linhas.join(String.fromCharCode(10)) };
    }
    throw new Error(`Subcomando kb desconhecido: ${sub ?? ''}`.trim());
  },
};
