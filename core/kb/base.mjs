// Junta as fontes de conhecimento (S5) numa base única. Precedência: a primeira fonte da lista vence em id repetido.
// Só leitura: nenhuma fonte recebe escrita por aqui.
const porId = (a, b) => String(a.id).localeCompare(String(b.id), 'pt-BR', { numeric: true });

async function coletar(fontes, metodo) {
  const out = [];
  for (const { nome, fonte } of fontes) {
    if (typeof fonte[metodo] !== 'function') continue;
    try { out.push({ nome, itens: await fonte[metodo]() }); }
    catch (error) { throw new Error(`fonte ${nome}: ${error.message}`); }
  }
  return out;
}

function unir(grupos, chave, avisos, rotulo) {
  const vistos = new Map();
  const out = [];
  for (const { nome, itens } of grupos) {
    for (const item of itens) {
      const k = item[chave];
      if (vistos.has(k)) { avisos.push(`${rotulo} ${k} repetido em ${nome}; vale o de ${vistos.get(k)}.`); continue; }
      vistos.set(k, nome);
      out.push({ ...item, fonte_base: nome });
    }
  }
  return out;
}

// fontes: [{ nome, fonte }]. Cada fonte implementa o que souber: claims, evidence, stories, arcs, cvTemplates, preferences, identity.
export async function lerBase(fontes) {
  const avisos = [];
  const claims = unir(await coletar(fontes, 'claims'), 'id', avisos, 'afirmação').sort(porId);
  const ids = new Set(claims.map(c => c.id));
  const evidence = unir(await coletar(fontes, 'evidence'), 'id', avisos, 'evidência').sort(porId);
  for (const ev of evidence) {
    for (const ref of ev.afirmacoes ?? []) if (!ids.has(ref)) throw new Error(`${ev.arquivo}: referencia a afirmação inexistente ${ref}.`);
  }
  const historias = unir(await coletar(fontes, 'stories'), 'id', avisos, 'história').sort(porId);
  const arcos = unir(await coletar(fontes, 'arcs'), 'id', avisos, 'arco').sort(porId);
  for (const item of [...historias, ...arcos]) {
    for (const ref of item.afirmacoes ?? []) if (!ids.has(ref)) throw new Error(`${item.arquivo}: referencia a afirmação inexistente ${ref}.`);
  }
  const cvTemplates = unir(await coletar(fontes, 'cvTemplates'), 'modelo', avisos, 'modelo de CV').sort((a, b) => a.modelo.localeCompare(b.modelo));
  const preferencias = (await coletar(fontes, 'preferences')).reduce((acc, { itens }) => ({
    cargo_alvo: acc.cargo_alvo ?? itens.cargo_alvo ?? null,
    cargos_alvo: [...new Set([...acc.cargos_alvo, ...(itens.cargos_alvo ?? [])])],
    texto: [acc.texto, itens.texto].filter(Boolean).join('\n\n'),
  }), { cargo_alvo: null, cargos_alvo: [], texto: '' });
  const identidades = (await coletar(fontes, 'identity')).map(g => g.itens).filter(Boolean);
  return { claims, evidence, historias, arcos, cvTemplates, preferencias, identityPath: identidades[0] ?? null, avisos };
}
