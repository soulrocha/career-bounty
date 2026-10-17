// /entrevista: lacuna vira pergunta (Opus, até 3 por item) e a resposta da pessoa vira afirmação `relato` PENDENTE.
// O agente só pergunta: não estima nem preenche métrica. Nada entra na base sem aprovação explícita, e nada toca o Vault.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chaveNumero, extrairNumeros } from '../cv/numeros.mjs';
import { loadAgent } from '../llm/agents.mjs';
import { embrulhar, limparCampoCurto, limparTextoNaoConfiavel } from '../privacy/untrusted.mjs';
import { atomicJson, atomicWriteFile } from '../store/atomicWrite.mjs';
import { localDay } from '../store/schema.mjs';
import { raizMarkdown } from './fontes.mjs';
import { gravarProposta, slug } from './outbox.mjs';
import { createMarkdownFolder } from './sources/markdownFolder.mjs';

export const MAX_PERGUNTAS = 3;
const ESTADO = 'state/entrevista.json';
const TEXTO_MIN = 15;
const TEXTO_MAX = 600;

// Só o que a lacuna precisa para perguntar bem. Nada de outras afirmações, CV, perfil ou identidade.
export function contextoMinimo(lacuna, base) {
  if (['sem_fonte', 'sem_linha_base'].includes(lacuna.tipo)) {
    const af = base.claims.find(c => c.id === lacuna.alvo);
    if (!af) throw new Error(`Afirmação ${lacuna.alvo} não encontrada na base.`);
    return { afirmacao: { id: af.id, texto: af.texto, nivel_prova: af.nivel_prova } };
  }
  if (lacuna.tipo === 'requisito_frequente') return { requisito: embrulhar(limparTextoNaoConfiavel(limparCampoCurto(lacuna.alvo, 160), { max: 160 }).texto) };
  if (lacuna.tipo === 'buraco_timeline') {
    const [de, ate] = lacuna.alvo.split('..');
    return { periodo: { de, ate } };
  }
  throw new Error(`Tipo de lacuna sem entrevista: ${lacuna.tipo}`);
}

function validarPerguntas(json, permitidos) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('saída deve ser um objeto');
  const extra = Object.keys(json).find(chave => chave !== 'perguntas');
  if (extra) throw new Error(`campo fora do contrato: ${extra}`);
  if (!Array.isArray(json.perguntas) || json.perguntas.length < 1) throw new Error('perguntas deve ser lista com ao menos uma pergunta');
  if (json.perguntas.length > MAX_PERGUNTAS) throw new Error(`no máximo ${MAX_PERGUNTAS} perguntas por item (veio ${json.perguntas.length})`);
  for (const pergunta of json.perguntas) {
    if (typeof pergunta !== 'string' || !pergunta.trim() || pergunta.length > 400) throw new Error('pergunta inválida (texto de 1 a 400 caracteres)');
    const fora = extrairNumeros(pergunta).find(n => !permitidos.has(chaveNumero(n)));
    if (fora) throw new Error(`pergunta cita o número ${fora.bruto}, que não está no contexto: o agente não estima nem preenche métrica`);
  }
}

export async function perguntarLacuna({ runner, lacuna, base }) {
  const agente = await loadAgent('entrevistador');
  const contexto = contextoMinimo(lacuna, base);
  const permitidos = new Set(extrairNumeros(JSON.stringify(contexto)).map(chaveNumero));
  const entrada = { lacuna: { tipo: lacuna.tipo }, contexto };
  const { json } = await runner.run({ agente: 'entrevistador', modelo: agente.modelo, versaoPrompt: agente.versaoPrompt, sistema: agente.sistema, entrada, validar: saida => validarPerguntas(saida, permitidos) });
  return { lacuna: lacuna.id, perguntas: json.perguntas };
}

async function lerEstado(dataRoot) {
  try { return JSON.parse(await readFile(path.join(dataRoot, ESTADO), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { versao: 1, pendentes: [] }; throw error; }
}

export async function listarPendentes(dataRoot) {
  return (await lerEstado(dataRoot)).pendentes;
}

const limparTexto = texto => limparTextoNaoConfiavel(texto, { max: TEXTO_MAX + 1 }).texto.replace(/\s+/g, ' ').trim();

async function proximoId(dataRoot, pendentes) {
  const claims = await createMarkdownFolder(await raizMarkdown(dataRoot)).claims();
  const usados = [...claims.map(c => c.id), ...pendentes.map(p => p.id)].map(id => /^AFL-(\d+)$/.exec(id)).filter(Boolean).map(m => Number(m[1]));
  return `AFL-${String(Math.max(0, ...usados) + 1).padStart(3, '0')}`;
}

export async function registrarResposta({ dataRoot, lacuna, texto, resposta, now = new Date() }) {
  if (typeof texto !== 'string' || /^\s*---\s*$/m.test(texto)) throw new Error('texto inválido: não pode conter linha com "---".');
  const limpo = limparTexto(texto);
  if (limpo.length < TEXTO_MIN || limpo.length > TEXTO_MAX) throw new Error(`texto da afirmação deve ter de ${TEXTO_MIN} a ${TEXTO_MAX} caracteres.`);
  const ditos = new Set(extrairNumeros(String(resposta ?? '')).map(chaveNumero));
  const inventado = extrairNumeros(limpo).find(n => !ditos.has(chaveNumero(n)));
  if (inventado) throw new Error(`número ${inventado.bruto} do texto não consta na resposta da pessoa: não se estima métrica.`);
  const estado = await lerEstado(dataRoot);
  const dia = localDay(now);
  const pendente = { id: await proximoId(dataRoot, estado.pendentes), lacuna: lacuna.id, tipo: lacuna.tipo, texto: limpo, nivel_prova: 'relato', fonte: `entrevista:${dia}`, estado: 'pendente',
    criado_em: now.toISOString(), numeros: extrairNumeros(limpo).map(n => n.bruto), ...(lacuna.tipo === 'buraco_timeline' ? { periodo: lacuna.alvo } : {}) };
  await atomicJson(path.join(dataRoot, ESTADO), { versao: 1, pendentes: [...estado.pendentes, pendente] });
  const nota = ['---', 'tipo: nota', 'contexto: pessoal', 'status: rascunho', `fonte: entrevista:${dia}`, `atualizado: ${dia}`, 'tags: [carreira, entrevista]', '---', '',
    `# Rascunho de afirmação ${pendente.id}`, '', `Lacuna: ${lacuna.descricao}`, '', `Afirmação proposta (relato, a confirmar): ${limpo}`, '', `Resposta registrada: ${limparTexto(String(resposta ?? ''))}`, ''].join('\n');
  const rascunho = await gravarProposta(dataRoot, 'vault', `${dia}-${slug(`${lacuna.id}-${pendente.id}`)}.md`, nota);
  return { pendente, rascunho };
}

export async function rejeitarPendente({ dataRoot, id }) {
  const estado = await lerEstado(dataRoot);
  if (!estado.pendentes.some(p => p.id === id)) throw new Error(`Pendente ${id} não encontrado.`);
  await atomicJson(path.join(dataRoot, ESTADO), { versao: 1, pendentes: estado.pendentes.filter(p => p.id !== id) });
  return { id, descartado: true };
}

// Única escrita na base: acrescenta o bloco em kb/claims.local.md, só depois da aprovação explícita.
export async function aprovarPendente({ dataRoot, id }) {
  const estado = await lerEstado(dataRoot);
  const pendente = estado.pendentes.find(p => p.id === id);
  if (!pendente) throw new Error(`Pendente ${id} não encontrado.`);
  const arquivo = path.join(await raizMarkdown(dataRoot), 'claims.local.md');
  let atual = '';
  try { atual = await readFile(arquivo, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (new RegExp(`^id:\\s*${id}\\s*$`, 'm').test(atual)) throw new Error(`${id} já existe em claims.local.md.`);
  const bloco = ['---', `id: ${pendente.id}`, `nivel_prova: ${pendente.nivel_prova}`, `origem: "${pendente.fonte}"`, 'uso: [Ent]', 'publicavel: nao',
    `numeros: [${pendente.numeros.map(n => `"${n}"`).join(', ')}]`, ...(pendente.periodo ? [`periodo: "${pendente.periodo}"`] : []), '---', pendente.texto, ''].join('\n');
  await atomicWriteFile(arquivo, `${atual ? `${atual.trimEnd()}\n\n` : ''}${bloco}`);
  await atomicJson(path.join(dataRoot, ESTADO), { versao: 1, pendentes: estado.pendentes.filter(p => p.id !== id) });
  return { id, arquivo };
}
