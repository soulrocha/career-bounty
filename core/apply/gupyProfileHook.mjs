import { NAVEGADOR } from './hook.mjs';
import { SCRIPT_PERFIL, SCRIPT_RECARREGAR_PERFIL } from './gupyProfile.mjs';

const negar = motivo => ({ decisao: 'negar', motivo });
const permitir = { decisao: 'permitir', motivo: 'Leitura oficial de perfil.' };
const globais = new Set(['tabs_context', 'tabs_context_mcp', 'tabs_create', 'tabs_create_mcp', 'list_connected_browsers']);

// Perfil antecede candidatura: uma permissão mais ampla do outro fluxo nunca libera esta aba.
export function decidirPerfil(entrada, estado) {
  const m = NAVEGADOR.exec(String(entrada?.tool_name ?? ''));
  if (!m) return null;
  if (!estado || !Array.isArray(estado.abas)) return negar('Estado de perfil indisponível.');
  if (!estado.abas.length) return null;
  const input = entrada.tool_input, tool = m[2];
  if (tool === 'browser_batch') {
    if (!Array.isArray(input?.actions) || !input.actions.length || input.actions.length > 20) return negar('Batch de perfil inválido.');
    let consumo = null, tocou = false;
    for (const item of input.actions) {
      if (item?.name === 'browser_batch') return negar('Batch aninhado negado.');
      const r = decidirPerfil({ ...entrada, tool_name: `mcp__${m[1]}__${item?.name}`, tool_input: item?.input }, estado);
      if (r?.decisao === 'negar') return r;
      if (r?.vincular) return negar('Primeiro extrator deve ser chamada individual para vincular sessão.');
      if (r) tocou = true;
      if (r?.consumir) { if (consumo) return negar('Batch permite no máximo uma mudança de perfil.'); consumo = r.consumir; }
    }
    // Quando há consumo, nenhum destino desprotegido pode esconder outra ação no lote.
    if (consumo && input.actions.some(i => !decidirPerfil({ ...entrada, tool_name: `mcp__${m[1]}__${i?.name}`, tool_input: i?.input }, estado))) return negar('Batch mistura perfil com destino não protegido.');
    return consumo ? { ...permitir, consumir: consumo } : tocou ? permitir : null;
  }
  if (globais.has(tool)) return null;
  const tab = input?.tabId ?? input?.tab_id;
  if (tab === undefined || tab === null || tab === '') return negar('Perfil protegido exige aba explícita.');
  const a = estado.abas.find(a => a.tab_id === String(tab));
  if (!a) return null;
  if (!a.session_id) {
    if (tool === 'javascript_tool' && input.text === SCRIPT_PERFIL && typeof entrada.session_id === 'string' && entrada.session_id) return { ...permitir, vincular: { tabId: a.tab_id, sessionId: entrada.session_id, script: input.text, toolUseId: entrada.tool_use_id } };
    return negar('Perfil ainda sem sessão: execute somente extrator oficial em chamada individual.');
  }
  if (!entrada.session_id || a.session_id !== entrada.session_id) return negar('Sessão diferente da aba de perfil.');
  if (tool === 'javascript_tool') {
    if (input.text === SCRIPT_PERFIL) return { ...permitir, vincular: { tabId: a.tab_id, sessionId: entrada.session_id, script: input.text, toolUseId: entrada.tool_use_id } };
    if (input.text === SCRIPT_RECARREGAR_PERFIL) return permitir;
    if (typeof input.text === 'string' && a.itens.some(i => i.script && i.script === input.text)) return { ...permitir, consumir: { tabId: a.tab_id, sessionId: entrada.session_id, script: input.text } };
  }
  if (tool === 'computer' && ['scroll', 'wait'].includes(input?.action)) return permitir;
  return negar('Perfil protegido: só extrator, reload e script exato do item aprovado; escrita livre, teclas, coordenadas, upload e leitura integral negados.');
}
