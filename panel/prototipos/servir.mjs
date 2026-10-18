// PROTÓTIPO: servidor estático só para abrir os protótipos do painel. Uso: node panel/prototipos/servir.mjs [porta]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('.', import.meta.url));
const tipos = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8' };
const porta = Number(process.argv[2] ?? 8892);
createServer(async (req, res) => {
  const caminho = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '') || 'index.html';
  if (caminho.startsWith('..')) { res.writeHead(403).end(); return; }
  try { const corpo = await readFile(join(raiz, caminho)); res.writeHead(200, { "Content-Type": tipos[extname(caminho)] ?? "application/octet-stream", "Cache-Control": "no-store" }).end(corpo); }
  catch { res.writeHead(404).end('não encontrado'); }
}).listen(porta, '127.0.0.1', () => console.log(`Protótipos em http://127.0.0.1:${porta}/?variante=A`));
