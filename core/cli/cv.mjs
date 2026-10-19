// Subcomandos de CV: cv gerar (payload, dois PDFs, gate, artefato e evento) e cv gate (reavalia a versão mais nova).
import { loadSettings } from '../config.mjs';
import { gerarCvDaVaga, proporPerfilDoPortal, reavaliarCv } from '../cv/gerar.mjs';
import { runnerDasOpcoes } from './llm.mjs';

const NL = String.fromCharCode(10);
const USO = 'Uso: cv gerar --vaga <id> [--live | --replay <pasta>] | cv gate --vaga <id> | cv perfil-portal [--portal gupy|linkedin] (--live | --replay <pasta>)';

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
      const texto = [`CV ${r.versao.slice(0, 12)}`, ...linhasGate(r.gate), ...(r.gate.status !== 'ok' && r.aprovada ? [`o painel continua oferecendo a versão aprovada ${r.aprovada.slice(0, 12)}`] : []), ...r.avisos.map(a => `aviso: ${a}`)];
      return { result: r, exitCode: r.gate.status === 'ok' ? 0 : 1, text: texto.join(NL) };
    }
    if (sub === 'perfil-portal') {
      const values = parseFlags(flags, { allowed: ['--portal', '--live', '--replay', '--gravar'], withValue: ['--portal', '--replay'] });
      const settings = await loadSettings();
      const runner = await runnerDasOpcoes(values, settings);
      const r = await proporPerfilDoPortal({ dataRoot: settings.dataRoot, settings, portal: values['--portal'] ?? 'gupy', runner });
      return { result: r, text: `${r.secoes.length} campo(s) com proposta de mudança; proposta em ${r.arquivo} (nada foi aplicado no portal)` };
    }
    throw new Error(USO);
  },
};
