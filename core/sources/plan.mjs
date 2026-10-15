// Plano de busca do dia: janela móvel, termos e rotação de empresas monitoradas por dia útil.
import { localDay } from '../store/schema.mjs';

const DAY = 86400000;
const FATIAS = 5; // segunda a sexta

const parts = iso => iso.split('-').map(Number);

// Janela móvel em dias civis de São Paulo: [fim - dias, fim].
export function janela(now, dias = 7) {
  const fim = localDay(now);
  const [y, m, d] = parts(fim);
  const inicio = new Date(Date.UTC(y, m - 1, d) - dias * DAY).toISOString().slice(0, 10);
  return { inicio, fim };
}

// 0 = segunda ... 4 = sexta; null no fim de semana. O dia vem do calendário de São Paulo, não do UTC.
export function diaUtil(now) {
  const [y, m, d] = parts(localDay(now));
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return weekday >= 1 && weekday <= 5 ? weekday - 1 : null;
}

function termosLimpos(lista = [], avisos) {
  const vistos = new Set();
  const out = [];
  lista.forEach((item, index) => {
    const termo = typeof item === 'string' ? item.trim() : '';
    if (!termo) { avisos.push(`termo ${index + 1} vazio descartado`); return; }
    const chave = termo.toLowerCase();
    if (vistos.has(chave)) { avisos.push(`termo duplicado descartado: ${termo}`); return; }
    vistos.add(chave);
    out.push(termo);
  });
  return out;
}

// Empresas monitoradas giram por dia da semana: a empresa i cai na fatia i % 5.
export function buildPlan(radar, now) {
  const avisos = [];
  const termos = termosLimpos(radar.termos, avisos);
  const fatia = diaUtil(now);
  const empresas = fatia === null ? [] : (radar.empresas_monitoradas ?? []).filter((_, index) => index % FATIAS === fatia);
  return { janela: janela(now, radar.janela_dias ?? 7), termos, empresas, dia_util: fatia !== null, fatia, avisos };
}
