// /entrevista pela CLI: lacunas, perguntar (LLM), registrar, pendentes, aprovar, rejeitar.
import { loadSettings } from '../config.mjs';
import { analisarBase } from '../kb/analise.mjs';
import { aprovarPendente, listarPendentes, perguntarLacuna, registrarResposta, rejeitarPendente } from '../kb/interview.mjs';
import { runnerDasOpcoes } from './llm.mjs';

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
