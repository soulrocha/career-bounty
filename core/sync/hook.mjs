// Rodada de sincronização para os hooks do Claude Code: só roda se configurada, com prazo, e nunca lança.
// Devolve um aviso curto para o contexto da sessão, ou null quando está tudo certo (ou não configurado).
import { lerConfigSync, sincronizacaoOcupada, sincronizar } from './index.mjs';

export async function sincronizarComPrazo(dataRoot, { prazoMs = 25000, rodada = sincronizar } = {}) {
  let config;
  try { config = await lerConfigSync(dataRoot); } catch (error) { return `base central: configuração inválida (${String(error.message ?? error).slice(0, 120)})`; }
  if (!config) return null;
  let timer;
  const prazo = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`sem resposta em ${Math.round(prazoMs / 1000)} s`)), prazoMs); });
  try {
    const r = await Promise.race([rodada({ dataRoot }), prazo]);
    const avisos = [];
    if (r.conflitos?.length) avisos.push(`base central: ${r.conflitos.length} arquivo(s) em conflito; valeu a versão do servidor e a local ficou ao lado (.conflito-): ${r.conflitos.join(', ')}`);
    if (r.pendentes?.length) avisos.push(`base central: ${r.pendentes.length} arquivo(s) não sincronizaram nesta rodada: ${r.pendentes.slice(0, 5).map(rel => `${rel} (${r.motivos?.[rel] ?? 'pendente'})`).join(', ')}`);
    if (r.projecao && !r.projecao.refeita) avisos.push(`base central: projeção não refeita (${r.projecao.erro})`);
    return avisos.join('\n') || null;
  } catch (error) {
    if (sincronizacaoOcupada(error)) return null; // o painel já está sincronizando
    return `base central: sincronização falhou (${String(error.message ?? error).slice(0, 160)}); os dados deste computador podem estar desatualizados`;
  } finally { clearTimeout(timer); }
}
