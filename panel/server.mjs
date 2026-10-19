import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { noLinks } from '../core/migration/paths.mjs';
import { isDeepStrictEqual } from 'node:util';
import { publicMarker, validarAfirmacaoIncluida, validarItemMarcado, validarLacunaEntrevista } from '../core/store/rules.mjs';
import { marcarCandidatura } from '../core/store/commands/marcarCandidatura.mjs';
import { descartar } from '../core/store/commands/descartar.mjs';
import { readEvents, appendEvents } from '../core/store/events.mjs';
import { projectEvents } from '../core/store/project.mjs';
import { renderPainelDe } from './render.mjs';
import { ABA_QUADRANTES, respostaQuadrantes } from './quadrantes.mjs';
import { ABA_PERGUNTAS, BLOCO_PERGUNTAS_MODAL, listarPerguntas } from './perguntas.mjs';
import { ABA_FILA, listarFila } from './fila.mjs';
import { injetarAbas } from './abas.mjs';
import { responderPergunta } from '../core/apply/perguntas.mjs';
import { lerRespostas } from '../core/apply/answers.mjs';
import { createMaterials, namedMaterialsOf, privateFile, validateBaseFiles } from './materials.mjs';
import { arquivosServiveis, congelarCvEnviado, lerManifesto } from '../core/cv/artifacts.mjs';
import { localDay } from '../core/store/schema.mjs';
import { projectContatos } from '../core/store/projections/contatos.mjs';
import { projectProcessos } from '../core/store/projections/processos.mjs';
import { projectHistorico } from '../core/store/projections/historico.mjs';
import { projectAnaliseCurriculo } from '../core/store/projections/analiseCurriculo.mjs';
import { analisarBase } from '../core/kb/analise.mjs';
import { gravarProposta, slug } from '../core/kb/outbox.mjs';
import { mascararContato, mascararProcesso, mascararTexto, mascararVagaHistorico, mascararHistorico } from '../core/privacy/mask.mjs';
import { loadIdentityValues, redact } from '../core/privacy/redact.mjs';
import { loadSettings } from '../core/config.mjs';
import { projectEntrevistas } from '../core/store/projections/entrevistas.mjs';
import { gerarPreparacaoEntrevista, formatarPreparacaoMarkdown } from '../core/interview/preparation.mjs';
import { carregarFontes } from '../core/kb/fontes.mjs';
import { lerBase } from '../core/kb/base.mjs';

const ABAS = [ABA_QUADRANTES, ABA_PERGUNTAS, ABA_FILA];
const PANEL_DIR = dirname(fileURLToPath(import.meta.url));
const FONTES_PERMITIDAS = new Set([
  'schibsted-grotesk-400.woff2',
  'schibsted-grotesk-500.woff2',
  'schibsted-grotesk-600.woff2',
  'schibsted-grotesk-700.woff2',
  'pixelify-sans-500.woff2',
]);

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
    // A página estática do snapshot só vale no modo sombra. Depois do corte o snapshot continua no estado (para os
    // currículos antigos), mas a página é montada do log, com a interface atual.
    if (state.mode === 'shadow') pageSource = (await privateFile(dataRoot, `${state.snapshotRoot}/carreira/busca-vagas/painel-vagas.html`)).toString('utf8');
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
        const rotasPostPermitidas = [
          '/api/candidaturas',
          '/api/descarte',
          '/api/perguntas',
          '/api/analise-curriculo/incluir',
          '/api/analise-curriculo/marcar',
          '/api/analise-curriculo/entrevista',
        ];
        if (![`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`].includes(req.headers.origin)
          || req.headers['x-painel-token'] !== token || !rotasPostPermitidas.includes(req.url)) {
          return send(403, { erro: 'Acesso inválido.' });
        }
        // Rotas de analise-curriculo (F9.5)
        if (req.url.startsWith('/api/analise-curriculo/')) {
          if ((req.headers['content-type'] ?? '').split(';')[0] !== 'application/json') return send(415, { erro: 'Formato inválido.' });
          const tamanho = Number(req.headers['content-length'] ?? 0);
          if (!(tamanho > 0 && tamanho <= 8192)) return send(413, { erro: 'Pedido inválido.' });
          if (!writable) return send(409, { erro: 'Modo sombra: gravação desligada.', gravacao_painel: 'desligada' });
          const partes = [];
          for await (const parte of req) partes.push(parte);
          let corpo;
          try { corpo = JSON.parse(Buffer.concat(partes).toString('utf8')); } catch { return send(400, { erro: 'Pedido malformado.' }); }
          if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return send(400, { erro: 'Campos inválidos.' });

          const nowTs = typeof now === 'function' ? now() : (now ?? new Date().toISOString());

          if (req.url === '/api/analise-curriculo/incluir') {
            if (typeof corpo.afirmacao_id !== 'string' || !corpo.afirmacao_id.trim()) {
              return send(400, { erro: 'ID da afirmação é obrigatório.' });
            }
            const afirmacaoId = corpo.afirmacao_id.replace(/^fora_do_cv:af:/, '').trim();
            const settings = await loadSettings({ dataRoot }).catch(() => ({}));
            const { base } = await analisarBase({ dataRoot, settings, hoje: new Date(nowTs) });
            const af = base.claims.find(c => c.id === afirmacaoId);
            if (!af) {
              return send(400, { erro: `Afirmação não encontrada na base: ${afirmacaoId}` });
            }
            const data = corpo.data ?? localDay(nowTs);
            const dados = {
              afirmacao_id: afirmacaoId,
              experiencia_id: corpo.experiencia_id ?? null,
              data,
            };
            const erro = validarAfirmacaoIncluida(dados, nowTs);
            if (erro) return send(400, { erro });

            const evento = {
              id: `analise.afirmacao_incluida:${randomUUID()}`,
              ts: new Date(nowTs).toISOString(),
              ator: 'usuario',
              tipo: 'analise.afirmacao_incluida',
              entidade: 'afirmacao',
              entidade_id: afirmacaoId,
              dados,
              evidencia: [],
            };
            await appendEvents(dataRoot, [evento], { now: nowTs, host: hostId });
            return send(200, { ok: true, afirmacao_id: afirmacaoId, experiencia_id: dados.experiencia_id });
          }

          if (req.url === '/api/analise-curriculo/marcar') {
            if (typeof corpo.item_id !== 'string' || !corpo.item_id.trim()) {
              return send(400, { erro: 'ID do item é obrigatório.' });
            }
            const como = corpo.como === 'ignorar' ? 'ignorado' : corpo.como;
            const data = corpo.data ?? localDay(nowTs);
            const dados = {
              item_id: corpo.item_id.trim(),
              como,
              motivo: corpo.motivo ?? null,
              data,
            };
            const erro = validarItemMarcado(dados, nowTs);
            if (erro) return send(400, { erro });

            const evento = {
              id: `analise.item_marcado:${randomUUID()}`,
              ts: new Date(nowTs).toISOString(),
              ator: 'usuario',
              tipo: 'analise.item_marcado',
              entidade: 'item_analise',
              entidade_id: dados.item_id,
              dados,
              evidencia: [],
            };
            await appendEvents(dataRoot, [evento], { now: nowTs, host: hostId });
            return send(200, { ok: true, item_id: dados.item_id, como });
          }

          if (req.url === '/api/analise-curriculo/entrevista') {
            if (typeof corpo.item_id !== 'string' || !corpo.item_id.trim()) {
              return send(400, { erro: 'ID do item é obrigatório.' });
            }
            const itemId = corpo.item_id.trim();
            const settings = await loadSettings({ dataRoot }).catch(() => ({}));
            const { base, quadrantes } = await analisarBase({ dataRoot, settings, hoje: new Date(nowTs) });
            const { eventos } = await readEvents(dataRoot);
            const projecao = projectAnaliseCurriculo({ quadrantes, evidencias: base.evidence, eventos, now: new Date(nowTs) });

            const item = projecao.grupos.lacuna.find(l =>
              l.id === itemId ||
              l.id === `lacuna:${itemId}` ||
              l.id.replace(/^lacuna:/, '') === itemId
            );
            if (!item) {
              return send(404, { erro: 'Item de lacuna não encontrado na análise.' });
            }
            if (!item.pergunta || !item.pergunta.trim()) {
              return send(400, { erro: 'Item de lacuna não possui pergunta sugerida.' });
            }

            const data = corpo.data ?? localDay(nowTs);
            const md = [
              '# Pergunta de Entrevista de Lacuna',
              '',
              `- **Item:** ${item.id}`,
              `- **Tipo:** ${item.tipo_origem || 'lacuna'}`,
              `- **Data de Geração:** ${data}`,
              '',
              '## Pergunta Sugerida',
              item.pergunta,
              '',
              '## Justificativa',
              item.motivo || item.texto,
              '',
            ].join('\n');

            const slugId = slug(item.id.replace(/^lacuna:/, ''));
            const nomeArquivo = `lacuna-${slugId}-${data}.md`;
            const arquivoAbsoluto = await gravarProposta(dataRoot, 'lacunas', nomeArquivo, md);
            const arquivoRelativo = relative(dataRoot, arquivoAbsoluto).replaceAll('\\', '/');

            const dados = {
              item_id: item.id,
              pergunta: item.pergunta,
              arquivo_rascunho: arquivoRelativo,
              data,
            };
            const erro = validarLacunaEntrevista(dados, nowTs);
            if (erro) return send(400, { erro });

            const evento = {
              id: `analise.lacuna_entrevista:${randomUUID()}`,
              ts: new Date(nowTs).toISOString(),
              ator: 'usuario',
              tipo: 'analise.lacuna_entrevista',
              entidade: 'lacuna',
              entidade_id: item.id,
              dados,
              evidencia: [],
            };
            await appendEvents(dataRoot, [evento], { now: nowTs, host: hostId });
            return send(200, { ok: true, item_id: item.id, pergunta: item.pergunta, rascunho: arquivoRelativo });
          }
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
      if (path === '/api/fila') {
        if (req.headers['x-painel-token'] !== token) return send(403, { erro: 'Acesso inválido.' });
        return send(200, await listarFila({ dataRoot }));
      }
      if (path === '/api/perguntas') {
        if (req.headers['x-painel-token'] !== token) return send(403, { erro: 'Acesso inválido.' });
        return send(200, await listarPerguntas({ dataRoot }));
      }
      if (path === '/api/respostas') {
        if (req.headers['x-painel-token'] !== token) return send(403, { erro: 'Acesso inválido.' });
        const identidade = await loadIdentityValues({ env: { IDENTITY_FILE: join(dataRoot, 'identity.yml') } });
        const respostas = await lerRespostas(dataRoot).catch(() => []);
        const { valor: respostasMascaradas } = redact(respostas, identidade);
        return send(200, {
          respostas: respostasMascaradas,
          total: respostasMascaradas.length,
        });
      }
      if (path === '/api/quadrantes') {
        if (req.headers['x-painel-token'] !== token) return send(403, { erro: 'Acesso inválido.' });
        const { status, corpo } = await respostaQuadrantes({ dataRoot });
        return send(status, corpo);
      }
      if (path === '/api/analise-curriculo') {
        if (req.headers['x-painel-token'] !== token) return send(403, { erro: 'Acesso inválido.' });
        const settings = await loadSettings({ dataRoot }).catch(() => ({}));
        const nowTs = typeof now === 'function' ? now() : (now ?? new Date().toISOString());
        const identidade = await loadIdentityValues({ env: { IDENTITY_FILE: join(dataRoot, 'identity.yml') } });
        const { base, quadrantes } = await analisarBase({ dataRoot, settings, hoje: new Date(nowTs) });
        const { eventos } = await readEvents(dataRoot);
        const projecao = projectAnaliseCurriculo({ quadrantes, evidencias: base.evidence, eventos, now: new Date(nowTs) });

        function sanitizarItem(item) {
          const copia = { ...item };
          if (copia.texto) copia.texto = mascararTexto(copia.texto);
          if (copia.motivo) copia.motivo = mascararTexto(copia.motivo);
          if (copia.pergunta) copia.pergunta = mascararTexto(copia.pergunta);
          if (copia.entrevista?.pergunta) {
            copia.entrevista = {
              ...copia.entrevista,
              pergunta: mascararTexto(copia.entrevista.pergunta),
            };
          }
          return copia;
        }

        const corpo = {
          grupos: {
            confere: projecao.grupos.confere.map(sanitizarItem),
            sem_prova: projecao.grupos.sem_prova.map(sanitizarItem),
            fora_do_cv: projecao.grupos.fora_do_cv.map(sanitizarItem),
            lacuna: projecao.grupos.lacuna.map(sanitizarItem),
          },
          contadores: projecao.contadores,
          avisos: (projecao.avisos ?? []).map(mascararTexto),
        };

        const redigido = redact(corpo, identidade).valor;
        return send(200, redigido);
      }
      if (path === '/api/contatos') {
        if (req.headers['x-painel-token'] !== token) return send(403, { erro: 'Acesso inválido.' });
        const { eventos } = await readEvents(dataRoot);
        const nowTs = now?.() ?? new Date();
        const projecao = projectContatos(eventos, { now: nowTs });
        const query = new URL(req.url, 'http://127.0.0.1').searchParams;
        const vagaFiltro = query.get('vaga');
        const ativosFiltro = query.get('ativos') === '1';

        let contatos = projecao.contatos;
        if (vagaFiltro) {
          contatos = contatos.filter(c => c.vaga_id === vagaFiltro);
        }
        if (ativosFiltro) {
          const hoje = localDay(nowTs);
          contatos = contatos.filter(c => c.dias_desde_ultimo_contato <= 30 || (c.proxima_etapa?.data && c.proxima_etapa.data >= hoje));
        }

        const contatosMascarados = contatos.map(mascararContato);
        const porVagaMascarado = {};
        for (const [vagaId, grupo] of Object.entries(projecao.por_vaga)) {
          if (vagaFiltro && vagaId !== vagaFiltro) continue;
          porVagaMascarado[vagaId] = {
            ...grupo,
            contatos: grupo.contatos.map(mascararContato),
          };
        }

        const porPessoaMascarado = {};
        for (const [chave, grupo] of Object.entries(projecao.por_pessoa)) {
          const chaveMascarada = mascararTexto(chave);
          porPessoaMascarado[chaveMascarada] = {
            ...grupo,
            nome: mascararTexto(grupo.nome),
            papel: grupo.papel ? mascararTexto(grupo.papel) : null,
          };
        }

        return send(200, {
          contatos: contatosMascarados,
          por_vaga: porVagaMascarado,
          por_pessoa: porPessoaMascarado,
          total: contatosMascarados.length,
        });
      }
      if (path === '/api/processos') {
        if (req.headers['x-painel-token'] !== token) return send(403, { erro: 'Acesso inválido.' });
        const { eventos } = await readEvents(dataRoot);
        const nowTs = now?.() ?? new Date();
        const settings = await loadSettings({ dataRoot }).catch(() => ({}));
        const projecao = projectProcessos(eventos, { now: nowTs, config: settings });
        const query = new URL(req.url, 'http://127.0.0.1').searchParams;
        const situacaoFiltro = query.get('situacao');
        const alertaFiltro = query.get('alerta');

        let processos = projecao.processos;
        if (situacaoFiltro) {
          processos = processos.filter(p => p.situacao === situacaoFiltro);
        }
        if (alertaFiltro) {
          processos = processos.filter(p => p.alerta === alertaFiltro);
        }

        const processosMascarados = processos.map(mascararProcesso);
        return send(200, {
          processos: processosMascarados,
          totais: projecao.totais,
          total: processosMascarados.length,
        });
      }
      if (path === '/api/acompanhamento') {
        if (req.headers['x-painel-token'] !== token) return send(403, { erro: 'Acesso inválido.' });
        const { eventos } = await readEvents(dataRoot);
        const nowTs = now?.() ?? new Date();
        const settings = await loadSettings({ dataRoot }).catch(() => ({}));
        const projecao = projectProcessos(eventos, { now: nowTs, config: settings });

        const pendentesMascarados = projecao.pendentes.map(mascararProcesso);
        return send(200, {
          pendentes: pendentesMascarados,
          totais: projecao.totais,
          total: pendentesMascarados.length,
        });
      }
      if (path === '/api/historico') {
        if (req.headers['x-painel-token'] !== token) return send(403, { erro: 'Acesso inválido.' });
        const { eventos } = await readEvents(dataRoot);
        const nowTs = now?.() ?? new Date();
        const query = new URL(req.url, 'http://127.0.0.1').searchParams;
        const inicio = query.get('inicio') || undefined;
        const fim = query.get('fim') || undefined;
        const situacao = query.get('situacao') || undefined;
        const portal = query.get('portal') || undefined;

        const projecao = projectHistorico(eventos, { inicio, fim, situacao, portal, now: nowTs });
        const historicoMascarado = projecao.historico.map(mascararVagaHistorico);

        return send(200, {
          historico: historicoMascarado,
          totais: projecao.totais,
          total: historicoMascarado.length,
        });
      }
      if (path === '/api/entrevistas/preparacao') {
        if (req.headers['x-painel-token'] !== token) return send(403, { erro: 'Acesso inválido.' });
        const query = new URL(req.url, 'http://127.0.0.1').searchParams;
        const vagaId = query.get('vaga');
        if (!vagaId || !vagaId.trim()) return send(400, { erro: 'Parâmetro "vaga" é obrigatório.' });

        const { eventos } = await readEvents(dataRoot);
        const nowTs = typeof now === 'function' ? now() : (now ?? new Date().toISOString());
        const projecaoVagas = projectEvents(eventos);
        const vaga = projecaoVagas.vagas.find(v => v.id === vagaId);
        if (!vaga) return send(404, { erro: `Vaga não encontrada: ${vagaId}` });

        if (!vaga.requisitos || vaga.requisitos.length === 0) {
          return send(422, { erro: 'Vaga ainda não avaliada. Execute "entrevista preparar --vaga <id>" na CLI para gerar a avaliação antes da preparação.' });
        }

        const settings = await loadSettings({ dataRoot }).catch(() => ({}));
        const { fontes } = await carregarFontes({ dataRoot, settings });
        const base = await lerBase(fontes);

        const prep = gerarPreparacaoEntrevista({
          vaga,
          avaliacao: vaga,
          base,
          now: nowTs,
        });

        const markdownBruto = formatarPreparacaoMarkdown(prep);

        const projEntrevistas = projectEntrevistas(eventos);
        const regExistente = projEntrevistas.por_vaga[vagaId];
        const dataHoje = localDay(nowTs);
        const arquivo = regExistente?.arquivo ?? `outbox/entrevistas/entrevista-${slug(vagaId)}-${dataHoje}.md`;

        function mascararObjeto(obj) {
          if (typeof obj === 'string') return mascararTexto(obj);
          if (Array.isArray(obj)) return obj.map(mascararObjeto);
          if (obj && typeof obj === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(obj)) {
              out[k] = mascararObjeto(v);
            }
            return out;
          }
          return obj;
        }

        const corpo = {
          vaga_id: prep.vaga_id,
          cargo: mascararTexto(prep.cargo),
          empresa: mascararTexto(prep.empresa),
          data: prep.data,
          aderencia: prep.aderencia,
          contadores: prep.contadores,
          pontos_fortes: mascararObjeto(prep.pontos_fortes),
          pontos_fracos_e_lacunas: mascararObjeto(prep.pontos_fracos_e_lacunas),
          perguntas_star: mascararObjeto(prep.perguntas_star),
          o_que_nao_alegar: mascararObjeto(prep.o_que_nao_alegar),
          resumo_estrategico: mascararTexto(prep.resumo_estrategico),
          markdown: mascararTexto(markdownBruto),
          arquivo,
        };

        const identidade = await loadIdentityValues({ env: { IDENTITY_FILE: join(dataRoot, 'identity.yml') } });
        const redigido = redact(corpo, identidade).valor;

        return send(200, redigido);
      }
      if (['/icone.svg', '/favicon.ico'].includes(path)) {
        const iconePath = join(PANEL_DIR, 'icone.svg');
        const bytes = await readFile(iconePath).catch(() => null);
        return bytes ? send(200, bytes, 'image/svg+xml') : send(404, { erro: 'Ícone indisponível.' });
      }
      const matchFonte = /^\/fontes\/([a-z0-9-]+\.woff2)$/.exec(path);
      if (matchFonte) {
        const nome = matchFonte[1];
        if (!FONTES_PERMITIDAS.has(nome)) return send(404, { erro: 'Fonte indisponível.' });
        const fontePath = join(PANEL_DIR, 'fontes', nome);
        const bytes = await readFile(fontePath).catch(() => null);
        return bytes ? send(200, bytes, 'font/woff2') : send(404, { erro: 'Fonte indisponível.' });
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
        // A interface atual traz a própria navegação na placa; a barra injetada só serve às páginas antigas (snapshot do
        // modo sombra ou template privado antigo), que não têm placa.
        const comPlaca = /<header class="placa"/.test(page);
        const final = comPlaca ? page.replace('<div data-cb="perguntas-pendentes"></div>', () => BLOCO_PERGUNTAS_MODAL) : injetarAbas(page, ABAS);
        return send(200, Buffer.from(final), 'text/html; charset=utf-8');
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
