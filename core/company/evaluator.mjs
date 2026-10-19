// core/company/evaluator.mjs
// Orquestrador de avaliação automatizada de reputação de empresas via busca pública e subagente LLM.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { companyKey } from '../dedup/keys.mjs';
import { appendEvents } from '../store/events.mjs';
import { validarEmpresaAvaliada } from '../store/rules.mjs';
import { localDay } from '../store/schema.mjs';

// O núcleo não faz busca na web nem scraping: os resultados vêm de fora (a pesquisa na web do Claude Code, pelo comando
// /empresa, gravada num arquivo JSON). Sem eles, nada a analisar.
async function defaultSearch(_query) {
  return [];
}

// Lista de resultados da pesquisa na web: [{ titulo, url, trecho }]. Cada item precisa de URL http(s).
export async function lerResultadosBusca(arquivo) {
  let lista;
  try { lista = JSON.parse(await readFile(arquivo, 'utf8')); } catch (error) { throw new Error(`Resultados de busca ilegíveis em ${arquivo}: ${error.message}`); }
  if (!Array.isArray(lista)) throw new Error('Resultados de busca devem ser uma lista de { titulo, url, trecho }.');
  return lista.map((item, i) => {
    if (!item || typeof item.url !== 'string' || !/^https?:\/\/\S+$/i.test(item.url.trim())) throw new Error(`Resultado ${i + 1} sem url http(s) válida.`);
    return { titulo: String(item.titulo ?? '').slice(0, 300), url: item.url.trim(), trecho: String(item.trecho ?? '').slice(0, 1000) };
  });
}

export async function avaliarEmpresa({ empresa, dataRoot, runner, searchImpl = defaultSearch, now = new Date() }) {
  if (!empresa || typeof empresa !== 'string' || !empresa.trim()) {
    throw new Error('Nome da empresa é obrigatório.');
  }

  const query = `"${empresa.trim()}" avaliacao glassdoor OR indeed`;
  const resultadosBusca = await searchImpl(query);
  if (!Array.isArray(resultadosBusca) || !resultadosBusca.length) {
    throw new Error('Avaliação recusada: nenhum resultado de busca pública para analisar. Rode a pesquisa na web (comando /empresa no Claude Code) e passe os resultados com --resultados <arquivo.json>.');
  }

  const resposta = await runner.run({
    agente: 'avaliador-empresa',
    modelo: 'haiku',
    versaoPrompt: '1.0',
    entrada: { empresa: empresa.trim(), resultados: resultadosBusca, data_atual: localDay(now) }
  });

  const parsed = resposta?.json;
  if (!parsed || !parsed.sucesso) {
    throw new Error(`Avaliação recusada: ${parsed?.motivo || 'Nenhuma avaliação encontrada na busca pública.'}`);
  }

  const chave = companyKey(empresa);
  const dados = {
    empresa: empresa.trim(),
    empresa_chave: chave,
    nota: Number(parsed.nota),
    quantidade: Number(parsed.quantidade),
    plataforma: parsed.plataforma,
    data: parsed.data ?? localDay(now),
    fontes: parsed.fontes,
    resumo: parsed.resumo ?? null,
    validade_dias: 90
  };

  const ts = now instanceof Date ? now.toISOString() : String(now);
  const erro = validarEmpresaAvaliada(dados, ts);
  if (erro) throw new Error(`Dados extraídos da avaliação inválidos: ${erro}`);

  const evento = {
    id: `avaliacao:${chave}:${dados.data}:${randomUUID().slice(0, 6)}`,
    ts,
    ator: 'radar',
    tipo: 'empresa.avaliada',
    entidade: 'empresa',
    entidade_id: chave,
    dados
  };

  await appendEvents(dataRoot, [evento], { now: ts });
  return dados;
}
