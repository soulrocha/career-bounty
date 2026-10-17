// Subcomandos de CV: cv gerar (payload, dois PDFs, gate, artefato e evento) e cv gate (reavalia a versão mais nova).
import { loadSettings } from '../config.mjs';
import { gerarCvDaVaga, reavaliarCv } from '../cv/gerar.mjs';
import { runnerDasOpcoes } from './llm.mjs';

const NL = String.fromCharCode(10);
const USO = 'Uso: cv gerar --vaga <id> [--live | --replay <pasta>] | cv gate --vaga <id>';

const linhasGate = gate => (gate.status === 'ok' ? ['gate: ok'] : ['gate: bloqueado', ...gate.motivos.map(m => `  - ${m.motivo}`)]);

export const cvCommands = {
  async cv(rest, { parseFlags }) {
    const [sub, ...flags] = rest;
    if (sub === 'gerar') {
      const values = parseFlags(flags, { allowed: ['--vaga', '--live', '--replay', '--gravar'], withValue: ['--vaga', '--replay'] });
      if (!values['--vaga']) throw new Error(USO);
      const settings = await loadSettings();
      const runner = values['--live'] || values['--replay'] ? await runnerDasOpcoes(values, settings) : null;
      const r = await gerarCvDaVaga({ dataRoot: settings.dataRoot, settings, vagaId: values['--vaga'], runner });
      if (!r.gerado) return { result: r, text: `sem CV para esta vaga: ${r.motivo === 'portal_sem_cv' ? 'o portal usa o perfil (veja a proposta de perfil)' : r.motivo}` };
      const texto = [`CV ${r.tipo} ${r.versao.slice(0, 12)} (visual ${r.paginas.visual} pág., ATS ${r.paginas.ats} pág.) em ${r.pasta}`, ...linhasGate(r.gate),
        ...(r.gate.status !== 'ok' && r.aprovada ? [`o painel continua oferecendo a versão aprovada ${r.aprovada.slice(0, 12)}`] : []), ...r.avisos.map(a => `aviso: ${a}`)];
      return { result: r, exitCode: r.gate.status === 'ok' ? 0 : 1, text: texto.join(NL) };
    }
    if (sub === 'gate') {
      const values = parseFlags(flags, { allowed: ['--vaga'], withValue: ['--vaga'] });
      if (!values['--vaga']) throw new Error(USO);
      const settings = await loadSettings();
      const r = await reavaliarCv({ dataRoot: settings.dataRoot, settings, vagaId: values['--vaga'] });
      return { result: r, exitCode: r.gate.status === 'ok' ? 0 : 1, text: [`CV ${r.versao.slice(0, 12)}`, ...linhasGate(r.gate)].join(NL) };
    }
    throw new Error(USO);
  },
};
