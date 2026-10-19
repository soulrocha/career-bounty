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

const URL_VALIDA = /^https?:\/\/[^\s]+$/i;

// Fontes do legado: o pipeline antigo grava URLs em texto; versões mais novas, objetos { url, plataforma }.
// Sem URL válida não há fonte, e a avaliação não é migrada: atribuir o link da vaga ou a página inicial do portal
// como fonte de uma nota seria inventar a procedência.
function normalizarFontes(avFontes, plataforma) {
  const fontesValidas = [];
  for (const f of Array.isArray(avFontes) ? avFontes : []) {
    const url = typeof f === 'string' ? f.trim() : (f && typeof f === 'object' && typeof f.url === 'string' ? f.url.trim() : '');
    if (!URL_VALIDA.test(url)) continue;
    fontesValidas.push({ url, plataforma: normalizarPlataforma((typeof f === 'object' && f.plataforma) || plataforma) });
  }
  return fontesValidas;
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

    // Por empresa, fica a primeira avaliação com fonte; sem nenhuma com fonte, a primeira (que será contada como sem fonte).
    const atual = porEmpresa.get(chave);
    if (!atual || (!normalizarFontes(atual.av.fontes).length && normalizarFontes(av.fontes).length)) {
      porEmpresa.set(chave, { vaga, av });
    }
  }

  const eventosNovos = [];
  let migradas = 0;
  let semFonte = 0;

  for (const [chave, { vaga, av }] of porEmpresa.entries()) {
    const nota = Math.min(5.0, Math.max(1.0, Math.round(Number(av.nota) * 10) / 10));
    const quantidadeRaw = Number.isInteger(av.quantidade) ? av.quantidade : (Number.isInteger(av.avaliacoes) ? av.avaliacoes : 0);
    const quantidade = Math.max(0, quantidadeRaw);
    const plataforma = normalizarPlataforma(av.plataforma);

    let data = isoDate(av.data);
    if (!data || data > hoje) {
      data = hoje;
    }

    const fontes = normalizarFontes(av.fontes, plataforma);
    if (!fontes.length) { semFonte += 1; continue; }
    migradas += 1;
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
    empresas_migradas: migradas,
    empresas_sem_fonte: semFonte,
    novos_eventos: eventosNovos.length
  };
}
