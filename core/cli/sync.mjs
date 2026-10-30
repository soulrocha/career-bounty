// Comandos da base central: `sync` (rodada), `sync status`, `sync configurar` e `sync-remote` (lado do servidor).
import { resolveDataRoot } from '../store/dataRoot.mjs';
import { configurarSync, lerConfigSync, lerStatusSync, sincronizar } from '../sync/index.mjs';
import { remotoDel, remotoGet, remotoManifest, remotoPut } from '../sync/remoto.mjs';

async function lerStdin() {
  const partes = [];
  for await (const parte of process.stdin) partes.push(parte);
  return Buffer.concat(partes).toString('utf8');
}

function textoResumo(r) {
  const linhas = [`baixados: ${r.baixados}; enviados: ${r.enviados}; apagados aqui: ${r.apagados_local}; apagados no servidor: ${r.apagados_remoto}`];
  if (r.conflitos.length) linhas.push(`conflitos (valeu a versão do servidor; a local ficou ao lado com .conflito-): ${r.conflitos.join(', ')}`);
  if (r.pendentes.length) linhas.push(`pendentes para a próxima rodada: ${r.pendentes.map(rel => (r.motivos?.[rel] ? `${rel} (${r.motivos[rel]})` : rel)).join(', ')}`);
  if (r.projecao) linhas.push(r.projecao.refeita ? `projeção refeita (${r.projecao.vagas} vagas)` : `projeção não refeita: ${r.projecao.erro}`);
  return linhas.join(String.fromCharCode(10));
}

export const syncCommands = {
  async sync(rest, { parseFlags }) {
    const dataRoot = resolveDataRoot();
    const [sub] = rest;
    if (sub === 'configurar') {
      const values = parseFlags(rest.slice(1), { allowed: ['--comando-json', '--raiz', '--intervalo'], withValue: ['--comando-json', '--raiz', '--intervalo'] });
      if (!values['--comando-json'] || !values['--raiz']) throw new Error('Informe --comando-json \'["ssh","usuario@host","node","/caminho/career-bounty.mjs"]\' e --raiz <pasta no servidor>.');
      let comando;
      try { comando = JSON.parse(values['--comando-json']); } catch { throw new Error('--comando-json deve ser uma lista JSON.'); }
      const config = await configurarSync(dataRoot, { comando, raiz: values['--raiz'], ...(values['--intervalo'] ? { intervalo_s: Number(values['--intervalo']) } : {}) });
      return { result: config, text: `sincronização configurada com ${config.raiz}` };
    }
    if (sub === 'status') {
      parseFlags(rest.slice(1), { allowed: [] });
      const [config, status] = [await lerConfigSync(dataRoot), await lerStatusSync(dataRoot)];
      const result = { configurado: Boolean(config), ...(config ? { raiz: config.raiz, intervalo_s: config.intervalo_s } : {}), ...(status ?? { ultima: null }), conflitos: status?.conflitos ?? [] };
      const text = !config ? 'sincronização não configurada' : !status ? 'nenhuma rodada ainda' : status.ok ? `última rodada ok em ${status.ultima}${status.pendentes?.length ? `; pendentes: ${status.pendentes.join(', ')}` : ''}` : `última rodada falhou em ${status.ultima}: ${status.erro}`;
      return { result, text };
    }
    const values = parseFlags(rest, { allowed: ['--permitir-apagar'] });
    const result = await sincronizar({ dataRoot, permitirApagar: Boolean(values['--permitir-apagar']) });
    return { result, text: textoResumo(result) };
  },
  async 'sync-remote'(rest, { parseFlags }) {
    const [op, ...flags] = rest;
    const values = parseFlags(flags, { allowed: ['--raiz'], withValue: ['--raiz'] });
    const raiz = values['--raiz'] ?? null;
    if (op === 'manifest') return { result: await remotoManifest({ raiz }) };
    if (op === 'put') return { result: await remotoPut({ raiz, entrada: process.stdin }) };
    if (op === 'del') return { result: await remotoDel({ raiz, entrada: await lerStdin() }) };
    if (op === 'get') {
      await remotoGet({ raiz, entrada: await lerStdin(), saida: process.stdout });
      return { result: null, text: '' };
    }
    throw new Error(`Subcomando sync-remote desconhecido: ${op ?? ''}`.trim());
  },
};
