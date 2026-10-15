// Subcomandos da base de conhecimento: kb sync, kb quadrants, kb suggest, kb candidatos.
import path from 'node:path';
import { loadSettings } from '../config.mjs';
import { createRunner } from '../llm/runner.mjs';
import { loadIdentityValues } from '../privacy/redact.mjs';
import { analisarBase, resumoQuadrantes } from '../kb/analise.mjs';
import { candidatosAiMemory, carregarFontes } from '../kb/fontes.mjs';
import { sugerirMarcas } from '../kb/suggest.mjs';
import { syncKb } from '../kb/sync.mjs';

const NL = String.fromCharCode(10);

async function kbSync(settings) {
  const { fontes } = await carregarFontes({ dataRoot: settings.dataRoot, settings });
  return syncKb({ dataRoot: settings.dataRoot, fontes });
}

export const kbCommands = {
  async kb(rest, { parseFlags }) {
    const [sub, ...flags] = rest;
    if (sub === 'sync') {
      parseFlags(flags, { allowed: [] });
      const result = await kbSync(await loadSettings());
      const c = result.contagem;
      const linhas = [`snapshot ${result.hash}${result.mudou ? ' (alterado)' : ' (sem mudança)'}: ${c.afirmacoes} afirmações, ${c.evidencias} evidências, ${c.historias} histórias, ${c.arcos} arcos, ${c.modelos_cv} modelos de CV`,
        ...(result.invalidou.length ? [`caches invalidados: ${result.invalidou.join(', ')}`] : []), ...result.avisos.map(a => `aviso: ${a}`)];
      return { result, text: linhas.join(NL) };
    }
    if (sub === 'quadrants') {
      parseFlags(flags, { allowed: [] });
      const settings = await loadSettings();
      const { quadrantes } = await analisarBase({ dataRoot: settings.dataRoot, settings });
      const topo = quadrantes.d.slice(0, 5).map(l => `  [${l.peso}] ${l.descricao}`);
      return { result: quadrantes, text: [resumoQuadrantes(quadrantes), ...(topo.length ? ['maiores lacunas:', ...topo] : []), ...quadrantes.avisos.map(a => `aviso: ${a}`)].join(NL) };
    }
    if (sub === 'suggest') {
      const values = parseFlags(flags, { allowed: ['--live', '--replay', '--gravar'], withValue: ['--replay'] });
      if (!values['--live'] && !values['--replay']) throw new Error('Informe --live (chamada real ao Claude, cobrada) ou --replay <pasta de gravações>.');
      if (values['--live'] && values['--replay']) throw new Error('Use --live ou --replay, não os dois.');
      const settings = await loadSettings();
      const { hash } = await kbSync(settings);
      const { base, itens } = await analisarBase({ dataRoot: settings.dataRoot, settings });
      const runner = createRunner({ modo: values['--live'] ? 'live' : 'replay', dataRoot: settings.dataRoot, replayDir: values['--replay'] ? path.resolve(values['--replay']) : path.join(settings.dataRoot, 'golden', 'replay'),
        identity: await loadIdentityValues(), env: { ...process.env, ...(values['--live'] ? { LIVE: '1' } : {}) }, gravar: Boolean(values['--gravar']), maxChamadasLive: 1 });
      const result = await sugerirMarcas({ runner, dataRoot: settings.dataRoot, base, itens, snapshotHash: hash });
      const texto = [`${result.propostas.length} proposta(s) de marca, ${result.mapear_a_mao.length} para mapear à mão${result.do_cache ? ' (do cache)' : ''}`, ...(result.arquivo ? [`proposta em ${result.arquivo}`] : [])];
      return { result, text: texto.join(NL) };
    }
    if (sub === 'candidatos') {
      const values = parseFlags(flags, { allowed: ['--consulta'], withValue: ['--consulta'] });
      if (!values['--consulta']) throw new Error('Informe --consulta "<tema>".');
      const settings = await loadSettings();
      const result = await candidatosAiMemory({ dataRoot: settings.dataRoot, settings, consulta: values['--consulta'] });
      const linhas = result.disponivel ? [`${result.candidatos.length} candidato(s) do ai-memory (nenhum é fato até você confirmar)`, ...result.candidatos.map(c => `- ${c.id}: ${c.texto}`)] : [result.mensagem];
      return { result, text: linhas.join(NL) };
    }
    throw new Error(`Subcomando kb desconhecido: ${sub ?? ''}`.trim());
  },
};
