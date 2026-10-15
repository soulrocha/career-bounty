// Render determinístico do painel, do relatório em Markdown e dos adaptadores a partir da projeção.
// Mesma projeção + mesmo template + mesmo perfil = mesmos bytes.
import { roleKey } from '../core/dedup/keys.mjs';
import { urlsplit } from '../core/dedup/pyurl.mjs';
import { resolveTemplate } from './template.mjs';

const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// JSON para dentro de <script>: `<` vira < (nada fecha a tag) e os separadores de linha do JS são escapados.
export function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replaceAll(String.fromCharCode(0x2028), '\\u2028').replaceAll(String.fromCharCode(0x2029), '\\u2029');
}

const aplicada = campo => Boolean(campo && typeof campo === 'object' && campo.aplicada);
const emHistorico = vaga => vaga.historico === true || vaga.historico_anterior === true || aplicada(vaga.candidatura_email) || aplicada(vaga.candidatura_portal) || aplicada(vaga.candidatura_usuario);
const descartada = vaga => Boolean(vaga.descarte_usuario?.descartada);

// Vaga ativa: ainda vale considerar. Fora ficam descartada, encerrada, incompatível e o que já é histórico de candidatura.
export const ativa = vaga => !descartada(vaga) && vaga.url_status !== 'encerrada' && vaga.aderencia !== 'incompativel' && !emHistorico(vaga);

export function montarDados(projecao, { perfil = {}, cobertura = [], fila = 0 } = {}) {
  const vagas = projecao.vagas ?? [];
  return { vagas, historico: vagas.filter(emHistorico), coverage: cobertura, queue: fila, perfil };
}

export function renderPainel(projecao, { template, perfil = {}, cobertura = [], fila = 0, hoje } = {}) {
  if (typeof template !== 'string' || !template.includes('__DATA__')) throw new Error('Template do painel inválido: falta o marcador __DATA__.');
  const payload = scriptJson(montarDados(projecao, { perfil, cobertura, fila }));
  const stamp = escapeHtml(hoje ?? projecao.atualizado ?? '');
  // Uma passada só: o selo e o dado entram nos marcadores do TEMPLATE; um `__DATA__` vindo do conteúdo nunca é reprocessado.
  const marcadores = ['__STAMP__', '__DATA__'].map(nome => [nome, template.indexOf(nome)]).filter(([, indice]) => indice >= 0).sort((a, b) => a[1] - b[1]);
  let saida = '';
  let cursor = 0;
  for (const [nome, indice] of marcadores) {
    saida += template.slice(cursor, indice) + (nome === '__DATA__' ? payload : stamp);
    cursor = indice + nome.length;
  }
  return saida + template.slice(cursor);
}

export async function renderPainelDe(projecao, { dataRoot, ...opcoes } = {}) {
  const { html } = await resolveTemplate({ dataRoot });
  return renderPainel(projecao, { template: html, ...opcoes });
}

const LABELS = { alta: 'Alta aderência', boa: 'Boa aderência', condicional: 'Condicional', incompativel: 'Incompatível' };
const dinheiro = valor => valor === null || valor === undefined ? 'Não divulgado' : typeof valor === 'number' ? `R$ ${valor.toLocaleString('pt-BR')}` : String(valor);
const celula = valor => String(valor ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

export function relatorioMarkdown(projecao, { hoje } = {}) {
  const dia = hoje ?? projecao.atualizado ?? '';
  const vagas = (projecao.vagas ?? []).filter(ativa);
  const linhas = [`# Radar de vagas — ${dia}`, '', `${vagas.length} vagas ativas. Aderência e condições financeiras são avaliadas separadamente.`, ''];
  if (!vagas.length) linhas.push('Nenhuma vaga ativa nesta rodada.', '');
  for (const vaga of vagas) {
    linhas.push(`### ${celula(vaga.empresa)} — ${celula(vaga.cargo)}`, '',
      `- **Aderência:** ${LABELS[vaga.aderencia] ?? vaga.aderencia ?? 'Pendente'}.`,
      `- **Condições:** ${celula(vaga.modalidade) || 'Pendente'} · ${celula(vaga.local) || 'Pendente'} · ${celula(vaga.regime) || 'Pendente'} · ${dinheiro(vaga.salario)}.`,
      `- **Estado:** ${celula(vaga.url_status)} · ${celula(vaga.status)}.`);
    const motivos = (vaga.motivos ?? []).map(celula).filter(Boolean);
    if (motivos.length) linhas.push(`- **Por que faz sentido:** ${motivos.join('; ')}.`);
    if (/^https?:\/\//.test(vaga.url ?? '')) linhas.push(`- [Abrir vaga](${String(vaga.url).replace(/[()\s]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)})`);
    linhas.push('');
  }
  return `${linhas.join('\n')}\n`;
}

const frontmatter = dia => `---\ntipo: nota\nstatus: ativo\ndata: ${dia}\ntags: [carreira]\n---\n\n`;

// Adaptadores derivados só do pipeline (sem perfil nem identidade): lista de vagas vistas, tabela, histórico de varredura e portais.
export function adaptadores(projecao, { hoje } = {}) {
  const dia = hoje ?? projecao.atualizado ?? '';
  const vagas = projecao.vagas ?? [];
  const vistas = Object.fromEntries(vagas.map(vaga => [roleKey(vaga), { url: vaga.url ?? null, company: vaga.empresa ?? null, title: vaga.cargo ?? null, status: vaga.status ?? null }]));
  const tabela = ['| Empresa | Vaga | Estado | Link |', '|---|---|---|---|', ...vagas.map(v => `| ${celula(v.empresa)} | ${celula(v.cargo)} | ${celula(v.status)} | ${celula(v.url)} |`)];
  const cell = valor => String(valor ?? '').replace(/[\t\r\n]+/g, ' ');
  const historico = ['url\tcompany\ttitle', ...vagas.map(v => [v.url, v.empresa, v.cargo].map(cell).join('\t'))].join('\n');
  const portais = [];
  for (const vaga of vagas) {
    let partes;
    try { partes = urlsplit(vaga.url ?? ''); } catch { continue; }
    const host = partes.netloc.toLowerCase();
    const provider = host.includes('lever.co') ? 'lever' : host.includes('greenhouse.io') ? 'greenhouse' : host.includes('ashbyhq.com') ? 'ashby' : null;
    const slug = partes.path.replace(/^\/+|\/+$/g, '').split('/')[0];
    if (provider && slug && !portais.some(p => p.provider === provider && p.slug === slug)) portais.push({ name: vaga.empresa ?? null, provider, slug, careers_url: `https://${host}/${slug}`, enabled: true });
  }
  return {
    'seen_jobs.json': `${JSON.stringify(vistas, null, 2)}\n`,
    'job_search.md': `${frontmatter(dia)}# Projeção do pipeline único\n\n${tabela.join('\n')}\n`,
    'scan-history.tsv': `${historico}\n`,
    'portals.json': `${JSON.stringify({ tracked_companies: portais }, null, 2)}\n`,
  };
}

