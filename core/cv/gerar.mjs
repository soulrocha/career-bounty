// Do pipeline ao artefato: vaga da projeção + base de afirmações + perfil de CV -> payload, dois PDFs, gate, artefato e evento.
// Sem runner, vale a seleção determinística; com runner (--live/--replay), o redator escolhe e ordena e o gate confere.
// Em modo sombra o artefato é gravado, mas nenhum evento: o legado continua o escritor oficial do pipeline.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { lerBase } from '../kb/base.mjs';
import { carregarFontes } from '../kb/fontes.mjs';
import { emSombra } from '../radar/collect.mjs';
import { appendEvents, readEvents } from '../store/events.mjs';
import { projectEvents } from '../store/project.mjs';
import { atualizarGateNoManifesto, cvDoPainel, gravarCv, lerManifesto } from './artifacts.mjs';
import { avaliarGate, eventoGate } from './gates.mjs';
import { carregarTemplate, fotoComoDataUri } from './html.mjs';
import { extrairTexto } from './pdf.mjs';
import { ITENS_MAX_PADRAO, redigirCv } from './redator.mjs';
import { gerarPdfAts } from './renderAts.mjs';
import { gerarPdfVisual } from './renderVisual.mjs';
import { decidirCv, montarPayload, selecionarCv } from './select.mjs';
import { proporPerfilPortal } from './perfilPortal.mjs';
import { atomicJson, atomicWriteFile } from '../store/atomicWrite.mjs';

export const pastaPerfilCv = dataRoot => path.join(dataRoot, 'cv');
const sha = conteudo => createHash('sha256').update(conteudo).digest('hex');

// DATA_ROOT/cv/perfil.json: cabeçalho, foto (arquivo na mesma pasta), 4 cards ligados a afirmações, resumo-base, experiências e seções fixas.
export async function carregarPerfilCv(dataRoot) {
  const arquivo = path.join(pastaPerfilCv(dataRoot), 'perfil.json');
  let perfil;
  try { perfil = JSON.parse(await readFile(arquivo, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Perfil de CV ausente: crie ${arquivo} (formato em docs/CV.md).`);
    throw new Error(`Perfil de CV inválido em ${arquivo}: ${error.message}`);
  }
  if (!perfil?.cabecalho?.nome || !Array.isArray(perfil.cards) || !Array.isArray(perfil.experiencias)) throw new Error('Perfil de CV incompleto: precisa de cabecalho.nome, cards e experiencias.');
  if (perfil.cards.length !== 4) throw new Error(`Perfil de CV com ${perfil.cards.length} cards; o CV usa exatamente 4.`);
  if (perfil.foto && (path.isAbsolute(perfil.foto) || perfil.foto.split(/[\\/]/).includes('..'))) throw new Error('perfil.foto deve ser um arquivo dentro de DATA_ROOT/cv.');
  if (perfil.itens_por_experiencia !== undefined && !(Number.isInteger(perfil.itens_por_experiencia) && perfil.itens_por_experiencia >= 1 && perfil.itens_por_experiencia <= 10)) {
    throw new Error('perfil.itens_por_experiencia deve ser inteiro de 1 a 10.');
  }
  return perfil;
}

// Limite de bullets por experiência: do perfil (histórico longo precisa de menos para caber em 2 páginas) ou o padrão.
export const itensPorExperiencia = perfil => perfil.itens_por_experiencia ?? ITENS_MAX_PADRAO;

async function contexto({ dataRoot, settings, vagaId }) {
  const { eventos } = await readEvents(dataRoot);
  const vaga = (projectEvents(eventos).vagas ?? []).find(v => v.id === vagaId);
  if (!vaga) throw new Error(`Vaga não encontrada na projeção: ${vagaId}`);
  const base = await lerBase((await carregarFontes({ dataRoot, settings })).fontes);
  return { vaga, base };
}

const pastaDaVersao = (dataRoot, vagaId, hash) => path.join(dataRoot, 'artifacts', 'cv', vagaId, hash);

// Reconfere as versões gravadas da vaga contra a base atual e atualiza o manifesto. Sem isso, uma versão antiga
// aprovada voltaria a ser oferecida depois de uma afirmação dela ser rebaixada.
async function reavaliarVersoes({ dataRoot, vagaId, base, exceto = null }) {
  const manifesto = await lerManifesto(dataRoot, vagaId);
  const resultados = new Map();
  for (const versao of manifesto?.versoes ?? []) {
    if (versao.hash === exceto) continue;
    const pasta = pastaDaVersao(dataRoot, vagaId, versao.hash);
    const payload = JSON.parse(await readFile(path.join(pasta, 'payload.json'), 'utf8'));
    const gate = avaliarGate({ payload, afirmacoes: base.claims, textoAts: extrairTexto(await readFile(path.join(pasta, 'cv-ats.pdf'))) });
    resultados.set(versao.hash, { gate: { ...gate, versao: versao.hash }, tipo: payload.tipo });
    await atualizarGateNoManifesto(dataRoot, { vagaId, versao: versao.hash, gate });
  }
  return resultados;
}

// Grava o evento do gate com a aprovada mais nova (depois da reavaliação). Em modo sombra não grava e avisa.
async function registrarGate({ dataRoot, vagaId, gate, tipoCv, ts }) {
  const aprovada = cvDoPainel(await lerManifesto(dataRoot, vagaId))?.atual?.hash ?? null;
  if (await emSombra(dataRoot)) return { aprovada, evento: false };
  await appendEvents(dataRoot, [eventoGate({ vagaId, gate, tipoCv, aprovada, ts })], { now: ts });
  return { aprovada, evento: true };
}

const AVISO_SOMBRA = 'modo sombra: o CV foi gravado em artifacts, mas o gate não virou evento (o legado continua o escritor oficial)';

export async function gerarCvDaVaga({ dataRoot, settings, vagaId, runner = null, navegador, ts = new Date().toISOString() }) {
  const { vaga, base } = await contexto({ dataRoot, settings, vagaId });
  const decisao = decidirCv(vaga, settings);
  if (!decisao.gerar) return { gerado: false, motivo: decisao.motivo };
  const perfil = await carregarPerfilCv(dataRoot);
  const maxItens = itensPorExperiencia(perfil);
  let payload = selecionarCv({ vaga, perfil, afirmacoes: base.claims, config: settings, maxItens });
  let avisos = [];
  // O redator só entra quando a seleção achou alvo: vaga sem requisito atendido ligado a afirmação fica no CV-base.
  if (runner && payload.tipo === 'adaptado') {
    const redigido = await redigirCv({ runner, vaga, afirmacoes: base.claims, experiencias: perfil.experiencias, maxItens, afirmacoesDosCards: perfil.cards.flatMap(c => c.claim_ids ?? []) });
    payload = montarPayload({ perfil, afirmacoes: base.claims, selecao: redigido.selecao, vaga, tipo: 'adaptado', requisitos_atendidos: payload.requisitos_atendidos });
    avisos = redigido.avisos;
  }
  const foto = perfil.foto ? await readFile(path.join(pastaPerfilCv(dataRoot), perfil.foto)) : null;
  const fotoDataUri = perfil.foto ? await fotoComoDataUri(path.join(pastaPerfilCv(dataRoot), perfil.foto)) : null;
  // A versão cobre também a foto e os templates: trocar qualquer um gera versão nova, nunca PDF novo sob hash antigo.
  payload = { ...payload, render: { foto: foto ? sha(foto) : null, templates: sha((await carregarTemplate('cv-visual.html')) + (await carregarTemplate('cv-ats.html'))) } };
  const visual = await gerarPdfVisual(payload, { fotoDataUri, navegador });
  const ats = await gerarPdfAts(payload, { navegador });
  const gate = avaliarGate({ payload, afirmacoes: base.claims, textoAts: extrairTexto(ats.pdf) });
  // Mesmo payload de um CV já enviado: a versão congelada fica como está (é a mesma) e o fluxo segue com a reavaliação.
  const jaEnviada = (await lerManifesto(dataRoot, vagaId))?.enviado?.hash === gate.versao;
  const pasta = jaEnviada ? pastaDaVersao(dataRoot, vagaId, gate.versao) : (await gravarCv(dataRoot, {
    vagaId, versao: gate.versao, tipo: payload.tipo, payload, gate, ts,
    arquivos: { 'cv-visual.html': visual.html, 'cv-visual.pdf': visual.pdf, 'cv-ats.html': ats.html, 'cv-ats.pdf': ats.pdf },
  })).pasta;
  if (jaEnviada) avisos = [...avisos, 'este CV é o já enviado nesta candidatura; a versão congelada foi mantida'];
  await reavaliarVersoes({ dataRoot, vagaId, base, exceto: jaEnviada ? null : gate.versao });
  const { aprovada, evento } = await registrarGate({ dataRoot, vagaId, gate, tipoCv: payload.tipo, ts });
  if (!evento) avisos = [...avisos, AVISO_SOMBRA];
  return { gerado: true, motivo: decisao.motivo, tipo: payload.tipo, versao: gate.versao, gate, aprovada, evento, pasta, paginas: { visual: visual.paginas, ats: ats.paginas }, avisos };
}

const linhasProposta = (proposta, dia) => [
  `# Proposta de perfil (${proposta.portal}), ${dia}`, '',
  'Só proposta: nada foi aplicado no portal. Revise e copie o que quiser.', '',
  ...(proposta.secoes.length ? proposta.secoes.flatMap(s => [
    `## ${s.campo}`, '', `Afirmações: ${s.afirmacoes.join(', ')}`, '',
    '**Atual**', '', Array.isArray(s.atual) ? s.atual.join(', ') || '(vazio)' : s.atual || '(vazio)', '',
    '**Proposto**', '', Array.isArray(s.proposto) ? s.proposto.join(', ') : s.proposto, '',
  ]) : ['Nada a mudar: o perfil atual já corresponde à proposta.']),
].join('\n');

// Proposta de perfil de portal (F5.6) a partir de DATA_ROOT/cv/perfil-<portal>.json, gravada em DATA_ROOT/outbox/cv.
export async function proporPerfilDoPortal({ dataRoot, settings, portal = 'gupy', runner, ts = new Date().toISOString() }) {
  if (!/^[a-z0-9-]{2,30}$/.test(portal)) throw new Error('Portal inválido.');
  const arquivo = path.join(pastaPerfilCv(dataRoot), `perfil-${portal}.json`);
  let perfilAtual;
  try { perfilAtual = JSON.parse(await readFile(arquivo, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Perfil do portal ausente: copie o perfil atual do ${portal} para ${arquivo} (formato em docs/CV.md).`);
    throw new Error(`Perfil do portal inválido em ${arquivo}: ${error.message}`);
  }
  const base = await lerBase((await carregarFontes({ dataRoot, settings })).fontes);
  const proposta = await proporPerfilPortal({ runner, portal, perfilAtual: { experiencias: [], habilidades: [], ...perfilAtual }, afirmacoes: base.claims });
  const dia = ts.slice(0, 10);
  const destino = path.join(dataRoot, 'outbox', 'cv', `perfil-${portal}-${dia}`);
  await atomicJson(`${destino}.json`, { tipo: proposta.tipo, portal, gerado_em: ts, secoes: proposta.secoes });
  await atomicWriteFile(`${destino}.md`, `${linhasProposta(proposta, dia)}\n`);
  return { ...proposta, arquivo: `${destino}.md` };
}

// Reavalia todas as versões já geradas contra a base atual (ex.: afirmação rebaixada depois da geração) e registra o resultado
// da mais nova, com a aprovada que sobrou.
export async function reavaliarCv({ dataRoot, settings, vagaId, ts = new Date().toISOString() }) {
  const { base } = await contexto({ dataRoot, settings, vagaId });
  const ultima = (await lerManifesto(dataRoot, vagaId))?.versoes.at(-1);
  if (!ultima) throw new Error(`Nenhum CV gerado para ${vagaId}; rode "cv gerar --vaga ${vagaId}" antes.`);
  const resultados = await reavaliarVersoes({ dataRoot, vagaId, base });
  const { gate, tipo } = resultados.get(ultima.hash);
  const { aprovada, evento } = await registrarGate({ dataRoot, vagaId, gate, tipoCv: tipo, ts });
  return { versao: ultima.hash, gate, aprovada, evento, avisos: evento ? [] : [AVISO_SOMBRA] };
}
