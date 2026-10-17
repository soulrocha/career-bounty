// Relatório dos quadrantes em Markdown (vai para DATA_ROOT/reports, nunca para o repositório).
import { pontuarCandidatas } from './suggest.mjs';

const ref = x => `\`${x.modelo}\`, linha ${x.linha}`;

export function relatorioQuadrantes({ quadrantes, itens, afirmacoes, dia }) {
  const porLinha = new Map(itens.map(item => [`${item.modelo}:${item.linha}`, item]));
  const { a, b, c, d, contagem } = quadrantes;
  const linhas = [`# Quadrantes dado x currículo (${dia})`, '', 'Relatório privado: não versionar nem copiar para o Vault.', ''];
  linhas.push(`## (a) Dado e CV conferem (${contagem.a})`, '', ...a.map(x => `- ${ref(x)}: ${x.texto} [${x.claim_ids.join(', ')}]`), '');
  linhas.push(`## (b) Dado fora do CV (${contagem.b})`, '', ...b.map(x => (x.tipo === 'afirmacao' ? `- ${x.id} (${x.nivel_prova}): ${x.texto}` : `- arco ${x.id}${x.titulo ? ` (${x.titulo})` : ''}: sem afirmação ligada`)), '');
  linhas.push(`## (c) CV sem dado (${contagem.c})`, '');
  for (const x of c) {
    linhas.push(`- ${ref(x)}: ${x.texto} (${x.codigo}) — ${x.motivo}`);
    if (x.codigo === 'sem_marca') {
      const candidatas = pontuarCandidatas(porLinha.get(`${x.modelo}:${x.linha}`) ?? { numeros: [] }, afirmacoes);
      linhas.push(`  candidatas por número: ${candidatas.length ? candidatas.map(c => `${c.id} (${c.acertos}/${c.total})`).join(', ') : 'nenhuma'}`);
    }
  }
  linhas.push('', `## (d) Lacunas (${contagem.d})`, '');
  for (const x of d) linhas.push(`- [${x.peso}] ${x.descricao}`, `  pergunta: ${x.pergunta_sugerida}`);
  if (quadrantes.avisos.length) linhas.push('', '## Avisos', '', ...quadrantes.avisos.map(aviso => `- ${aviso}`));
  return `${linhas.join('\n')}\n`;
}
