// Comprovante da candidatura (F6.11): o script lê só a mensagem de confirmação e a URL pública da página depois do envio.
// Sem confirmação reconhecível, o estado é enviada_sem_comprovante (pede conferência). O comprovante guarda o hash do PDF
// enviado e nunca dado da identidade; o CV enviado é congelado e, no modo ativo, a candidatura entra no painel.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { congelarCvEnviado, cvDoPainel, lerManifesto } from '../cv/artifacts.mjs';
import { redact } from '../privacy/redact.mjs';
import { readMigrationState } from '../migration/legacy.mjs';
import { marcarCandidatura } from '../store/commands/marcarCandidatura.mjs';
import { localDay } from '../store/schema.mjs';

export const CONFIRMACAO = /(obrigad[oa] por se candidatar|candidatura (foi )?(enviada|recebida|realizada|conclu[ií]da)|recebemos (a sua|sua) candidatura|inscri[cç][aã]o (foi )?(realizada|conclu[ií]da|confirmada)|application (was )?(submitted|received)|thank(s| you) for (applying|your application)|we('ve| have) received your application)/i;

// Roda na página depois do envio: devolve só o trecho de confirmação (curto) e a URL sem query nem fragmento.
export const SCRIPT_COMPROVANTE = `(()=>{const t=(document.body.innerText||'').replace(/\\s+/g,' ').trim(),m=${CONFIRMACAO}.exec(t),i=m?Math.max(0,m.index-60):0;`
  + `return{texto:m?t.slice(i,i+300):null,url:location.origin+location.pathname,data:new Date().toISOString()}})()`;

const hashArquivo = async caminho => createHash('sha256').update(await readFile(caminho)).digest('hex');

// bruto: saída do SCRIPT_COMPROVANTE (ou null). Devolve { estado, comprovante }.
export async function registrarComprovante(dataRoot, { vaga, bruto, identity = [], ts = new Date().toISOString() }) {
  const atual = cvDoPainel(await lerManifesto(dataRoot, vaga.id).catch(() => null))?.atual ?? null;
  const texto = typeof bruto?.texto === 'string' && CONFIRMACAO.test(bruto.texto) ? redact(bruto.texto.slice(0, 300), identity).valor : null;
  let url = null;
  try { const u = new URL(String(bruto?.url ?? '')); if (['http:', 'https:'].includes(u.protocol)) url = `${u.origin}${u.pathname}`; } catch { /* sem URL */ }
  const comprovante = {
    texto, url, data: ts,
    ...(atual ? { cv_hash: atual.hash, pdf_sha256: await hashArquivo(path.join(dataRoot, atual.ats)).catch(() => null) } : {}),
  };
  const estado = texto ? 'enviada' : 'enviada_sem_comprovante';
  if (atual) await congelarCvEnviado(dataRoot, { vagaId: vaga.id, ts }).catch(() => null);
  if (texto && (await readMigrationState(dataRoot))?.mode === 'ativo') {
    await marcarCandidatura({ dataRoot, id: vaga.id, aplicada: true, data: localDay(ts), now: ts }).catch(() => null);
  }
  return { estado, comprovante };
}
