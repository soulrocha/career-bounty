// /mentor pela CLI: monta o contexto determinístico (somente leitura). A conversa é do agente mentor.
import { loadSettings } from '../config.mjs';
import { loadIdentityValues } from '../privacy/redact.mjs';
import { analisarBase } from '../kb/analise.mjs';
import { montarContextoMentor } from '../kb/mentorContext.mjs';
import { lerSnapshot } from '../kb/sync.mjs';

export const mentorCommands = {
  async mentor(rest, { parseFlags }) {
    const [sub, ...flags] = rest;
    if (sub !== 'contexto') throw new Error(`Subcomando mentor desconhecido: ${sub ?? ''}`.trim());
    parseFlags(flags, { allowed: [] });
    const settings = await loadSettings();
    const { quadrantes, vagas, base } = await analisarBase({ dataRoot: settings.dataRoot, settings });
    const contexto = montarContextoMentor({ quadrantes, vagas, preferencias: base.preferencias, identidade: await loadIdentityValues(), snapshotHash: (await lerSnapshot(settings.dataRoot))?.hash ?? null });
    return { result: contexto, text: contexto.texto };
  },
};
