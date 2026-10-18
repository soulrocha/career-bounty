// CV visual (porta do render_cv.cjs legado): cabeçalho com foto, os 4 cards de impacto, resumo, experiências e seções fixas.
// Mesmo payload, mesmo HTML: nada de data, hora ou ordem que dependa de execução.
import { carregarTemplate, esc, gerarPdf, preencher, tituloDaPagina } from './html.mjs';
import { DESTAQUES } from './experiencias.mjs';

const iniciais = nome => String(nome).split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();

function cabecalho(payload, fotoDataUri) {
  const { nome, contatos = [] } = payload.cabecalho;
  const foto = fotoDataUri
    ? `<img class="portrait" src="${esc(fotoDataUri)}" alt="Foto de ${esc(nome)}">`
    : `<div class="portrait" role="img" aria-label="Sem foto">${esc(iniciais(nome))}</div>`;
  return `<header class="hero">${foto}<div class="identity"><h1>${esc(nome)}</h1><p class="role">${esc(payload.titulo)}</p>`
    + `<p class="contact">${contatos.map(c => `<span>${esc(c)}</span>`).join('')}</p></div></header>`;
}

const cards = lista => `<div class="impact">${lista.map(card => `<div class="stat"><strong>${esc(card.valor)}</strong><span>${esc(card.rotulo)}</span></div>`).join('')}</div>`;

function experiencia(exp) {
  const itens = exp.itens.length ? `<ul>${exp.itens.map(item => `<li>${esc(item.texto)}</li>`).join('')}</ul>` : '';
  if (exp.id === DESTAQUES) return itens;
  return `<article class="job"><div class="job-head"><div><h3>${esc(exp.cargo)}</h3><p class="company">${esc(exp.empresa)}</p></div>`
    + `<p class="dates">${esc(exp.periodo)}</p></div>${exp.intro ? `<p class="intro">${esc(exp.intro)}</p>` : ''}${itens}</article>`;
}

function secoesFixas(payload) {
  const partes = [];
  if (payload.formacao.length) {
    partes.push(`<h2>Formação</h2>${payload.formacao.map(f => `<div class="compact"><h3>${esc(f.curso)}</h3><p class="institution">${esc(f.instituicao)} · ${esc(f.periodo)}</p></div>`).join('')}`);
  }
  if (payload.cursos.length) partes.push(`<h2>Cursos</h2><ul class="course-list">${payload.cursos.map(c => `<li>${esc(c)}</li>`).join('')}</ul>`);
  if (payload.competencias.length) {
    partes.push(`<h2>Competências</h2><div class="skill-list">${payload.competencias.map(c => `<p><strong>${esc(c.grupo)}:</strong> ${esc(c.itens)}</p>`).join('')}</div>`);
  }
  if (payload.idiomas) partes.push(`<h2>Idiomas</h2><p class="languages">${esc(payload.idiomas)}</p>`);
  return partes.join('');
}

export async function renderVisual(payload, { fotoDataUri = null } = {}) {
  const trabalho = payload.experiencias.filter(exp => exp.id !== DESTAQUES);
  const destaques = payload.experiencias.find(exp => exp.id === DESTAQUES);
  const conteudo = [
    cabecalho(payload, fotoDataUri),
    cards(payload.cards),
    `<h2>Resumo</h2><p class="summary">${esc(payload.resumo)}</p>`,
    trabalho.length ? `<h2>Experiência</h2>${trabalho.map(experiencia).join('')}` : '',
    destaques ? `<h2>Destaques</h2>${experiencia(destaques)}` : '',
    secoesFixas(payload),
  ].join('\n');
  return preencher(await carregarTemplate('cv-visual.html'), { titulo: esc(tituloDaPagina(payload)), conteudo });
}

export async function gerarPdfVisual(payload, { fotoDataUri = null, navegador } = {}) {
  const html = await renderVisual(payload, { fotoDataUri });
  return { html, ...await gerarPdf({ html, tipo: 'visual', navegador }) };
}
