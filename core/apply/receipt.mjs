// Comprovante da candidatura (F6.11): o script lê só a mensagem de confirmação e a origem pública depois do envio.
// Sem confirmação reconhecível, o estado é enviada_sem_comprovante (pede conferência). O comprovante guarda o hash do PDF
// enviado e nunca dado da identidade; o CV enviado é congelado e, no modo ativo, a candidatura entra no painel.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { marcarEnviado } from '../cv/artifacts.mjs';
import { chaveTentativa, projetarTentativas } from './attempts.mjs';
import { readEvents } from '../store/events.mjs';
import { readMigrationState } from '../migration/legacy.mjs';
import { marcarCandidatura } from '../store/commands/marcarCandidatura.mjs';
import { localDay } from '../store/schema.mjs';

export const CONFIRMACAO = /(obrigad[oa] por se candidatar|candidatura (foi )?(enviada|recebida|realizada|conclu[ií]da)|recebemos (a sua|sua) candidatura|inscri[cç][aã]o (foi )?(realizada|conclu[ií]da|confirmada)|application (was )?(submitted|received)|thank(s| you) for (applying|your application)|we('ve| have) received your application)/i;

// Roda na página depois do envio: contexto livre e caminho da URL podem conter identidade ou tokens.
export const SCRIPT_COMPROVANTE = `(()=>{const t=(document.body.innerText||'').replace(/\\s+/g,' ').trim(),m=${CONFIRMACAO}.exec(t);`
  + `return{texto:m?m[0]:null,url:location.origin,data:new Date().toISOString()}})()`;

const hashArquivo = async caminho => createHash('sha256').update(await readFile(caminho)).digest('hex');

// bruto: saída do SCRIPT_COMPROVANTE (ou null). Devolve { estado, comprovante }.
export async function registrarComprovante(dataRoot, { vaga, bruto, ts = new Date().toISOString() }) {
  const tentativa = projetarTentativas((await readEvents(dataRoot)).eventos).get(chaveTentativa(vaga));
  if (!tentativa || tentativa.vaga_id !== vaga.id || tentativa.estado !== 'em_andamento') throw new Error('Nenhuma tentativa em andamento para este comprovante.');
  const atual = tentativa.cv;
  const texto = typeof bruto?.texto === 'string' ? CONFIRMACAO.exec(bruto.texto)?.[0] ?? null : null;
  let url = null;
  try { const u = new URL(String(bruto?.url ?? '')); if (['http:', 'https:'].includes(u.protocol)) url = u.origin; } catch { /* sem URL */ }
  const pdfHash = atual ? await hashArquivo(path.join(dataRoot, atual.ats)) : null;
  if (atual && pdfHash !== atual.pdf_sha256) throw new Error('O PDF escolhido na tentativa foi alterado; confira o envio manualmente.');
  const comprovante = {
    texto, url, data: ts,
    ...(atual ? { cv_hash: atual.hash, pdf_sha256: pdfHash } : {}),
  };
  const estado = texto ? 'enviada' : 'enviada_sem_comprovante';
  if (atual) await marcarEnviado(dataRoot, { vagaId: vaga.id, versao: atual.hash, ts });
  if (texto && (await readMigrationState(dataRoot))?.mode === 'ativo') {
    await marcarCandidatura({ dataRoot, id: vaga.id, aplicada: true, data: localDay(ts), now: ts });
  }
  return { estado, comprovante };
}
