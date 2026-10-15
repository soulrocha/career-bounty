// Subcomandos de `mail`: leitura de e-mail pelo conector Gmail (somente leitura) e reconciliação com o tracker.
import { loadSettings } from '../config.mjs';
import { lerCursor } from '../mail/cursor.mjs';
import { buildQuery } from '../mail/query.mjs';

function agora(values) {
  const now = values['--now'] ? new Date(values['--now']) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Opção inválida: --now deve ser uma data ISO.');
  return now;
}

export async function mail(rest, { parseFlags }) {
  const [sub, ...flags] = rest;
  if (sub === 'query') {
    const values = parseFlags(flags, { allowed: ['--now', '--so-portais', '--janela-dias'], withValue: ['--now', '--janela-dias'] });
    const now = agora(values);
    const settings = await loadSettings();
    const config = { ...settings.mail, ...(values['--so-portais'] ? { so_portais: true } : {}) };
    if (values['--janela-dias'] !== undefined) {
      const dias = Number(values['--janela-dias']);
      if (!Number.isInteger(dias) || dias < 1 || dias > 60) throw new Error('Opção inválida: --janela-dias deve ficar entre 1 e 60.');
      config.janela_dias = dias;
    }
    const cursor = await lerCursor(settings.dataRoot, { now });
    const consulta = buildQuery({ mail: config, cursor, now });
    return { result: consulta, text: `${consulta.query}\n(limite ${consulta.limite}${consulta.avisos.length ? `; avisos: ${consulta.avisos.join('; ')}` : ''})` };
  }
  throw new Error(`Subcomando mail desconhecido: ${sub ?? ''}`.trim());
}
