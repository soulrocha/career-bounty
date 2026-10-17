// F4.12: as mudanças que a base pediria no Vault, escritas como PROPOSTA em DATA_ROOT/outbox/vault/proposta-f4.md.
// Este módulo só monta texto. Não existe caminho de escrita no Vault, nem "aplicar": a pessoa faz cada item à mão.
import { pontuarCandidatas } from './suggest.mjs';

export const NOME_PROPOSTA = 'proposta-f4.md';

export function montarPropostaVault({ arcos, itens, afirmacoes }) {
  const L = [];
  L.push('# Proposta de mudanças no Vault (F4.12)', '',
    'Gerada pelo comando `vault plan`. Nenhum arquivo do Vault foi alterado e o comando não tem modo de aplicar: cada item abaixo é feito à mão, por você, depois de revisar o diff no git do Vault. Este arquivo é privado.', '');

  L.push('## 1. Nota fontes-do-agente.md (dispensada)', '',
    'O mapa papel -> caminho vive agora no `fontes.yml` do DATA_ROOT, lido em somente leitura pelo adaptador. Nada a criar no Vault e nenhuma linha no `_Index.md`.', '');

  const doVault = arcos.filter(arco => arco.fonte_base === 'obsidian-vault');
  const soltos = doVault.filter(arco => (arco.afirmacoes ?? []).length === 0);
  L.push('## 2. Campo opcional `afirmacoes` nos arcos', '');
  if (!doVault.length) L.push('Nenhum arco do Vault configurado em `fontes.yml` (papel `arco`); nada a propor.', '');
  else {
    L.push('Acrescente ao frontmatter de cada arco abaixo a lista das afirmações que o sustentam, por exemplo:', '', '    afirmacoes: [AF-001, AF-002]', '',
      'Inclua também `afirmacoes` na lista de campos opcionais do `AGENTS.md` do Vault. Arcos que ainda não têm o campo:', '');
    if (soltos.length) L.push(...soltos.map(arco => `- ${arco.arquivo ?? arco.id}${arco.titulo ? ` (${arco.titulo})` : ''}`));
    else L.push('- todos os arcos configurados já têm o campo.');
    L.push('');
  }

  const modelos = [...new Set(itens.map(item => item.modelo))];
  L.push('## 3. Marcas `<!-- claim:ID -->` nos modelos de CV', '',
    'Cole a marca no fim do bullet; ela é um comentário e não aparece no PDF nem no HTML. As candidatas abaixo vêm só da coincidência de números (dica, não decisão); `kb suggest` propõe o resto.', '');
  if (!modelos.length) L.push('Nenhum modelo de CV carregado; nada a propor.', '');
  for (const modelo of modelos) {
    const deste = itens.filter(item => item.modelo === modelo);
    const semMarca = deste.filter(item => item.sem_marca);
    L.push(`### Modelo ${modelo}: ${deste.length - semMarca.length} bullet(s) com marca, ${semMarca.length} sem marca`, '');
    for (const item of semMarca) {
      const candidatas = pontuarCandidatas(item, afirmacoes);
      L.push(`- ${modelo}, linha ${item.linha}: ${item.texto}`, `  candidatas por número: ${candidatas.length ? candidatas.map(c => `${c.id} (${c.acertos}/${c.total})`).join(', ') : 'nenhuma'}`);
    }
    L.push('');
  }

  L.push('## 4. Esvaziar busca-vagas/ (adiado)', '',
    'Depende da F2.22 (corte definitivo do legado). Quando o painel e o radar novos estiverem rodando sem os scripts antigos: scripts e JSON vão para o repositório e o DATA_ROOT, relatórios datados vão para a pasta de arquivo com a sua confirmação, `operacao.md` é reescrito e o `Iniciar painel.cmd` do Vault é arquivado (o atalho novo já mora no DATA_ROOT). Faça um backup do estado atual antes. Nada disso foi feito.', '');
  L.push('## 5. curriculos/ só com modelos/ (adiado)', '',
    'Fica para depois da F5: os PDFs por vaga passam a nascer em `DATA_ROOT/artifacts/cv/`. Até lá, não mova nem apague nada em `curriculos/`.', '');
  return `${L.join('\n')}\n`;
}
