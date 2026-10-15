// Execução das fontes (seam S3). Falha de uma fonte vira estado da fonte e nunca derruba as outras.
import { makeVaga, validateVaga } from './vaga.mjs';

export class SourceError extends Error {
  constructor(codigo, message) {
    super(message);
    this.name = 'SourceError';
    this.codigo = codigo;
  }
}

function withTimeout(promise, ms, controller) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new SourceError('timeout', `tempo esgotado após ${ms} ms`)); }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runOne(source, ctx, timeoutMs) {
  const controller = new AbortController();
  try {
    const found = await withTimeout(Promise.resolve().then(() => source.collect({ ...ctx, config: ctx.config?.[source.id] ?? {}, signal: controller.signal })), timeoutMs, controller);
    if (!Array.isArray(found)) throw new SourceError('estrutura_mudou', 'a fonte não devolveu uma lista de vagas');
    const vagas = [];
    let invalidas = 0;
    for (const raw of found) {
      const vaga = makeVaga({ fonte: source.id, ...raw });
      try { validateVaga(vaga); vagas.push(vaga); } catch { invalidas += 1; }
    }
    const info = { id: source.id, estado: 'ok', vagas: vagas.length, ...(invalidas ? { invalidas } : {}), ...(found.avisos?.length ? { avisos: found.avisos } : {}) };
    return { info, vagas };
  } catch (error) {
    const codigo = error instanceof SourceError ? error.codigo : 'erro';
    return { info: { id: source.id, estado: codigo === 'indisponivel' ? 'indisponivel' : 'erro', codigo, erro: String(error.message ?? error).slice(0, 300), vagas: 0 }, vagas: [] };
  }
}

// Roda as fontes em sequência (espaçamento fica a cargo de cada fonte) e junta as vagas.
export async function runSources(sources, ctx, { timeoutMs = 60000 } = {}) {
  const fontes = [];
  const vagas = [];
  for (const source of sources) {
    const { info, vagas: found } = await runOne(source, ctx, timeoutMs);
    fontes.push(info);
    vagas.push(...found);
  }
  return { fontes, vagas };
}
