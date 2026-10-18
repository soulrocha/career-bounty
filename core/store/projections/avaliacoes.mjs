// Projeção pura e determinística de avaliações de empresas.
// Agrupa eventos empresa.avaliada por companyKey e calcula vigência temporal.
import { companyKey } from '../../dedup/keys.mjs';
import { localDay } from '../schema.mjs';

function diferencaDias(diaA, diaB) {
  if (!diaA || !diaB) return 0;
  const tA = Date.parse(`${diaA}T12:00:00Z`);
  const tB = Date.parse(`${diaB}T12:00:00Z`);
  return Math.round((tB - tA) / 86400000);
}

export function projectAvaliacoes(eventos, { now = new Date() } = {}) {
  const hoje = localDay(now);
  const porEmpresa = new Map();

  for (const evento of eventos ?? []) {
    if (evento?.tipo !== 'empresa.avaliada') continue;
    const d = evento.dados;
    if (!d) continue;
    const chave = d.empresa_chave || companyKey(d.empresa);
    if (!chave) continue;

    const validadeDias = d.validade_dias ?? 90;
    const diasDecorridos = diferencaDias(d.data, hoje);
    const valida = diasDecorridos >= 0 && diasDecorridos <= validadeDias;
    const diasRestantes = Math.max(0, validadeDias - diasDecorridos);

    const item = {
      id: evento.id,
      empresa: d.empresa,
      empresa_chave: chave,
      nota: d.nota,
      quantidade: d.quantidade,
      plataforma: d.plataforma,
      data: d.data,
      fontes: d.fontes ?? [],
      resumo: d.resumo ?? null,
      validade_dias: validadeDias,
      valida,
      dias_decorridos: Math.max(0, diasDecorridos),
      dias_restantes: diasRestantes,
      expirada: !valida,
      registrado_em: evento.ts
    };

    if (!porEmpresa.has(chave)) porEmpresa.set(chave, []);
    porEmpresa.get(chave).push(item);
  }

  const mapaResultado = {};
  const listaVigentes = [];

  for (const [chave, avaliacoes] of porEmpresa.entries()) {
    // Ordena da mais recente para a mais antiga (data decrescente, desempate ts decrescente)
    avaliacoes.sort((a, b) => b.data.localeCompare(a.data) || b.registrado_em.localeCompare(a.registrado_em));
    const maisRecente = avaliacoes[0];

    const consolidado = {
      ...maisRecente,
      historico: avaliacoes
    };

    mapaResultado[chave] = consolidado;
    if (maisRecente.valida) {
      listaVigentes.push(consolidado);
    }
  }

  return {
    por_empresa: mapaResultado,
    avaliacoes_vigentes: listaVigentes,
    total_empresas: Object.keys(mapaResultado).length,
    total_vigentes: listaVigentes.length
  };
}

export function obterAvaliacaoVigente(empresa, projecaoAvaliacoes, { aliases = {} } = {}) {
  if (!empresa || !projecaoAvaliacoes?.por_empresa) return null;
  const chave = companyKey(empresa, aliases);
  const entrada = projecaoAvaliacoes.por_empresa[chave];
  if (!entrada || !entrada.valida) return null;
  return {
    nota: entrada.nota,
    quantidade: entrada.quantidade,
    plataforma: entrada.plataforma,
    data: entrada.data,
    fontes: entrada.fontes,
    resumo: entrada.resumo
  };
}
