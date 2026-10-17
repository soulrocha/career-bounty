// Regras de envio (F7.1): lidas só de DATA_ROOT/config.yml (envio.regras). Envio automático só existe para formulário
// público sem login com driver determinístico (Greenhouse, Lever, Ashby). Gupy, Inhire, Solides e LinkedIn nunca têm driver.
export const PORTAIS_COM_DRIVER = ['greenhouse', 'lever', 'ashby'];
export const ACOES = ['enviar_automatico', 'parar_antes_de_enviar', 'confirmar_lote'];
export const ADERENCIAS = ['alta', 'boa', 'media', 'baixa'];
// Condições conhecidas e o tipo de cada uma. Qualquer outra é erro nomeado (nunca ignorada em silêncio).
export const CONDICOES = {
  aderencia: 'lista_aderencia',
  portal: 'lista_portal',
  rascunhos_llm: 'inteiro',
  respostas_novas_na_rodada: 'inteiro',
  cv_gate: 'cv_gate',
  ja_aplicada: 'booleano',
};

const erro = (onde, motivo) => new Error(`Regra de envio inválida em ${onde}: ${motivo}`);

function validarCondicao(nome, valor, onde) {
  const tipo = CONDICOES[nome];
  if (!tipo) throw erro(onde, `condição desconhecida "${nome}" (conhecidas: ${Object.keys(CONDICOES).join(', ')})`);
  if (tipo === 'lista_aderencia' && (!Array.isArray(valor) || !valor.length || valor.some(a => !ADERENCIAS.includes(a)))) throw erro(onde, `aderencia deve ser lista de ${ADERENCIAS.join(', ')}`);
  if (tipo === 'lista_portal' && (!Array.isArray(valor) || !valor.length || valor.some(p => typeof p !== 'string' || !p.trim()))) throw erro(onde, 'portal deve ser lista de nomes');
  if (tipo === 'inteiro' && (!Number.isInteger(valor) || valor < 0)) throw erro(onde, `${nome} deve ser inteiro >= 0 (máximo permitido)`);
  if (tipo === 'cv_gate' && valor !== 'ok') throw erro(onde, 'cv_gate só aceita "ok"');
  if (tipo === 'booleano' && typeof valor !== 'boolean') throw erro(onde, `${nome} deve ser true ou false`);
}

// Devolve as regras normalizadas ({ id, quando, acao, limite_dia, ativa }) ou lança erro nomeado.
export function validarRegras(regras) {
  if (regras === undefined) return [];
  if (!Array.isArray(regras)) throw erro('envio.regras', 'deve ser lista');
  const ids = new Set();
  return regras.map((regra, i) => {
    const onde = `envio.regras[${i}]`;
    if (!regra || typeof regra !== 'object' || Array.isArray(regra)) throw erro(onde, 'deve ser objeto');
    const extra = Object.keys(regra).find(k => !['id', 'quando', 'acao', 'limite_dia', 'ativa', 'ativo'].includes(k));
    if (extra) throw erro(onde, `campo desconhecido "${extra}"`);
    if (typeof regra.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,60}$/.test(regra.id)) throw erro(onde, 'id obrigatório (minúsculas, números, ponto, hífen)');
    if (ids.has(regra.id)) throw erro(onde, `id repetido "${regra.id}"`);
    ids.add(regra.id);
    const acao = String(regra.acao ?? '').trim().toLowerCase();
    if (!ACOES.includes(acao)) throw erro(onde, `acao deve ser uma de: ${ACOES.join(', ')}`);
    regra = { ...regra, acao };
    const quando = regra.quando ?? {};
    if (typeof quando !== 'object' || Array.isArray(quando)) throw erro(onde, 'quando deve ser objeto');
    for (const [nome, valor] of Object.entries(quando)) validarCondicao(nome, valor, `${onde}.quando`);
    if (regra.limite_dia !== undefined && (!Number.isInteger(regra.limite_dia) || regra.limite_dia < 1)) throw erro(onde, 'limite_dia deve ser inteiro >= 1');
    if (regra.acao === 'enviar_automatico') {
      if (regra.limite_dia === undefined) throw erro(`${onde}.limite_dia`, 'é obrigatório (inteiro >= 1) em regra enviar_automatico');
      if (!quando.portal) throw erro(onde, 'enviar_automatico exige a lista de portais (portal sem driver não envia sozinho)');
      const semDriver = quando.portal.filter(p => !PORTAIS_COM_DRIVER.includes(p));
      if (semDriver.length) throw erro(onde, `portal sem driver: ${semDriver.join(', ')} (envio automático só em ${PORTAIS_COM_DRIVER.join(', ')})`);
    }
    const ativa = regra.ativa ?? regra.ativo ?? true;
    if (typeof ativa !== 'boolean') throw erro(onde, 'ativa deve ser true ou false');
    return { id: regra.id, quando, acao: regra.acao, ...(regra.limite_dia !== undefined ? { limite_dia: regra.limite_dia } : {}), ativa };
  });
}

export const regrasAtivas = regras => regras.filter(r => r.ativa);
