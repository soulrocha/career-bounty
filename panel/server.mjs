import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { noLinks } from '../core/migration/paths.mjs';
import { isAbsolute, relative, resolve, sep, posix } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const confirmed = new Set(['candidatura-enviada-confirmada', 'candidatura-finalizada-confirmada',
  'candidatura-anterior-identificada-triagem-pendente', 'candidatura-anterior-mesmo-cargo-confirmada-id-a-verificar']);

function marker(job) {
  const mark = job.candidatura_usuario ?? {};
  const email = job.candidatura_email ?? {};
  const portal = job.candidatura_portal ?? {};
  const previous = confirmed.has(job.status) || Boolean(email.aplicada) || Boolean(portal.aplicada);
  return { id: job.id, aplicada: Boolean(mark.aplicada) || previous,
    data: (mark.aplicada ? mark.data : portal.data || email.data) ?? null,
    historico_confirmado: previous, status: job.status ?? null, evidencia_email: email.observacao ?? null,
    etapa_email: email.etapa ?? null, origem: mark.aplicada ? 'usuario-no-painel' : previous ? 'historico' : null,
    historico_anterior: Object.hasOwn(job, 'historico_anterior') ? job.historico_anterior : (Boolean(job.historico) && !mark.aplicada),
    descartada: Boolean(job.descarte_usuario?.descartada) };
}

async function privateFile(root, path) {
  await noLinks(root).catch(() => { throw new Error('Diretório inválido.'); });
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new Error('Arquivo indisponível.');
  let current = root;
  for (const part of rel.split(sep)) {
    current = resolve(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Link indisponível.');
  }
  if (!(await lstat(target)).isFile()) throw new Error('Arquivo indisponível.');
  return readFile(target);
}

export async function startPanel({ dataRoot, host = '127.0.0.1', port = 8880 }) {
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('O painel exige endereço local.');
  dataRoot = resolve(dataRoot);
  await noLinks(dataRoot).catch(() => { throw new Error('Diretório de dados inválido.'); });
  const token = randomBytes(32).toString('hex');
  const state = JSON.parse(await privateFile(dataRoot, 'state/migration.json'));
  if (state.version !== 1 || state.mode !== 'shadow' || !/^backups\/[\w-][\w.-]*$/.test(state.snapshotRoot)) {
    throw new Error('Estado de migração inválido.');
  }
  const allowedBaseFiles = state.allowedBaseFiles ?? [];
  if (!Array.isArray(allowedBaseFiles) || allowedBaseFiles.some(path => typeof path !== 'string'
    || !/\.pdf$/i.test(path) || /[\\%\x00:?#]/.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..'))) {
    throw new Error('Allowlist de PDFs base inválida.');
  }
  const baseFiles = new Set(allowedBaseFiles.map(path => `/curriculos/${path}`));
  const snapshot = resolve(dataRoot, state.snapshotRoot);
  const pagePath = `${state.snapshotRoot}/carreira/busca-vagas/painel-vagas.html`;
  const pipeline = JSON.parse(await privateFile(dataRoot, 'projections/pipeline-vagas.json'));
  const original = JSON.parse(await privateFile(dataRoot, `${state.snapshotRoot}/carreira/pipeline-vagas.json`));
  if (!Array.isArray(pipeline.vagas) || !isDeepStrictEqual(pipeline, original)) throw new Error('Projeção difere do snapshot.');
  const pageSource = (await privateFile(dataRoot, pagePath)).toString('utf8');
  const materials = JSON.parse(await privateFile(dataRoot, `${state.snapshotRoot}/carreira/busca-vagas/curriculos-manifest.json`));
  const namedMaterials = new Set(materials.flatMap(item => ['html', 'pdf_visual', 'pdf_ats']
    .filter(field => typeof item[field] === 'string')
    .map(field => posix.normalize(`/carreira/busca-vagas/${item[field].replaceAll('\\', '/')}`))));
  const reports = new Set(['relatorio-vagas.md', 'busca-browseruse-2026-10-05.md', 'busca-linkedin-ampla-2026-10-05.md']);
  let actualPort;
  const server = createServer(async (req, res) => {
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
      res.writeHead(code, { 'Content-Type': type, 'Content-Length': bytes.length,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
      res.end(bytes);
    };
    try {
      if (![`127.0.0.1:${actualPort}`, `localhost:${actualPort}`].includes(req.headers.host)) return send(403, { erro: 'Host inválido.' });
      if (req.method === 'POST') {
        if (![`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`].includes(req.headers.origin)
          || req.headers['x-painel-token'] !== token || !['/api/candidaturas', '/api/descarte'].includes(req.url)) {
          return send(403, { erro: 'Acesso inválido.' });
        }
        return send(409, { erro: 'Modo sombra: gravação desligada.', gravacao_painel: 'desligada' });
      }
      let path;
      try { path = decodeURIComponent(req.url.split('?')[0]); } catch { return send(404, { erro: 'Arquivo indisponível.' }); }
      if (/[\\%\x00]/.test(path) || path.split('/').some(part => part === '.' || part === '..')) return send(404, { erro: 'Arquivo indisponível.' });
      if (req.method !== 'GET') return send(405, { erro: 'Método indisponível.' });
      if (path === '/api/status') return send(200, { app: 'career-bounty', version: 1, mode: 'shadow' });
      if (path === '/api/candidaturas') {
        if (req.headers['x-painel-token'] !== token) return send(403, { erro: 'Acesso inválido.' });
        return send(200, { vagas: pipeline.vagas.map(marker) });
      }
      if (['/', '/carreira/busca-vagas/painel-vagas.html'].includes(path)) {
        const init = `<script>window.PAINEL_API=${JSON.stringify({ token })};</script>`;
        const page = pageSource.replace('</head>', `<base href="/carreira/busca-vagas/">${init}</head>`)
          .replace(/<body([^>]*)>/i, '<body$1><p role="status">SOMBRA — gravação desligada. Dados importados para consulta.</p>')
          .replaceAll('applicationApiReady=true', 'applicationApiReady=false')
          .replaceAll('Marcações salvas neste computador e consideradas nas próximas buscas.', 'SOMBRA — gravação desligada. Marcações importadas para consulta.')
          .replaceAll('Abra o painel interativo para salvar.', 'SOMBRA — gravação desligada.');
        return send(200, Buffer.from(page), 'text/html; charset=utf-8');
      }
      const name = path.split('/').at(-1);
      const isMaterial = path.startsWith('/curriculos/vagas/') &&
        (['curriculo.html', 'curriculo-visual.pdf', 'curriculo-ats.pdf'].includes(name) || namedMaterials.has(path));
      const isBase = baseFiles.has(path);
      const isReport = path.startsWith('/carreira/busca-vagas/') && reports.has(path.slice('/carreira/busca-vagas/'.length));
      if (isMaterial || isBase || isReport) {
        try {
          const bytes = await privateFile(snapshot, path.slice(1));
          const type = name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
          return send(200, bytes, type);
        } catch { return send(404, { erro: 'Arquivo indisponível.' }); }
      }
      send(404, { erro: 'Não encontrado.' });
    } catch {
      send(500, { erro: 'Não foi possível carregar os dados do painel.' });
    }
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, host, done); });
  actualPort = server.address().port;
  return { server, url: `http://${host}:${actualPort}`, close: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done())) };
}
