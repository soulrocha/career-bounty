import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { noLinks } from '../core/migration/paths.mjs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { publicMarker } from '../core/store/rules.mjs';
import { marcarCandidatura } from '../core/store/commands/marcarCandidatura.mjs';
import { descartar } from '../core/store/commands/descartar.mjs';
import { readEvents } from '../core/store/events.mjs';
import { projectEvents } from '../core/store/project.mjs';
import { renderPainelDe } from './render.mjs';
import { ABA_QUADRANTES, respostaQuadrantes } from './quadrantes.mjs';
import { ABA_PERGUNTAS, listarPerguntas } from './perguntas.mjs';
import { injetarAbas } from './abas.mjs';
import { responderPergunta } from '../core/apply/perguntas.mjs';
import { createMaterials, namedMaterialsOf, privateFile, validateBaseFiles } from './materials.mjs';
import { arquivosServiveis, congelarCvEnviado, lerManifesto } from '../core/cv/artifacts.mjs';

const ABAS = [ABA_QUADRANTES, ABA_PERGUNTAS];

// Painel sem recurso externo: nada carrega nem envia dado para fora de 127.0.0.1. Script e estilo inline vêm do template local.
const CSP = ["default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'", "img-src 'self' data:", "font-src 'self' data:", "connect-src 'self'", "base-uri 'self'", "form-action 'none'", "frame-ancestors 'none'", "object-src 'none'"].join('; ');

export async function startPanel({ dataRoot, host = '127.0.0.1', port = 8880, appName = 'career-bounty', now, hostId, perfil = {} }) {
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('O painel exige endereço local.');
  dataRoot = resolve(dataRoot);
  await noLinks(dataRoot).catch(() => { throw new Error('Diretório de dados inválido.'); });
  const token = randomBytes(32).toString('hex');
  const state = JSON.parse(await privateFile(dataRoot, 'state/migration.json'));
  const hasSnapshot = state.snapshotRoot !== null;
  if (state.version !== 1 || !['shadow', 'ativo'].includes(state.mode) || (hasSnapshot && !/^backups\/[\w-][\w.-]*$/.test(state.snapshotRoot))) {
    throw new Error('Estado de migração inválido.');
  }
  const allowedBaseFiles = validateBaseFiles(state.allowedBaseFiles ?? []);
  const snapshot = hasSnapshot ? resolve(dataRoot, state.snapshotRoot) : null;
  const pipeline = JSON.parse(await privateFile(dataRoot, 'projections/pipeline-vagas.json'));
  if (!Array.isArray(pipeline.vagas)) throw new Error('Projeção inválida.');
  let pageSource = null; // sem snapshot, a página é gerada da projeção a cada pedido
  let namedMaterials = new Set();
  if (hasSnapshot) {
    const original = JSON.parse(await privateFile(dataRoot, `${state.snapshotRoot}/carreira/pipeline-vagas.json`));
    if (state.mode === 'shadow' && !isDeepStrictEqual(pipeline, original)) throw new Error('Projeção difere do snapshot.');
    pageSource = (await privateFile(dataRoot, `${state.snapshotRoot}/carreira/busca-vagas/painel-vagas.html`)).toString('utf8');
    const materials = JSON.parse(await privateFile(dataRoot, `${state.snapshotRoot}/carreira/busca-vagas/curriculos-manifest.json`));
    namedMaterials = namedMaterialsOf(materials);
  }
  const materialsPolicy = createMaterials({ snapshot, namedMaterials, baseFiles: allowedBaseFiles });
  const writable = state.mode === 'ativo';
  let actualPort;
  const server = createServer(async (req, res) => {
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
      res.writeHead(code, { 'Content-Type': type, 'Content-Length': bytes.length,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP });
      res.end(bytes);
    };
    try {
      if (![`127.0.0.1:${actualPort}`, `localhost:${actualPort}`].includes(req.headers.host)) return send(403, { erro: 'Host inválido.' });
      if (req.method === 'POST') {
        if (![`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`].includes(req.headers.origin)
          || req.headers['x-painel-token'] !== token || !['/api/candidaturas', '/api/descarte', '/api/perguntas'].includes(req.url)) {
          return send(403, { erro: 'Acesso inválido.' });
        }
        // Resposta de pergunta grava no answer bank e em evento fora da projeção legada: vale também no modo sombra.
        if (req.url === '/api/perguntas') {
          if ((req.headers['content-type'] ?? '').split(';')[0] !== 'application/json') return send(415, { erro: 'Formato inválido.' });
          const tamanho = Number(req.headers['content-length'] ?? 0);
          if (!(tamanho > 0 && tamanho <= 8192)) return send(413, { erro: 'Pedido inválido.' });
          const partes = [];
          for await (const parte of req) partes.push(parte);
          let corpo;
          try { corpo = JSON.parse(Buffer.concat(partes).toString('utf8')); } catch { return send(400, { erro: 'Pedido malformado.' }); }
          if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo) || Object.keys(corpo).some(k => !['id', 'resposta', 'escopo'].includes(k)) || typeof corpo.id !== 'string') return send(400, { erro: 'Campos inválidos.' });
          try {
            return send(200, await responderPergunta({ dataRoot, perguntaId: corpo.id, resposta: corpo.resposta, escopo: corpo.escopo, ts: now?.() ?? new Date().toISOString() }));
          } catch (error) {
            if (error.code === 'nao_encontrado') return send(404, { erro: error.message });
            return send(400, { erro: String(error.message).slice(0, 200) });
          }
        }
        if (!writable) return send(409, { erro: 'Modo sombra: gravação desligada.', gravacao_painel: 'desligada' });
        if ((req.headers['content-type'] ?? '').split(';')[0] !== 'application/json') return send(415, { erro: 'Formato inválido.' });
        const size = Number(req.headers['content-length'] ?? 0);
        if (!(size > 0 && size <= 4096)) return send(413, { erro: 'Pedido inválido.' });
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { erro: 'Pedido malformado.' }); }
        const route = req.url;
        const fields = route === '/api/candidaturas' ? ['id', 'aplicada', 'data'] : ['id', 'descartada'];
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) return send(400, { erro: 'Campos inválidos.' });
        try {
          const options = { dataRoot, now: now?.(), host: hostId };
          const result = route === '/api/candidaturas'
            ? await marcarCandidatura({ ...options, id: body.id, aplicada: body.aplicada, data: body.data })
            : await descartar({ ...options, id: body.id, descartada: body.descartada });
          // Candidatura marcada: o CV aprovado da vaga vira o enviado e fica imutável (F5.7).
          // A marcação já foi gravada: falha ao congelar não pode virar erro da candidatura, só aviso.
          if (route === '/api/candidaturas' && body.aplicada === true) {
            try { await congelarCvEnviado(dataRoot, { vagaId: body.id, ts: now?.() ?? new Date().toISOString() }); }
            catch { return send(200, { ...result, aviso_cv: 'Candidatura salva, mas o CV não foi congelado; rode "cv gate" e tente de novo.' }); }
          }
          return send(200, result);
        } catch (error) {
          if (error.code === 'nao_encontrado') return send(404, { erro: 'Vaga não encontrada.' });
          if (error.code === 'invalido') return send(400, { erro: error.message });
          if (error.code === 'ocupado') return send(409, { erro: error.message });
          throw error;
        }
      }
      let path;
      try { path = decodeURIComponent(req.url.split('?')[0]); } catch { return send(404, { erro: 'Arquivo indisponível.' }); }
      if (/[\\%\x00]/.test(path) || path.split('/').some(part => part === '.' || part === '..')) return send(404, { erro: 'Arquivo indisponível.' });
      if (req.method !== 'GET') return send(405, { erro: 'Método indisponível.' });
      if (path === '/api/status') return send(200, { app: appName, version: 1, mode: state.mode });
      if (path === '/api/candidaturas') {
        if (req.headers['x-painel-token'] !== token) return send(403, { erro: 'Acesso inválido.' });
        const vagas = writable ? projectEvents((await readEvents(dataRoot)).eventos).vagas : pipeline.vagas;
        return send(200, { vagas: vagas.map(publicMarker) });
      }
      if (path === '/api/perguntas') {
        if (req.headers['x-painel-token'] !== token) return send(403, { erro: 'Acesso inválido.' });
        return send(200, await listarPerguntas({ dataRoot }));
      }
      if (path === '/api/quadrantes') {
        if (req.headers['x-painel-token'] !== token) return send(403, { erro: 'Acesso inválido.' });
        const { status, corpo } = await respostaQuadrantes({ dataRoot });
        return send(status, corpo);
      }
      if (['/', '/carreira/busca-vagas/painel-vagas.html'].includes(path)) {
        const init = `<script>window.PAINEL_API=${JSON.stringify({ token })};</script>`;
        const source = pageSource ?? await renderPainelDe(writable ? projectEvents((await readEvents(dataRoot)).eventos) : pipeline, { dataRoot, perfil });
        const withInit = source.replace('</head>', `${pageSource ? "<base href=\"/carreira/busca-vagas/\">" : ""}${init}</head>`);
        const page = writable ? withInit : withInit
          .replace(/<body([^>]*)>/i, '<body$1><p role="status">SOMBRA — gravação desligada. Dados importados para consulta.</p>')
          .replaceAll('applicationApiReady=true', 'applicationApiReady=false')
          .replaceAll('Marcações salvas neste computador e consideradas nas próximas buscas.', 'SOMBRA — gravação desligada. Marcações importadas para consulta.')
          .replaceAll('Abra o painel interativo para salvar.', 'SOMBRA — gravação desligada.');
        return send(200, Buffer.from(injetarAbas(page, ABAS)), 'text/html; charset=utf-8');
      }
      // PDFs de CV (F5.8): só os listados no manifesto da vaga, lidos sem seguir link e sem sair do DATA_ROOT.
      const cv = /^\/artifacts\/cv\/([A-Za-z0-9][A-Za-z0-9._-]*)\/[0-9a-f]{64}\/cv-(?:ats|visual)\.pdf$/.exec(path);
      if (cv) {
        const permitido = arquivosServiveis(await lerManifesto(dataRoot, cv[1]).catch(() => null)).includes(path.slice(1));
        if (!permitido) return send(404, { erro: 'Arquivo indisponível.' });
        const bytes = await privateFile(dataRoot, path.slice(1)).catch(() => null);
        return bytes ? send(200, bytes, 'application/pdf') : send(404, { erro: 'Arquivo indisponível.' });
      }
      const material = await materialsPolicy.read(path);
      if (material) return send(200, material.bytes, material.type);
      send(404, { erro: path.startsWith('/curriculos/') || path.startsWith('/carreira/') ? 'Arquivo indisponível.' : 'Não encontrado.' });
    } catch {
      send(500, { erro: 'Não foi possível carregar os dados do painel.' });
    }
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, host, done); });
  actualPort = server.address().port;
  return { server, mode: state.mode, url: `http://${host}:${actualPort}`, close: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done())) };
}
