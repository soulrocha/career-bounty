import { isEnvioPausado, pausarEnvio, retomarEnvio, auditarDecisoes } from '../apply/policy/killswitch.mjs';
import { resolveDataRoot } from '../store/dataRoot.mjs';
import { localDay } from '../store/schema.mjs';

export const envioCommands = {
  async envio(rest, { json, parseFlags }) {
    const [sub, ...flags] = rest;
    const dataRoot = resolveDataRoot();
    if (sub === 'pausar') {
      const parsed = parseFlags(flags, { allowed: ['--motivo'], withValue: ['--motivo'] });
      const r = await pausarEnvio(dataRoot, { motivo: parsed['--motivo'] ?? 'pausa via CLI' });
      return { result: r, text: `Envio pausado com sucesso (${r.motivo}).` };
    }
    if (sub === 'retomar') {
      parseFlags(flags, { allowed: [] });
      const r = await retomarEnvio(dataRoot);
      return { result: r, text: 'Envio retomado (kill switch removido).' };
    }
    if (sub === 'audit') {
      const parsed = parseFlags(flags, { allowed: ['--dia', '--day'], withValue: ['--dia', '--day'] });
      const dia = parsed['--dia'] ?? parsed['--day'] ?? localDay(new Date().toISOString());
      const decisoes = await auditarDecisoes(dataRoot, { dia });
      const pausado = await isEnvioPausado(dataRoot);
      const text = [`Auditoria de envio para ${dia} (Kill switch: ${pausado ? 'PAUSADO' : 'ATIVO'}):`,
        ...decisoes.map(d => `[${d.ts}] ${d.tipo} ${d.vaga_id ?? ''} ${JSON.stringify(d.dados)}`)].join('\n');
      return {
        result: { dia, pausado, decisoes },
        text
      };
    }
    throw new Error(`Subcomando de envio desconhecido: ${sub ?? ''}. Use envio pausar|retomar|audit.`);
  }
};
