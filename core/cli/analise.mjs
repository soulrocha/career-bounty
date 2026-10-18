// core/cli/analise.mjs
// Comandos CLI para Análise do Currículo contra a Base (F9.5).

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadSettings } from '../config.mjs';
import { readEvents, appendEvents } from '../store/events.mjs';
import { localDay } from '../store/schema.mjs';
import { analisarBase } from '../kb/analise.mjs';
import { projectAnaliseCurriculo } from '../store/projections/analiseCurriculo.mjs';
import { validarAfirmacaoIncluida, validarItemMarcado, validarLacunaEntrevista } from '../store/rules.mjs';
import { experienciaDaAfirmacao } from '../cv/experiencias.mjs';
import { gravarProposta, slug } from '../kb/outbox.mjs';
import { relogio } from './relogio.mjs';

const NL = String.fromCharCode(10);

export const analiseCommands = {
  async analise(rest, options = {}) {
    const { parseFlags } = options;
    const [sub, ...flags] = rest;
    const settings = await loadSettings(options.dataRoot ? { dataRoot: options.dataRoot } : undefined);
    const dataRoot = options.dataRoot ?? settings.dataRoot;

    if (sub === 'listar') {
      const values = parseFlags(flags, {
        allowed: ['--grupo', '--status', '--now', '--teste'],
        withValue: ['--grupo', '--status', '--now'],
      });

      const now = relogio(values);
      const { base, quadrantes } = await analisarBase({ dataRoot, settings, hoje: now });
      const { eventos } = await readEvents(dataRoot);
      const projecao = projectAnaliseCurriculo({ quadrantes, evidencias: base.evidence, eventos, now });

      let itens;
      const grupoFiltro = values['--grupo'];
      const statusFiltro = values['--status'];

      if (grupoFiltro) {
        if (!['confere', 'sem_prova', 'fora_do_cv', 'lacuna'].includes(grupoFiltro)) {
          throw new Error('Grupo inválido; use confere, sem_prova, fora_do_cv ou lacuna.');
        }
        itens = projecao.grupos[grupoFiltro] ?? [];
      } else {
        itens = [
          ...projecao.grupos.confere,
          ...projecao.grupos.sem_prova,
          ...projecao.grupos.fora_do_cv,
          ...projecao.grupos.lacuna,
        ];
      }

      if (statusFiltro) {
        itens = itens.filter(i => i.status === statusFiltro);
      }

      const linhas = itens.map(i => `[${i.id}] (${i.nivel_prova}) [${i.status}]: ${i.texto}`);
      const text = linhas.join(NL) || 'Nenhum item encontrado.';

      if (grupoFiltro || statusFiltro) {
        return {
          result: {
            grupos: projecao.grupos,
            contadores: projecao.contadores,
            itens,
            total_filtrado: itens.length,
            ok: true,
          },
          text,
        };
      }

      return {
        result: {
          grupos: projecao.grupos,
          contadores: projecao.contadores,
          avisos: projecao.avisos,
          ok: true,
        },
        text,
      };
    }

    if (sub === 'incluir') {
      const values = parseFlags(flags, {
        allowed: ['--afirmacao', '--experiencia', '--data', '--now', '--teste'],
        withValue: ['--afirmacao', '--experiencia', '--data', '--now'],
      });

      if (!values['--afirmacao']) throw new Error('Informe --afirmacao <id>.');

      const now = relogio(values);
      const afirmacaoId = values['--afirmacao'].replace(/^fora_do_cv:af:/, '').trim();

      const { base } = await analisarBase({ dataRoot, settings, hoje: now });
      const af = base.claims.find(c => c.id === afirmacaoId);
      if (!af) {
        throw new Error(`Afirmação não encontrada na base: ${afirmacaoId}`);
      }

      let experienciaId = values['--experiencia'] ?? null;
      if (!experienciaId) {
        let perfil = null;
        try {
          perfil = JSON.parse(await readFile(path.join(dataRoot, 'cv', 'perfil.json'), 'utf8'));
        } catch {}
        if (perfil?.experiencias) {
          experienciaId = experienciaDaAfirmacao(af, perfil.experiencias) ?? null;
        }
      }

      const data = values['--data'] ?? localDay(now);
      const dados = {
        afirmacao_id: afirmacaoId,
        experiencia_id: experienciaId,
        data,
      };

      const erro = validarAfirmacaoIncluida(dados, now.toISOString());
      if (erro) throw new Error(erro);

      const evento = {
        id: `analise.afirmacao_incluida:${randomUUID()}`,
        ts: now.toISOString(),
        ator: 'usuario',
        tipo: 'analise.afirmacao_incluida',
        entidade: 'afirmacao',
        entidade_id: afirmacaoId,
        dados,
        evidencia: [],
      };

      await appendEvents(dataRoot, [evento], { now: now.toISOString() });
      return {
        result: {
          afirmacao_id: afirmacaoId,
          experiencia_id: experienciaId,
          ok: true,
        },
        text: `Afirmação ${afirmacaoId} incluída ${experienciaId ? `na experiência ${experienciaId}` : 'em destaques'}.`,
      };
    }

    if (sub === 'marcar') {
      const values = parseFlags(flags, {
        allowed: ['--item', '--como', '--motivo', '--data', '--now', '--teste'],
        withValue: ['--item', '--como', '--motivo', '--data', '--now'],
      });

      if (!values['--item']) throw new Error('Informe --item <id>.');

      const now = relogio(values);
      const itemId = values['--item'].trim();
      const como = values['--como'] === 'ignorar' ? 'ignorado' : values['--como'];
      const data = values['--data'] ?? localDay(now);

      const dados = {
        item_id: itemId,
        como,
        motivo: values['--motivo'] ?? null,
        data,
      };

      const erro = validarItemMarcado(dados, now.toISOString());
      if (erro) throw new Error(erro);

      const evento = {
        id: `analise.item_marcado:${randomUUID()}`,
        ts: now.toISOString(),
        ator: 'usuario',
        tipo: 'analise.item_marcado',
        entidade: 'item_analise',
        entidade_id: itemId,
        dados,
        evidencia: [],
      };

      await appendEvents(dataRoot, [evento], { now: now.toISOString() });
      return {
        result: {
          item_id: itemId,
          como,
          ok: true,
        },
        text: `Item ${itemId} marcado como ${como}.`,
      };
    }

    if (sub === 'lacuna') {
      const values = parseFlags(flags, {
        allowed: ['--item', '--entrevista', '--data', '--now', '--teste'],
        withValue: ['--item', '--data', '--now'],
      });

      if (!values['--entrevista']) {
        throw new Error('Subcomando analise lacuna exige a flag --entrevista.');
      }
      if (!values['--item']) {
        throw new Error('Informe --item <id>.');
      }

      const now = relogio(values);
      const itemId = values['--item'].trim();

      const { base, quadrantes } = await analisarBase({ dataRoot, settings, hoje: now });
      const { eventos } = await readEvents(dataRoot);
      const projecao = projectAnaliseCurriculo({ quadrantes, evidencias: base.evidence, eventos, now });

      const item = projecao.grupos.lacuna.find(l =>
        l.id === itemId ||
        l.id === `lacuna:${itemId}` ||
        l.id.replace(/^lacuna:/, '') === itemId
      );

      if (!item) {
        throw new Error('Item de lacuna não encontrado na análise.');
      }
      if (!item.pergunta || !item.pergunta.trim()) {
        throw new Error('Item de lacuna não possui pergunta sugerida.');
      }

      const data = values['--data'] ?? localDay(now);
      const md = [
        '# Pergunta de Entrevista de Lacuna',
        '',
        `- **Item:** ${item.id}`,
        `- **Tipo:** ${item.tipo_origem || 'lacuna'}`,
        `- **Data de Geração:** ${data}`,
        '',
        '## Pergunta Sugerida',
        item.pergunta,
        '',
        '## Justificativa',
        item.motivo || item.texto,
        '',
      ].join('\n');

      const slugId = slug(item.id.replace(/^lacuna:/, ''));
      const nomeArquivo = `lacuna-${slugId}-${data}.md`;
      const arquivoAbsoluto = await gravarProposta(dataRoot, 'lacunas', nomeArquivo, md);
      const arquivoRelativo = path.relative(dataRoot, arquivoAbsoluto).replaceAll('\\', '/');

      const dados = {
        item_id: item.id,
        pergunta: item.pergunta,
        arquivo_rascunho: arquivoRelativo,
        data,
      };

      const erro = validarLacunaEntrevista(dados, now.toISOString());
      if (erro) throw new Error(erro);

      const evento = {
        id: `analise.lacuna_entrevista:${randomUUID()}`,
        ts: now.toISOString(),
        ator: 'usuario',
        tipo: 'analise.lacuna_entrevista',
        entidade: 'lacuna',
        entidade_id: item.id,
        dados,
        evidencia: [],
      };

      await appendEvents(dataRoot, [evento], { now: now.toISOString() });
      return {
        result: {
          item_id: item.id,
          pergunta: item.pergunta,
          rascunho: arquivoRelativo,
          ok: true,
        },
        text: `Pergunta de entrevista gerada em ${arquivoRelativo}`,
      };
    }

    throw new Error(`Subcomando analise desconhecido: ${sub ?? ''}`.trim());
  },
};
