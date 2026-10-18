// core/company/evaluator.mjs
// Orquestrador de avaliação automatizada de reputação de empresas via busca pública e subagente LLM.
import { randomUUID } from 'node:crypto';
import { companyKey } from '../dedup/keys.mjs';
import { appendEvents } from '../store/events.mjs';
import { validarEmpresaAvaliada } from '../store/rules.mjs';
import { localDay } from '../store/schema.mjs';

async function defaultSearch(_query) {
  return [];
}

export async function avaliarEmpresa({ empresa, dataRoot, runner, searchImpl = defaultSearch, now = new Date() }) {
  if (!empresa || typeof empresa !== 'string' || !empresa.trim()) {
    throw new Error('Nome da empresa é obrigatório.');
  }

  const query = `"${empresa.trim()}" avaliacao glassdoor OR indeed`;
  const resultadosBusca = await searchImpl(query);

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
