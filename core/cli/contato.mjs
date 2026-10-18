// core/cli/contato.mjs
// Comandos CLI para gestão de contatos avulsos e pontuais com recrutadores (F9.1).

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadSettings } from '../config.mjs';
import { readEvents, appendEvents } from '../store/events.mjs';
import { projectEvents } from '../store/project.mjs';
import { localDay } from '../store/schema.mjs';
import { validarContatoRegistrado, validarContatoVinculado } from '../store/rules.mjs';
import { projectContatos } from '../store/projections/contatos.mjs';
import { gravarProposta } from '../kb/outbox.mjs';
import { carregarFontes } from '../kb/fontes.mjs';
import { lerBase } from '../kb/base.mjs';
import { rascunharRespostas } from '../apply/rascunho.mjs';
import { runnerDasOpcoes } from './llm.mjs';

const NL = String.fromCharCode(10);

function relogio(values) {
  if (!values['--now']) return new Date();
  if (!values['--teste']) throw new Error('--now só é aceito junto com --teste (relógio simulado, para testes).');
  const now = new Date(values['--now']);
  if (Number.isNaN(now.getTime())) throw new Error('Opção inválida: --now deve ser uma data ISO.');
  return now;
}

async function buscarVaga(dataRoot, vagaId) {
  const { eventos } = await readEvents(dataRoot);
  let vagas = projectEvents(eventos).vagas ?? [];
  if (!vagas.length) {
    try {
      const projecaoJson = JSON.parse(await readFile(path.join(dataRoot, 'projections', 'pipeline-vagas.json'), 'utf8'));
      vagas = projecaoJson.vagas ?? [];
    } catch {}
  }
  return vagas.find(v => v.id === vagaId);
}

export const contatoCommands = {
  async contato(rest, options = {}) {
    const { parseFlags } = options;
    const [sub, ...flags] = rest;
    const settings = await loadSettings(options.dataRoot ? { dataRoot: options.dataRoot } : undefined);
    const dataRoot = options.dataRoot ?? settings.dataRoot;

    if (sub === 'registrar') {
      const values = parseFlags(flags, {
        allowed: [
          '--vaga',
          '--canal',
          '--direcao',
          '--nome',
          '--papel',
          '--resumo',
          '--pergunta',
          '--proxima-etapa-texto',
          '--proxima-etapa-data',
          '--data',
          '--endereco',
          '--now',
          '--teste',
        ],
        withValue: [
          '--vaga',
          '--canal',
          '--direcao',
          '--nome',
          '--papel',
          '--resumo',
          '--pergunta',
          '--proxima-etapa-texto',
          '--proxima-etapa-data',
          '--data',
          '--endereco',
          '--now',
        ],
      });

      const now = relogio(values);
      const contatoId = `con-${randomUUID().slice(0, 8)}`;
      const dataContato = values['--data'] ?? localDay(now);

      const dados = {
        id: contatoId,
        vaga_id: values['--vaga'] ?? null,
        canal: values['--canal'],
        direcao: values['--direcao'],
        pessoa: (values['--nome'] || values['--papel']) ? {
          nome: values['--nome'] ?? null,
          papel: values['--papel'] ?? null,
        } : null,
        resumo: values['--resumo'],
        pergunta: values['--pergunta'] ?? null,
        proxima_etapa: values['--proxima-etapa-texto'] ? {
          texto: values['--proxima-etapa-texto'],
          data: values['--proxima-etapa-data'] ?? null,
        } : null,
        data: dataContato,
        endereco: values['--endereco'] ?? null,
      };

      const erro = validarContatoRegistrado(dados, now);
      if (erro) throw new Error(erro);

      const evento = {
        id: `contato.registrado:${randomUUID()}`,
        ts: now.toISOString(),
        ator: 'usuario',
        tipo: 'contato.registrado',
        entidade: 'contato',
        entidade_id: contatoId,
        dados,
        evidencia: [],
      };

      await appendEvents(dataRoot, [evento], { now: now.toISOString() });
      return {
        result: { id: contatoId, ok: true },
        text: `Contato ${contatoId} registrado com sucesso.`,
      };
    }

    if (sub === 'listar') {
      const values = parseFlags(flags, {
        allowed: ['--vaga', '--ativos', '--now', '--teste'],
        withValue: ['--vaga', '--now'],
      });

      const now = relogio(values);
      const { eventos } = await readEvents(dataRoot);
      const projecao = projectContatos(eventos, { now });

      const contatos = projecao.contatos.filter(c => {
        if (values['--vaga'] && c.vaga_id !== values['--vaga']) return false;
        if (values['--ativos']) {
          const recente = c.dias_desde_ultimo_contato <= 30;
          const proximaFutura = Boolean(c.proxima_etapa?.data && c.proxima_etapa.data >= localDay(now));
          if (!recente && !proximaFutura) return false;
        }
        return true;
      });

      const linhas = contatos.map(c => `[${c.id}] ${c.data} | ${c.canal} (${c.direcao}) | ${c.nome ? `${c.nome}: ` : ''}${c.resumo}`);
      return {
        result: { contatos, total: contatos.length },
        text: linhas.join(NL) || 'Nenhum contato encontrado.',
      };
    }

    if (sub === 'vincular') {
      const values = parseFlags(flags, {
        allowed: ['--contato', '--vaga', '--now', '--teste'],
        withValue: ['--contato', '--vaga', '--now'],
      });

      if (!values['--contato']) throw new Error('Informe --contato <id>.');
      if (!values['--vaga']) throw new Error('Informe --vaga <id>.');

      const now = relogio(values);
      const { eventos } = await readEvents(dataRoot);
      const projecao = projectContatos(eventos, { now });
      const contato = projecao.contatos.find(c => c.id === values['--contato']);
      if (!contato) throw new Error(`Contato não encontrado: ${values['--contato']}`);

      const vaga = await buscarVaga(dataRoot, values['--vaga']);
      if (!vaga) throw new Error(`Vaga não encontrada: ${values['--vaga']}`);

      const erro = validarContatoVinculado({ contato_id: values['--contato'], vaga_id: values['--vaga'] });
      if (erro) throw new Error(erro);

      const evento = {
        id: `contato.vinculado:${randomUUID()}`,
        ts: now.toISOString(),
        ator: 'usuario',
        tipo: 'contato.vinculado',
        entidade: 'contato',
        entidade_id: values['--contato'],
        dados: {
          contato_id: values['--contato'],
          vaga_id: values['--vaga'],
        },
        evidencia: [],
      };

      await appendEvents(dataRoot, [evento], { now: now.toISOString() });
      return {
        result: { contato_id: values['--contato'], vaga_id: values['--vaga'], ok: true },
        text: `Contato ${values['--contato']} vinculado à vaga ${values['--vaga']}.`,
      };
    }

    if (sub === 'sugerir') {
      const values = parseFlags(flags, {
        allowed: ['--contato', '--live', '--replay', '--gravar', '--now', '--teste'],
        withValue: ['--contato', '--replay', '--now'],
      });

      if (!values['--contato']) throw new Error('Informe --contato <id>.');

      const now = relogio(values);
      const { eventos } = await readEvents(dataRoot);
      const projecao = projectContatos(eventos, { now });
      const contato = projecao.contatos.find(c => c.id === values['--contato']);
      if (!contato) throw new Error(`Contato não encontrado: ${values['--contato']}`);
      if (!contato.pergunta || !contato.pergunta.trim()) {
        throw new Error(`Contato ${values['--contato']} não possui pergunta registrada para resposta.`);
      }

      const vaga = contato.vaga_id
        ? (await buscarVaga(dataRoot, contato.vaga_id)) ?? { cargo: 'Oportunidade', empresa: 'Empresa' }
        : { cargo: 'Oportunidade', empresa: 'Empresa' };

      const fontes = (await carregarFontes({ dataRoot, settings })).fontes;
      const base = await lerBase(fontes);

      const runner = options.runner ?? (await runnerDasOpcoes(values, settings));

      const sugestoes = await rascunharRespostas({
        runner,
        campos: [{ ref: 'resposta', label: contato.pergunta }],
        vaga,
        afirmacoes: base.claims,
        meta: { contato_id: contato.id, origem: 'contato-sugerir' },
      });

      const md = [
        `# Rascunho de Resposta — Contato ${contato.id}`,
        '',
        `- **Canal:** ${contato.canal}`,
        `- **Pessoa:** ${contato.nome ?? 'Recrutador(a)'}${contato.papel ? ` (${contato.papel})` : ''}`,
        `- **Data do Contato:** ${contato.data}`,
        contato.vaga_id ? `- **Vaga:** ${contato.vaga_id}` : null,
        '',
        '## Pergunta',
        contato.pergunta,
        '',
        '## Sugestão de Resposta',
        sugestoes.resposta || '',
        '',
      ].filter(linha => linha !== null).join('\n');

      const arquivo = await gravarProposta(dataRoot, 'contatos', `${contato.id}.md`, md);

      return {
        result: { contato_id: contato.id, rascunho: arquivo, ok: true },
        text: `Rascunho de resposta gerado em ${arquivo} (nunca enviado automaticamente).`,
      };
    }

    throw new Error(`Subcomando contato desconhecido: ${sub ?? ''}`.trim());
  },
};
