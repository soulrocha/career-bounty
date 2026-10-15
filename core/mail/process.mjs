// Processamento de um lote de e-mails do digest: sanitiza, classifica por regra, abre só o que precisa (fase B),
// classifica o resto com o LLM, vincula à vaga e gera os efeitos. Sem I/O próprio: tudo entra por parâmetro.
import { classificar } from './rules.mjs';
import { combinar, selecionarParaLlm } from './classify.mjs';
import { vincular } from './link.mjs';
import { aplicarEfeitos } from './effects.mjs';
import { sanitizarCampo, sanitizarEmail } from './sanitize.mjs';

const pendente = motivo => ({ classe: 'pendente', confianca: 'baixa', origem: 'pendente', motivo });

// abrir(ids) -> { itens: [{ message_id, corpo }], adiados: [ids] }   (fase B)
// classificarLlm(itens) -> Map(message_id -> { classe, confianca, origem, motivo })
export async function processarItens({ itens, vagas, abrir, classificarLlm, config = {}, now = new Date() }) {
  const opcoes = { extras: config.portais_extras ?? [], confiaveis: config.dominios_confiaveis ?? [] };
  const limpos = itens.map(item => ({ ...item, assunto: sanitizarCampo(item.assunto, 300, { extras: opcoes.extras }), trecho: sanitizarCampo(item.trecho, 300, { extras: opcoes.extras }) }));
  const regras = new Map(limpos.map(item => [item.message_id, classificar(item, opcoes)]));
  const precisaAbrir = limpos.filter(item => regras.get(item.message_id).precisa_abrir).sort((a, b) => b.data.localeCompare(a.data) || a.message_id.localeCompare(b.message_id)).map(item => item.message_id);

  const corpos = new Map();
  let adiados = [];
  if (precisaAbrir.length && abrir) {
    const aberto = await abrir(precisaAbrir);
    adiados = aberto.adiados ?? [];
    for (const { message_id, corpo } of aberto.itens) corpos.set(message_id, sanitizarEmail(corpo, { extras: opcoes.extras }).texto);
  }

  const depois = new Map(regras);
  for (const item of limpos) if (corpos.has(item.message_id)) depois.set(item.message_id, classificar(item, { ...opcoes, corpo: corpos.get(item.message_id) }));

  const paraLlm = selecionarParaLlm(limpos.filter(item => corpos.has(item.message_id)).map(item => ({ message_id: item.message_id, corpo: corpos.get(item.message_id), regra: depois.get(item.message_id), assunto: item.assunto, remetente_dominio: item.remetente_dominio })));
  const doLlm = paraLlm.length && classificarLlm ? await classificarLlm(paraLlm) : new Map();

  const classificados = new Map();
  for (const item of limpos) {
    const regra = depois.get(item.message_id);
    let c;
    if (regra.classe) c = combinar(regra, null);
    else if (adiados.includes(item.message_id)) c = pendente('adiado pelo limite da fase B');
    else if (!corpos.has(item.message_id)) c = pendente(regra.precisa_abrir ? 'não foi aberto' : regra.motivo);
    else c = combinar(regra, doLlm.get(item.message_id) ?? null);
    classificados.set(item.message_id, c);
  }

  const vinculados = limpos.map(item => {
    const classificacao = classificados.get(item.message_id);
    const corpo = corpos.get(item.message_id);
    return { item, classificacao, corpo, vinculo: vincular({ classe: classificacao.classe, item, corpo, extras: opcoes.extras }, vagas) };
  });
  const { eventos, resumo } = aplicarEfeitos({ itens: vinculados, vagas, now });
  const porOrigem = {};
  for (const c of classificados.values()) porOrigem[c.origem] = (porOrigem[c.origem] ?? 0) + 1;
  const porRegra = {};
  for (const regra of depois.values()) for (const id of regra.regras) porRegra[id] = (porRegra[id] ?? 0) + 1;
  return { eventos, resumo, por_regra: porRegra, precisa_abrir: precisaAbrir.length, classificados: [...classificados].map(([message_id, c]) => ({ message_id, ...c })), por_origem: porOrigem, abertos: [...corpos.keys()], adiados, enviados_ao_llm: paraLlm.length };
}
