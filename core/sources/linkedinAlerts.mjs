// Alertas de vaga do LinkedIn (e da Gupy) lidos do e-mail: descoberta sem tocar no site, zero requisição de rede.
// Os itens vêm do leitor de e-mail (contrato MailDigest, classe "alerta"); aqui só viram aparições.
import { SourceError } from './index.mjs';
import { diaDe } from './common.mjs';
import { fold } from '../dedup/keys.mjs';

const REMETENTES = { linkedin: /(^|\.)linkedin\.com$/i, gupy: /(^|\.)gupy\.(io|com\.br)$/i };

function limpaUrl(valor) {
  try { const url = new URL(valor); return `${url.origin}${url.pathname}`; } catch { return null; }
}

export function createLinkedinAlertas(config = {}, deps = {}) {
  return {
    id: 'linkedin_alertas',
    async collect(ctx) {
      if (typeof deps.lerAlertas !== 'function') throw new SourceError('indisponivel', 'leitor de e-mail não disponível nesta execução');
      const termos = (config.termos?.length ? config.termos : ctx.plano?.termos ?? []).map(fold);
      const vistas = new Set(ctx.mensagensVistas ?? []);
      const avisos = [];
      const faseB = [];
      const porUrl = new Map();
      for (const item of await deps.lerAlertas({ janela: ctx.janela })) {
        if (!item || item.classe !== 'alerta' || !item.message_id || vistas.has(item.message_id)) continue;
        vistas.add(item.message_id);
        const origem = item.alerta?.origem ?? 'linkedin';
        if (!REMETENTES[origem]?.test(String(item.remetente_dominio ?? ''))) { avisos.push(`remetente não confere com o portal (${item.message_id})`); continue; }
        const termo = fold(item.alerta?.termo);
        if (termos.length && !termos.some(t => termo.includes(t) || t.includes(termo))) { avisos.push(`alerta de termo fora da configuração ignorado: ${item.alerta?.termo ?? '?'}`); continue; }
        if (!Array.isArray(item.alerta?.vagas)) { faseB.push(item.message_id); avisos.push(`alerta ${item.message_id} só tem as vagas na mensagem inteira: usar a fase B`); continue; }
        for (const vaga of item.alerta.vagas) {
          const url = limpaUrl(vaga?.url);
          if (!url || !vaga.titulo || !vaga.empresa) continue;
          const id = /\/jobs\/view\/(?:[^/]*-)?(\d{6,})/.exec(url)?.[1] ?? null;
          if (!porUrl.has(url)) porUrl.set(url, { portal: origem, requisicao_id: id, empresa: vaga.empresa, cargo: vaga.titulo, local: vaga.local ?? null, url, publicado_em: diaDe(item.data), descricao: '', aparicao: true });
        }
      }
      const out = [...porUrl.values()];
      out.avisos = avisos;
      out.fase_b = faseB;
      return out;
    },
  };
}
