// Destino da vaga alta ou média (F2.20): fila, limite diário e registro. A navegação em si é interativa (Chrome logado,
// skill resolver-destino); a rotina diária só enfileira. Nada aqui abre o navegador.
import { createBudget } from './budget.mjs';
import { portalDaUrl } from './common.mjs';
import { appendEvents } from '../store/events.mjs';
import { localDay } from '../store/schema.mjs';

export const LIMITE_DESTINOS_DIA = 15;

// Extrator curto para rodar no Chrome com javascript_tool: devolve só o necessário, nunca a página.
export const EXTRATOR_JS = `(()=>{const a=document.querySelector('a[data-tracking-control-name*="apply-link-offsite"],a.apply-button,a[href][class*="apply"]');
return JSON.stringify({href:a?a.href:null,texto:a?(a.textContent||'').trim().slice(0,60):null,
login:!!document.querySelector('input[type=password]'),captcha:!!document.querySelector('[id*=captcha i],[class*=captcha i]')})})()`;

const aplicada = vaga => Boolean(vaga.candidatura_usuario?.aplicada || vaga.candidatura_email?.aplicada || vaga.candidatura_portal?.aplicada || vaga.historico);

export function montarFila(projecao, { hoje }) {
  return projecao.filter(vaga => ['alta', 'media'].includes(vaga.aderencia) && vaga.destino_pendente === true && !vaga.application_url
    && !aplicada(vaga) && !vaga.descarte_usuario?.descartada && vaga.destino_bloqueado_em !== hoje);
}

// Reserva até `quantidade` destinos no orçamento do dia (15). Persistente; zera na virada do dia local.
export async function reservarDestinos({ dataRoot, quantidade, now = new Date() }) {
  const budget = createBudget({ dataRoot, nome: 'destino', limite: LIMITE_DESTINOS_DIA, now });
  let concedidas = 0;
  for (let i = 0; i < quantidade; i++) { if (await budget.consume()) concedidas += 1; else break; }
  return { concedidas, limite: LIMITE_DESTINOS_DIA };
}

const href = html => {
  const alvo = /<a\b[^>]*(?:apply-link-offsite|apply-button)[^>]*>/i.exec(html)?.[0];
  const valor = alvo && /href="([^"]+)"/i.exec(alvo)?.[1];
  return valor ? valor.replace(/&amp;/g, '&') : null;
};

// Versão em Node do extrator, usada nos testes com páginas sintéticas.
export function parseDestino(html) {
  if (/captcha/i.test(html)) return { bloqueada: 'humano', motivo: 'captcha' };
  if (/type=["']password["']/i.test(html)) return { bloqueada: 'humano', motivo: 'login' };
  const destino = href(html);
  if (!destino) return { sem_destino: true };
  let url;
  try { url = new URL(destino); } catch { return { sem_destino: true }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { sem_destino: true };
  const limpa = `${url.origin}${url.pathname}`;
  return { application_url: limpa, portal: portalDaUrl(limpa) };
}

export async function registrarDestino(dataRoot, { vagaId, applicationUrl }, now = new Date()) {
  const ts = now.toISOString();
  return appendEvents(dataRoot, [{ id: `destino:${vagaId}:${applicationUrl.length}:${applicationUrl.slice(-24)}`, ts, ator: 'radar', tipo: 'vaga.destino_resolvido', entidade: 'vaga', entidade_id: vagaId, dados: { application_url: applicationUrl } }], { now: ts });
}

export async function registrarBloqueio(dataRoot, { vagaId, motivo }, now = new Date()) {
  const ts = now.toISOString();
  return appendEvents(dataRoot, [{ id: `destino-bloqueado:${vagaId}:${localDay(ts)}`, ts, ator: 'radar', tipo: 'vaga.destino_bloqueado', entidade: 'vaga', entidade_id: vagaId, dados: { motivo, dia: localDay(ts) } }], { now: ts });
}
