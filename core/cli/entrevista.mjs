// /entrevista pela CLI: lacunas, perguntar (LLM), registrar, pendentes, aprovar, rejeitar.
// F9.6: preparar (dossiê de entrevista para vaga), simular (roteiro interativo de treino com Claude).
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadSettings } from '../config.mjs';
import { analisarBase } from '../kb/analise.mjs';
import { aprovarPendente, listarPendentes, perguntarLacuna, registrarResposta, rejeitarPendente } from '../kb/interview.mjs';
import { runnerDasOpcoes } from './llm.mjs';
import { relogio } from './relogio.mjs';
import { readEvents, appendEvents } from '../store/events.mjs';
import { projectEvents } from '../store/project.mjs';
import { validarEntrevistaPreparada } from '../store/rules.mjs';
import { carregarFontes } from '../kb/fontes.mjs';
import { lerBase } from '../kb/base.mjs';
import { avaliar } from '../score/evaluate.mjs';
import {
  gerarPreparacaoEntrevista,
  gerarRoteiroSimulacao,
  salvarPreparacao,
} from '../interview/preparation.mjs';
import { gravarProposta, slug } from '../kb/outbox.mjs';
import { localDay } from '../store/schema.mjs';

const NL = String.fromCharCode(10);

async function acharLacuna(settings, id) {
  if (!id) throw new Error('Informe --lacuna <id> (veja entrevista lacunas).');
  const { quadrantes, base } = await analisarBase({ dataRoot: settings.dataRoot, settings });
  const lacuna = quadrantes.d.find(l => l.id === id);
  if (!lacuna) throw new Error(`Lacuna não encontrada: ${id}`);
  return { lacuna, base };
}

export const entrevistaCommands = {
  async entrevista(rest, { parseFlags }) {
    const [sub, ...flags] = rest;
    const settings = await loadSettings();

    // Subcomandos F9.6: Preparação e Simulação de Entrevista de Emprego
    if (sub === 'preparar') {
      const values = parseFlags(flags, {
        allowed: ['--vaga', '--saida', '--live', '--replay', '--now', '--json', '--teste'],
        withValue: ['--vaga', '--saida', '--replay', '--now'],
      });
      const vagaId = values['--vaga'];
      if (!vagaId || !vagaId.trim()) throw new Error('Informe --vaga <id>.');

      const nowTs = relogio(values).toISOString();

      const { eventos } = await readEvents(settings.dataRoot);
      const projecao = projectEvents(eventos);
      const vaga = projecao.vagas.find(v => v.id === vagaId);
      if (!vaga) throw new Error(`Vaga não encontrada: ${vagaId}`);

      const { fontes } = await carregarFontes({ dataRoot: settings.dataRoot, settings });
      const base = await lerBase(fontes);

      // Se a vaga ainda não foi avaliada, executa o avaliador
      if (!vaga.requisitos || vaga.requisitos.length === 0) {
        const runner = await runnerDasOpcoes(values, settings);
        const { avaliacao } = await avaliar({
          runner,
          vaga: {
            id: vaga.id,
            vaga: {
              cargo: vaga.cargo,
              empresa: vaga.empresa,
              local: vaga.local,
              modalidade: vaga.modalidade,
              regime: vaga.regime,
              descricao: vaga.descricao_completa || vaga.descricao || '',
            },
          },
          afirmacoes: base.claims,
        });

        const evAvaliacao = {
          id: `vaga.avaliada:${randomUUID()}`,
          ts: nowTs,
          ator: 'usuario',
          tipo: 'vaga.avaliada',
          entidade: 'vagas',
          entidade_id: vaga.id,
          dados: {
            descricao_hash: vaga.descricao_hash,
            avaliacao,
          },
          evidencia: [],
        };
        // Sem hash da descrição a avaliação não tem a que se ligar: usa só nesta preparação, sem gravar.
        if (vaga.descricao_hash) {
          await appendEvents(settings.dataRoot, [evAvaliacao], { now: nowTs });
          const { eventos: eventosAtualizados } = await readEvents(settings.dataRoot);
          const vagaAtualizada = projectEvents(eventosAtualizados).vagas.find(v => v.id === vagaId);
          if (vagaAtualizada) Object.assign(vaga, vagaAtualizada);
        } else {
          Object.assign(vaga, { requisitos: avaliacao.requisitos ?? [], aderencia: avaliacao.aderencia ?? vaga.aderencia });
        }
      }

      const prep = gerarPreparacaoEntrevista({
        vaga,
        avaliacao: vaga,
        base,
        now: nowTs,
      });

      const arquivoRelativo = await salvarPreparacao({
        dataRoot: settings.dataRoot,
        preparacao: prep,
        vagaId: vaga.id,
        saida: values['--saida'],
        now: nowTs,
      });

      const dadosEvento = {
        vaga_id: vaga.id,
        arquivo: arquivoRelativo,
        data: prep.data,
        pontos_fortes_count: prep.contadores.pontos_fortes,
        lacunas_count: prep.contadores.pontos_fracos_e_lacunas,
      };

      const erroRegra = validarEntrevistaPreparada(dadosEvento, nowTs);
      if (erroRegra) throw new Error(erroRegra);

      const evPreparada = {
        id: `entrevista.preparada:${randomUUID()}`,
        ts: nowTs,
        ator: 'usuario',
        tipo: 'entrevista.preparada',
        entidade: 'entrevista',
        entidade_id: vaga.id,
        dados: dadosEvento,
        evidencia: [],
      };
      await appendEvents(settings.dataRoot, [evPreparada], { now: nowTs });

      const text = [
        `# Preparação para Entrevista: ${prep.cargo} na ${prep.empresa}`,
        `- Vaga: ${vaga.id}`,
        `- Aderência: ${prep.aderencia}`,
        `- Pontos Fortes Comprovados: ${prep.contadores.pontos_fortes}`,
        `- Lacunas e Pontos Fracos: ${prep.contadores.pontos_fracos_e_lacunas}`,
        `- Perguntas STAR: ${prep.contadores.perguntas_star}`,
        `- O que NÃO alegar: ${prep.contadores.itens_nao_alegar}`,
        `- Arquivo salvo em: ${arquivoRelativo}`,
      ].join(NL);

      return {
        result: {
          ok: true,
          vaga_id: vaga.id,
          arquivo: arquivoRelativo,
          pontos_fortes_count: prep.contadores.pontos_fortes,
          lacunas_count: prep.contadores.pontos_fracos_e_lacunas,
          preparacao: prep,
        },
        text,
      };
    }

    if (sub === 'simular') {
      const values = parseFlags(flags, {
        allowed: ['--vaga', '--saida', '--live', '--replay', '--now', '--json', '--teste'],
        withValue: ['--vaga', '--saida', '--replay', '--now'],
      });
      const vagaId = values['--vaga'];
      if (!vagaId || !vagaId.trim()) throw new Error('Informe --vaga <id>.');

      const nowTs = relogio(values).toISOString();

      const { eventos } = await readEvents(settings.dataRoot);
      const projecao = projectEvents(eventos);
      const vaga = projecao.vagas.find(v => v.id === vagaId);
      if (!vaga) throw new Error(`Vaga não encontrada: ${vagaId}`);

      const { fontes } = await carregarFontes({ dataRoot: settings.dataRoot, settings });
      const base = await lerBase(fontes);

      const prep = gerarPreparacaoEntrevista({
        vaga,
        avaliacao: vaga,
        base,
        now: nowTs,
      });

      const roteiro = gerarRoteiroSimulacao({ preparacao: prep, vaga });

      const dataHoje = localDay(nowTs);
      const nomePadrao = `simulacao-${slug(vaga.id)}-${dataHoje}.md`;
      const nomeArquivo = values['--saida'] ? path.basename(values['--saida']) : nomePadrao;
      const arquivoAbsoluto = await gravarProposta(settings.dataRoot, 'entrevistas', nomeArquivo, roteiro);
      const arquivoRelativo = path.relative(settings.dataRoot, arquivoAbsoluto).replaceAll('\\', '/');

      return {
        result: {
          ok: true,
          vaga_id: vaga.id,
          arquivo: arquivoRelativo,
          roteiro,
        },
        text: roteiro,
      };
    }

    // Subcomandos legados da entrevista investigativa de lacunas (preservados 100%)
    if (sub === 'lacunas') {
      const values = parseFlags(flags, { allowed: ['--limite'], withValue: ['--limite'] });
      const limite = values['--limite'] ? Number(values['--limite']) : 10;
      if (!Number.isInteger(limite) || limite < 1) throw new Error('Opção inválida: --limite deve ser inteiro >= 1.');
      const { quadrantes } = await analisarBase({ dataRoot: settings.dataRoot, settings });
      const lacunas = quadrantes.d.slice(0, limite);
      return { result: { lacunas, total: quadrantes.d.length }, text: lacunas.map(l => `[${l.peso}] ${l.id}: ${l.descricao}`).join(NL) || 'Nenhuma lacuna.' };
    }
    if (sub === 'perguntar') {
      const values = parseFlags(flags, { allowed: ['--lacuna', '--live', '--replay', '--gravar'], withValue: ['--lacuna', '--replay'] });
      const runner = await runnerDasOpcoes(values, settings);
      const { lacuna, base } = await acharLacuna(settings, values['--lacuna']);
      const result = await perguntarLacuna({ runner, lacuna, base });
      return { result, text: result.perguntas.map((p, i) => `${i + 1}. ${p}`).join(NL) };
    }
    if (sub === 'registrar') {
      const values = parseFlags(flags, { allowed: ['--lacuna', '--texto', '--resposta'], withValue: ['--lacuna', '--texto', '--resposta'] });
      if (!values['--texto'] || !values['--resposta']) throw new Error('Informe --texto "<afirmação>" e --resposta "<resposta da pessoa>".');
      const { lacuna } = await acharLacuna(settings, values['--lacuna']);
      const result = await registrarResposta({ dataRoot: settings.dataRoot, lacuna, texto: values['--texto'], resposta: values['--resposta'] });
      return { result, text: `${result.pendente.id} registrada como relato pendente (${result.pendente.fonte}); rascunho em ${result.rascunho}` };
    }
    if (sub === 'pendentes') {
      parseFlags(flags, { allowed: [] });
      const pendentes = await listarPendentes(settings.dataRoot);
      return { result: { pendentes }, text: pendentes.map(p => `${p.id} (${p.fonte}): ${p.texto}`).join(NL) || 'Nenhum pendente.' };
    }
    if (sub === 'aprovar' || sub === 'rejeitar') {
      const values = parseFlags(flags, { allowed: ['--id'], withValue: ['--id'] });
      if (!values['--id']) throw new Error('Informe --id <AFL-nnn>.');
      const result = sub === 'aprovar' ? await aprovarPendente({ dataRoot: settings.dataRoot, id: values['--id'] }) : await rejeitarPendente({ dataRoot: settings.dataRoot, id: values['--id'] });
      return { result, text: sub === 'aprovar' ? `${result.id} aprovada e gravada em ${result.arquivo}` : `${result.id} descartada` };
    }
    throw new Error(`Subcomando entrevista desconhecido: ${sub ?? ''}`.trim());
  },
};
