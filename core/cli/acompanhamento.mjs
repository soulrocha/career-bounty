// core/cli/acompanhamento.mjs
// Comandos CLI para gestão de lembretes e acompanhamento de processos seletivos (F9.2).

import { loadSettings } from '../config.mjs';
import { readEvents } from '../store/events.mjs';
import { projectProcessos } from '../store/projections/processos.mjs';
import { relogio } from './relogio.mjs';

const NL = String.fromCharCode(10);

export const acompanhamentoCommands = {
  async acompanhamento(rest, options = {}) {
    const { parseFlags } = options;
    const [sub, ...flags] = rest;
    const settings = await loadSettings(options.dataRoot ? { dataRoot: options.dataRoot } : undefined);
    const dataRoot = options.dataRoot ?? settings.dataRoot;

    if (sub === 'pendentes') {
      const values = parseFlags(flags, {
        allowed: ['--now', '--teste'],
        withValue: ['--now'],
      });

      const now = relogio(values);
      const { eventos } = await readEvents(dataRoot);
      const projecao = projectProcessos(eventos, { now, config: settings });
      const pendentes = projecao.pendentes;

      if (!pendentes.length) {
        return {
          result: { ok: true, pendentes: [], total: 0 },
          text: 'Nenhum processo pendente de acompanhamento no momento.',
        };
      }

      const linhas = [
        `Processos pendentes de acompanhamento (${pendentes.length}):`,
        ...pendentes.map(p => {
          const emp = p.empresa ? `[${p.empresa}] ` : '';
          const carg = p.cargo ? `${p.cargo} ` : '';
          const tag = p.alerta === 'lembrar' ? '🚨 LEMBRAR' : '⚠️ ATENÇÃO';
          return `- ${tag} (${p.dias_inatividade}d sem contato): ${emp}${carg}(vaga ${p.vaga_id}) - Etapa: ${p.etapa_atual} [${p.situacao}]`;
        }),
      ];

      return {
        result: {
          ok: true,
          pendentes,
          total: pendentes.length,
          totais: projecao.totais,
        },
        text: linhas.join(NL),
      };
    }

    throw new Error(`Subcomando acompanhamento desconhecido: ${sub ?? ''}`.trim());
  },
};
