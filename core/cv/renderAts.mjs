// CV para ATS: coluna única, sem imagem, sem tabela, sem posicionamento; texto extraível na ordem das seções.
// Contatos separados por " | " para não colarem na extração de texto (mesmo cuidado do legado).
import { carregarTemplate, esc, gerarPdf, preencher, tituloDaPagina } from './html.mjs';
import { DESTAQUES } from './experiencias.mjs';

export const SECOES_ATS = ['Resumo', 'Experiência', 'Destaques', 'Formação', 'Cursos', 'Competências', 'Idiomas'];

const lista = itens => (itens.length ? `<ul>${itens.map(texto => `<li>${esc(texto)}</li>`).join('')}</ul>` : '');

export async function renderAts(payload) {
  const trabalho = payload.experiencias.filter(exp => exp.id !== DESTAQUES);
  const destaques = payload.experiencias.find(exp => exp.id === DESTAQUES);
  const { nome, contatos = [] } = payload.cabecalho;
  const partes = [
    `<h1>${esc(nome)}</h1><p class="role">${esc(payload.titulo)}</p><p class="contact">${contatos.map(esc).join(' | ')}</p>`,
    `<h2>Resumo</h2><p>${esc(payload.resumo)}</p>`,
  ];
  if (trabalho.length) {
    partes.push(`<h2>Experiência</h2>${trabalho.map(exp => `<h3>${esc(exp.cargo)}</h3><p class="company">${esc(exp.empresa)}</p>`
      + `<p class="dates">${esc(exp.periodo)}</p>${exp.intro ? `<p>${esc(exp.intro)}</p>` : ''}${lista(exp.itens.map(i => i.texto))}`).join('')}`);
  }
  if (destaques) partes.push(`<h2>Destaques</h2>${lista(destaques.itens.map(i => i.texto))}`);
  if (payload.formacao.length) partes.push(`<h2>Formação</h2>${payload.formacao.map(f => `<p><strong>${esc(f.curso)}</strong> | ${esc(f.instituicao)} | ${esc(f.periodo)}</p>`).join('')}`);
  if (payload.cursos.length) partes.push(`<h2>Cursos</h2>${lista(payload.cursos)}`);
  if (payload.competencias.length) partes.push(`<h2>Competências</h2>${payload.competencias.map(c => `<p><strong>${esc(c.grupo)}:</strong> ${esc(c.itens)}</p>`).join('')}`);
  if (payload.idiomas) partes.push(`<h2>Idiomas</h2><p>${esc(payload.idiomas)}</p>`);
  return preencher(await carregarTemplate('cv-ats.html'), { titulo: esc(tituloDaPagina(payload)), conteudo: partes.join('\n') });
}

export async function gerarPdfAts(payload, { navegador } = {}) {
  const html = await renderAts(payload);
  return { html, ...await gerarPdf({ html, tipo: 'ATS', navegador }) };
}
