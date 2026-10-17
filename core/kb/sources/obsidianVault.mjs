// Adaptador obsidian-vault: SOMENTE LEITURA, guiado por manifesto. Lê apenas as notas listadas, pelo frontmatter.
// Não recebe nem expõe método de escrita; o corpo de arco e de nota de outro contexto nunca sai daqui.
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { within } from '../../migration/paths.mjs';
import { montarAfirmacao, comoLista, parseFrontmatter, validateClaim } from '../schema.mjs';

export const PAPEIS = ['afirmacao', 'arco', 'modelo_cv'];
const CONTEXTOS_PADRAO = ['pessoal'];
const LIMITE_BYTES = 512 * 1024;
const BOM = String.fromCharCode(0xfeff);

function caminhoSeguro(caminho) {
  if (typeof caminho !== 'string' || !caminho.trim()) throw new Error('manifesto: caminho de nota ausente');
  if (caminho.includes('\0') || path.isAbsolute(caminho) || /^[A-Za-z]:/.test(caminho) || caminho.startsWith('/') || caminho.startsWith('\\')
    || caminho.split(/[\\/]/).some(parte => parte === '..')) throw new Error(`manifesto: caminho "${caminho}" recusado (use caminho relativo à raiz, sem "..")`);
  return caminho.replaceAll('\\', '/');
}

// Nenhum trecho do caminho abaixo da raiz pode ser link simbólico ou junction.
async function semLinks(raiz, alvo) {
  let atual = raiz;
  for (const parte of path.relative(raiz, alvo).split(path.sep)) {
    atual = path.join(atual, parte);
    try { if ((await lstat(atual)).isSymbolicLink()) return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  }
  return true;
}

export function createObsidianVault({ raiz, manifesto, lerArquivo = arquivo => readFile(arquivo, 'utf8') }) {
  if (typeof raiz !== 'string' || !path.isAbsolute(raiz)) throw new Error('raiz do vault deve ser caminho absoluto');
  const notas = (manifesto?.notas ?? []).map(nota => {
    if (!PAPEIS.includes(nota?.papel)) throw new Error(`manifesto: papel inválido "${nota?.papel}" (use ${PAPEIS.join(', ')})`);
    return { caminho: caminhoSeguro(nota.caminho), papel: nota.papel, modelo: nota.modelo ?? null };
  });
  const contextos = new Set(Array.isArray(manifesto?.contextos_permitidos) ? manifesto.contextos_permitidos : CONTEXTOS_PADRAO);
  const avisos = [];

  // Lê uma nota do manifesto. Devolve null (com aviso) se não existe, é grande, é link ou é de contexto não permitido.
  async function ler(nota, { exigeFrontmatter }) {
    const arquivo = path.join(raiz, ...nota.caminho.split('/'));
    if (!within(arquivo, raiz) || !(await semLinks(raiz, arquivo))) { avisos.push(`${nota.caminho}: caminho fora da raiz ou com link; nota ignorada.`); return null; }
    let texto;
    try {
      const info = await lstat(arquivo);
      if (info.size > LIMITE_BYTES) { avisos.push(`${nota.caminho}: nota maior que ${LIMITE_BYTES / 1024} KB; ignorada.`); return null; }
      texto = await lerArquivo(arquivo);
    } catch (error) {
      if (error.code === 'ENOENT') { avisos.push(`${nota.caminho}: nota não encontrada.`); return null; }
      throw error;
    }
    if (texto.startsWith(BOM)) texto = texto.slice(1);
    const lido = parseFrontmatter(texto);
    const temFrontmatter = Object.keys(lido.data).length > 0;
    if (exigeFrontmatter && !temFrontmatter) { avisos.push(`${nota.caminho}: sem frontmatter; nota ignorada.`); return null; }
    const contexto = lido.data.contexto;
    if (contexto && !contextos.has(contexto)) { avisos.push(`${nota.caminho}: contexto "${contexto}" não permitido pelo manifesto; nota ignorada.`); return null; }
    return { ...lido, texto, temFrontmatter };
  }

  return {
    async claims() {
      const out = [];
      for (const nota of notas.filter(n => n.papel === 'afirmacao')) {
        const lido = await ler(nota, { exigeFrontmatter: true });
        if (!lido) continue;
        validateClaim(lido, nota.caminho);
        out.push(montarAfirmacao(lido, nota.caminho));
      }
      return out;
    },
    // Arco: só id, título e ligações. O corpo fica no vault.
    async arcs() {
      const out = [];
      for (const nota of notas.filter(n => n.papel === 'arco')) {
        const lido = await ler(nota, { exigeFrontmatter: true });
        if (!lido) continue;
        out.push({ id: lido.data.id ?? path.posix.basename(nota.caminho, path.posix.extname(nota.caminho)), titulo: /^#\s+(.+)$/m.exec(lido.body)?.[1].trim() ?? null,
          afirmacoes: comoLista(lido.data.afirmacoes), nivel_prova: lido.data.nivel_prova ?? null, contexto: lido.data.contexto ?? null, arquivo: nota.caminho });
      }
      return out;
    },
    async cvTemplates() {
      const out = [];
      for (const nota of notas.filter(n => n.papel === 'modelo_cv')) {
        const lido = await ler(nota, { exigeFrontmatter: false });
        if (!lido) continue;
        const ext = path.posix.extname(nota.caminho);
        out.push({ modelo: nota.modelo ?? path.posix.basename(nota.caminho, ext), formato: ext.slice(1) || 'txt', texto: lido.temFrontmatter ? lido.body : lido.texto, arquivo: nota.caminho });
      }
      return out;
    },
    identity: async () => null,
    avisos: () => [...avisos],
  };
}
