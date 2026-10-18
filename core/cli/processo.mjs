// core/cli/processo.mjs
// Comandos CLI para gestão de etapas e encerramento de processos seletivos (F9.2).

import { randomUUID } from 'node:crypto';
import { loadSettings } from '../config.mjs';
import { appendEvents } from '../store/events.mjs';
import { localDay } from '../store/schema.mjs';
import {
  validarEtapaProcesso,
  validarEncerramentoProcesso,
  DESFECHOS_QUE_DESCARTAM,
} from '../store/rules.mjs';
import { relogio } from './relogio.mjs';

export const processoCommands = {
  async processo(rest, options = {}) {
    const { parseFlags } = options;
    const [sub, ...flags] = rest;
    const settings = await loadSettings(options.dataRoot ? { dataRoot: options.dataRoot } : undefined);
    const dataRoot = options.dataRoot ?? settings.dataRoot;

    if (sub === 'etapa') {
      const values = parseFlags(flags, {
        allowed: ['--vaga', '--etapa', '--data', '--detalhe', '--now', '--teste'],
        withValue: ['--vaga', '--etapa', '--data', '--detalhe', '--now'],
      });

      const vagaId = values['--vaga'];
      const etapa = values['--etapa'];
      const now = relogio(values);
      const ts = now.toISOString();
      const data = values['--data'] ?? localDay(ts);
      const detalhe = values['--detalhe'] ?? null;

      const erro = validarEtapaProcesso(
        { vaga_id: vagaId, etapa, data, detalhe },
        ts
      );
      if (erro) throw new Error(`Opção inválida: ${erro}`);

      const evento = {
        id: `processo.etapa:${randomUUID()}`,
        ts,
        ator: 'usuario',
        tipo: 'processo.etapa',
        entidade: 'processo',
        entidade_id: vagaId,
        dados: {
          vaga_id: vagaId,
          etapa,
          data,
          ...(detalhe ? { detalhe } : {}),
        },
      };

      await appendEvents(dataRoot, [evento], { now: ts });

      return {
        result: {
          ok: true,
          id: evento.id,
          vaga_id: vagaId,
          etapa,
          data,
          detalhe,
        },
        text: `Etapa ${etapa} registrada com sucesso para a vaga ${vagaId}.`,
      };
    }

    if (sub === 'encerrar') {
      const values = parseFlags(flags, {
        allowed: ['--vaga', '--desfecho', '--data', '--nota', '--now', '--teste'],
        withValue: ['--vaga', '--desfecho', '--data', '--nota', '--now'],
      });

      const vagaId = values['--vaga'];
      const desfecho = values['--desfecho'];
      const now = relogio(values);
      const ts = now.toISOString();
      const data = values['--data'] ?? localDay(ts);
      const nota = values['--nota'] ?? null;

      const erro = validarEncerramentoProcesso(
        { vaga_id: vagaId, desfecho, data, nota },
        ts
      );
      if (erro) throw new Error(`Opção inválida: ${erro}`);

      const eventoEncerrar = {
        id: `processo.encerrado:${randomUUID()}`,
        ts,
        ator: 'usuario',
        tipo: 'processo.encerrado',
        entidade: 'processo',
        entidade_id: vagaId,
        dados: {
          vaga_id: vagaId,
          desfecho,
          data,
          ...(nota ? { nota } : {}),
        },
      };

      const eventosParaGravar = [eventoEncerrar];
      const descarta = DESFECHOS_QUE_DESCARTAM.has(desfecho);

      if (descarta) {
        const eventoDescarte = {
          id: `vaga.descartada:${randomUUID()}`,
          ts,
          ator: 'usuario',
          tipo: 'vaga.descartada',
          entidade: 'vaga',
          entidade_id: vagaId,
          dados: {
            descartada: true,
            motivo: `Processo encerrado: ${desfecho}`,
            registrado_em: ts,
          },
        };
        eventosParaGravar.push(eventoDescarte);
      }

      await appendEvents(dataRoot, eventosParaGravar, { now: ts });

      return {
        result: {
          ok: true,
          id: eventoEncerrar.id,
          vaga_id: vagaId,
          desfecho,
          data,
          nota,
          descartada: descarta,
        },
        text: `Processo encerrado com desfecho ${desfecho}${descarta ? ' (vaga descartada)' : ''}.`,
      };
    }

    throw new Error(`Subcomando processo desconhecido: ${sub ?? ''}`.trim());
  },
};
