// Plano de busca do dia: janela móvel, termos e rotação de empresas (F2.4 completa este módulo).
import { localDay } from '../store/schema.mjs';

const DAY = 86400000;

// Janela móvel em dias civis de São Paulo: [fim - dias, fim].
export function janela(now, dias = 7) {
  const fim = localDay(now);
  const [y, m, d] = fim.split('-').map(Number);
  const inicio = new Date(Date.UTC(y, m - 1, d) - dias * DAY).toISOString().slice(0, 10);
  return { inicio, fim };
}
