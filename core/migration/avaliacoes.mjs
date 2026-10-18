// Migração pura e determinística de avaliações de empresas embutidas nas vagas legadas.
// Transforma dados legados em eventos empresa.avaliada no log de eventos.
import { companyKey } from '../dedup/keys.mjs';
import { defaultHost, readEvents, appendEvents } from '../store/events.mjs';
import { projectEvents } from '../store/project.mjs';
import { isoDate, PLATAFORMAS_AVALIACAO } from '../store/rules.mjs';
import { localDay } from '../store/schema.mjs';

function normalizarPlataforma(raw) {
  if (!raw || typeof raw !== 'string') return 'Glassdoor';
  const lower = raw.toLowerCase().trim();
  if (lower.includes('glassdoor')) return 'Glassdoor';
  if (lower.includes('indeed')) return 'Indeed';
  if (lower.includes('catho')) return 'Catho';
  return PLATAFORMAS_AVALIACAO.has(raw) ? raw : 'Outro';
}

function normalizarFontes(avFontes, fallbackUrl, plataforma) {
  const fontesValidas = [];
  if (Array.isArray(avFontes)) {
    for (const f of avFontes) {
      if (f && typeof f === 'object' && typeof f.url === 'string' && /^https?:\/\/[^\s]+$/i.test(f.url.trim())) {
        fontesValidas.push({
          url: f.url.trim(),
          plataforma: normalizarPlataforma(f.plataforma || plataforma)
        });
      }
    }
  }
  if (fontesValidas.length > 0) return fontesValidas;

  const url = typeof fallbackUrl === 'string' && /^https?:\/\/[^\s]+$/i.test(fallbackUrl.trim())
    ? fallbackUrl.trim()
    : 'https://www.glassdoor.com.br';

  return [{ url, plataforma }];
}

export async function migrarAvaliacoesLegadas({ dataRoot, host = defaultHost(), now = new Date().toISOString() }) {
  const { eventos } = await readEvents(dataRoot);
  const existentesIds = new Set(eventos.map(e => e.id));

  const hoje = localDay(now);
  const doc = projectEvents(eventos, { now: new Date(now) });
  const porEmpresa = new Map();

  for (const vaga of doc.vagas ?? []) {
    if (!vaga?.empresa || !vaga.empresa_avaliacao) continue;
    const av = vaga.empresa_avaliacao;
    if (av.nota === null || av.nota === undefined) continue;

    const notaNum = Number(av.nota);
    if (!Number.isFinite(notaNum) || notaNum < 1.0) continue;

    const chave = companyKey(vaga.empresa);
    if (!chave) continue;

    // Guarda ou atualiza com a mais completa
    if (!porEmpresa.has(chave)) {
      porEmpresa.set(chave, { vaga, av });
    }
  }

  const eventosNovos = [];

  for (const [chave, { vaga, av }] of porEmpresa.entries()) {
    const nota = Math.min(5.0, Math.max(1.0, Math.round(Number(av.nota) * 10) / 10));
    const quantidadeRaw = Number.isInteger(av.quantidade) ? av.quantidade : (Number.isInteger(av.avaliacoes) ? av.avaliacoes : 0);
    const quantidade = Math.max(0, quantidadeRaw);
    const plataforma = normalizarPlataforma(av.plataforma);

    let data = isoDate(av.data);
    if (!data || data > hoje) {
      data = hoje;
    }

    const fontes = normalizarFontes(av.fontes, vaga.url, plataforma);
    const resumo = typeof av.resumo === 'string' && av.resumo.trim() ? av.resumo.trim().slice(0, 500) : null;

    const dados = {
      empresa: vaga.empresa,
      empresa_chave: chave,
      nota,
      quantidade,
      plataforma,
      data,
      fontes,
      resumo,
      validade_dias: 90
    };

    const id = `migracao:avaliacao:${chave}:${data}`;

    if (!existentesIds.has(id)) {
      eventosNovos.push({
        id,
        ts: new Date(now).toISOString(),
        host,
        ator: 'migracao',
        tipo: 'empresa.avaliada',
        entidade: 'empresa',
        entidade_id: chave,
        dados
      });
    }
  }

  if (eventosNovos.length > 0) {
    await appendEvents(dataRoot, eventosNovos, { host, now });
  }

  return {
    empresas_migradas: porEmpresa.size,
    novos_eventos: eventosNovos.length
  };
}
