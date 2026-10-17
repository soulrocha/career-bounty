// Leitura mínima do PDF que o Chrome (Skia) gera: páginas, fontes embutidas, imagens e texto extraível.
// Basta para os gates e os testes: objetos soltos (sem object stream), conteúdo em FlateDecode, fontes Type0/Identity-H com ToUnicode.
// Não é um leitor de PDF genérico; o que ele não entende vira texto ausente, e o gate trata isso como "não extraível".
import { inflateSync } from 'node:zlib';

function objetos(buffer) {
  const texto = buffer.toString('latin1');
  const mapa = new Map();
  const re = /(\d+) 0 obj\s*([\s\S]*?)(?:stream\r?\n([\s\S]*?)\r?\nendstream\s*endobj|endobj)/g;
  for (const m of texto.matchAll(re)) {
    let stream = null;
    if (m[3] !== undefined) {
      const bruto = Buffer.from(m[3], 'latin1');
      try { stream = /\/FlateDecode/.test(m[2]) ? inflateSync(bruto) : bruto; } catch { stream = null; }
    }
    mapa.set(Number(m[1]), { dict: m[2], stream });
  }
  return mapa;
}

const ref = (dict, chave) => {
  const m = new RegExp(`/${chave}\\s+(\\d+) 0 R`).exec(dict);
  return m ? Number(m[1]) : null;
};

export function contarPaginas(buffer) {
  return [...objetos(buffer).values()].filter(obj => /\/Type\s*\/Page(?![a-zA-Z])/.test(obj.dict)).length;
}

export function temImagem(buffer) {
  return [...objetos(buffer).values()].some(obj => /\/Subtype\s*\/Image/.test(obj.dict));
}

// Fontes usadas e se cada uma tem o arquivo da fonte embutido (FontFile, FontFile2 ou FontFile3).
export function fontes(buffer) {
  const objs = objetos(buffer);
  const lista = [];
  for (const obj of objs.values()) {
    if (!/\/Type\s*\/FontDescriptor/.test(obj.dict)) continue;
    const nome = /\/FontName\s*\/([^\s/]+)/.exec(obj.dict)?.[1] ?? '?';
    lista.push({ nome, embutida: /\/FontFile[23]?\s+\d+ 0 R/.test(obj.dict) });
  }
  return lista;
}

// CMap ToUnicode: bfchar e bfrange de código (hex) para texto.
function lerCmap(texto) {
  const mapa = new Map();
  const unicode = hex => String.fromCodePoint(...(hex.match(/.{4}/g) ?? []).map(h => parseInt(h, 16)));
  for (const bloco of texto.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, cod, dest] of bloco[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) mapa.set(parseInt(cod, 16), unicode(dest));
  }
  for (const bloco of texto.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, ini, fim, dest] of bloco[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const base = parseInt(dest, 16);
      for (let c = parseInt(ini, 16); c <= parseInt(fim, 16); c++) mapa.set(c, String.fromCodePoint(base + c - parseInt(ini, 16)));
    }
  }
  return mapa;
}

function fontesDaPagina(pagina, objs) {
  const recursos = /\/Font\s*<<([^>]*)>>/.exec(pagina.dict)?.[1] ?? '';
  const mapa = new Map();
  for (const [, nome, num] of recursos.matchAll(/\/([A-Za-z0-9_.-]+)\s+(\d+) 0 R/g)) {
    const fonte = objs.get(Number(num));
    const toUnicode = fonte ? objs.get(ref(fonte.dict, 'ToUnicode')) : null;
    mapa.set(nome, toUnicode?.stream ? lerCmap(toUnicode.stream.toString('latin1')) : null);
  }
  return mapa;
}

function decodificar(hex, cmap) {
  if (!cmap) return '';
  let saida = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) saida += cmap.get(parseInt(hex.slice(i, i + 4), 16)) ?? '';
  return saida;
}

// Texto da página, em ordem de desenho: quebra de linha quando a posição vertical muda (Tm ou Td com deslocamento vertical).
function textoDaPagina(conteudo, cmaps) {
  const linhas = [];
  let atual = '';
  let cmap = null;
  let y = null;
  const quebra = () => { if (atual.trim()) linhas.push(atual.replace(/\s+/g, ' ').trim()); atual = ''; };
  const tokens = /\/([A-Za-z0-9_.-]+)\s+[\d.]+\s+Tf|([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm|([-\d.]+)\s+([-\d.]+)\s+T[dD]|<([0-9a-fA-F]*)>\s*Tj|\[((?:\s*(?:<[0-9a-fA-F]*>|[-\d.]+))*)\s*\]\s*TJ|\bT\*/g;
  for (const m of conteudo.matchAll(tokens)) {
    if (m[1]) cmap = cmaps.get(m[1]) ?? null;
    else if (m[7] !== undefined) { const novo = Number(m[7]); if (y !== null && Math.abs(novo - y) > 0.5) quebra(); y = novo; }
    else if (m[9] !== undefined) { if (Math.abs(Number(m[9])) > 0.5) { quebra(); y = (y ?? 0) + Number(m[9]); } }
    else if (m[10] !== undefined) atual += decodificar(m[10], cmap);
    else if (m[11] !== undefined) {
      for (const parte of m[11].matchAll(/<([0-9a-fA-F]*)>|([-\d.]+)/g)) {
        if (parte[1] !== undefined) atual += decodificar(parte[1], cmap);
        else if (Number(parte[2]) < -200) atual += ' ';
      }
    } else quebra();
  }
  quebra();
  return linhas.join('\n');
}

// Texto extraível do PDF, página a página (separadas por linha em branco). Vazio quando nada é legível.
export function extrairTexto(buffer) {
  const objs = objetos(buffer);
  const paginas = [];
  // A árvore de páginas pode ter nós intermediários (/Pages dentro de /Pages): desce a partir da raiz, sem /Parent.
  const raiz = [...objs.entries()].find(([, obj]) => /\/Type\s*\/Pages/.test(obj.dict) && !/\/Parent\s/.test(obj.dict))?.[0];
  const ordem = [];
  const descer = (num, visitados = new Set()) => {
    const obj = objs.get(num);
    if (!obj || visitados.has(num)) return;
    visitados.add(num);
    if (!/\/Type\s*\/Pages/.test(obj.dict)) { ordem.push(num); return; }
    for (const m of (obj.dict.match(/\/Kids\s*\[([^\]]*)\]/)?.[1] ?? '').matchAll(/(\d+) 0 R/g)) descer(Number(m[1]), visitados);
  };
  if (raiz !== undefined) descer(raiz);
  for (const num of ordem) {
    const pagina = objs.get(num);
    if (!pagina) continue;
    const conteudos = (/\/Contents\s*\[([^\]]*)\]/.exec(pagina.dict)?.[1] ?? /\/Contents\s+(\d+ 0 R)/.exec(pagina.dict)?.[1] ?? '')
      .match(/\d+(?= 0 R)/g) ?? [];
    const cmaps = fontesDaPagina(pagina, objs);
    const conteudo = conteudos.map(c => objs.get(Number(c))?.stream?.toString('latin1') ?? '').join('\n');
    paginas.push(textoDaPagina(conteudo, cmaps));
  }
  return paginas.join('\n\n').trim();
}
