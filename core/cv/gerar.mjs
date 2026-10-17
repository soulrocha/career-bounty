// Do pipeline ao artefato: vaga da projeção + base de afirmações + perfil de CV -> payload, dois PDFs, gate, artefato e evento.
// Sem runner, vale a seleção determinística; com runner (--live/--replay), o redator escolhe e ordena e o gate confere.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { lerBase } from '../kb/base.mjs';
import { carregarFontes } from '../kb/fontes.mjs';
import { appendEvents, readEvents } from '../store/events.mjs';
import { projectEvents } from '../store/project.mjs';
import { atualizarGateNoManifesto, cvDoPainel, gravarCv, lerManifesto } from './artifacts.mjs';
import { avaliarGate, eventoGate } from './gates.mjs';
import { fotoComoDataUri } from './html.mjs';
import { extrairTexto } from './pdf.mjs';
import { redigirCv } from './redator.mjs';
import { gerarPdfAts } from './renderAts.mjs';
import { gerarPdfVisual } from './renderVisual.mjs';
import { decidirCv, montarPayload, selecionarCv } from './select.mjs';

export const pastaPerfilCv = dataRoot => path.join(dataRoot, 'cv');

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
  return perfil;
}

async function contexto({ dataRoot, settings, vagaId }) {
  const { eventos } = await readEvents(dataRoot);
  const vaga = (projectEvents(eventos).vagas ?? []).find(v => v.id === vagaId);
  if (!vaga) throw new Error(`Vaga não encontrada na projeção: ${vagaId}`);
  const base = await lerBase((await carregarFontes({ dataRoot, settings })).fontes);
  return { vaga, base };
}

async function registrarGate({ dataRoot, vagaId, gate, tipoCv, ts }) {
  const aprovada = cvDoPainel(await lerManifesto(dataRoot, vagaId))?.atual?.hash ?? null;
  await appendEvents(dataRoot, [eventoGate({ vagaId, gate, tipoCv, aprovada, ts })], { now: ts });
  return aprovada;
}

export async function gerarCvDaVaga({ dataRoot, settings, vagaId, runner = null, navegador, ts = new Date().toISOString() }) {
  const { vaga, base } = await contexto({ dataRoot, settings, vagaId });
  const decisao = decidirCv(vaga, settings);
  if (!decisao.gerar) return { gerado: false, motivo: decisao.motivo };
  const perfil = await carregarPerfilCv(dataRoot);
  let payload = selecionarCv({ vaga, perfil, afirmacoes: base.claims, config: settings });
  let avisos = [];
  if (runner && decisao.adaptar) {
    const redigido = await redigirCv({ runner, vaga, afirmacoes: base.claims, experiencias: perfil.experiencias, afirmacoesDosCards: perfil.cards.flatMap(c => c.claim_ids ?? []) });
    payload = montarPayload({ perfil, afirmacoes: base.claims, selecao: redigido.selecao, vaga, tipo: 'adaptado', requisitos_atendidos: payload.requisitos_atendidos });
    avisos = redigido.avisos;
  }
  const fotoDataUri = perfil.foto ? await fotoComoDataUri(path.join(pastaPerfilCv(dataRoot), perfil.foto)) : null;
  const visual = await gerarPdfVisual(payload, { fotoDataUri, navegador });
  const ats = await gerarPdfAts(payload, { navegador });
  const gate = avaliarGate({ payload, afirmacoes: base.claims, textoAts: extrairTexto(ats.pdf) });
  const { pasta } = await gravarCv(dataRoot, {
    vagaId, versao: gate.versao, tipo: payload.tipo, payload, gate, ts,
    arquivos: { 'cv-visual.html': visual.html, 'cv-visual.pdf': visual.pdf, 'cv-ats.html': ats.html, 'cv-ats.pdf': ats.pdf },
  });
  const aprovada = await registrarGate({ dataRoot, vagaId, gate, tipoCv: payload.tipo, ts });
  return { gerado: true, motivo: decisao.motivo, tipo: payload.tipo, versao: gate.versao, gate, aprovada, pasta, paginas: { visual: visual.paginas, ats: ats.paginas }, avisos };
}

// Reavalia a versão mais nova já gerada contra a base atual (ex.: afirmação rebaixada depois da geração) e registra o resultado.
export async function reavaliarCv({ dataRoot, settings, vagaId, ts = new Date().toISOString() }) {
  const { base } = await contexto({ dataRoot, settings, vagaId });
  const manifesto = await lerManifesto(dataRoot, vagaId);
  const ultima = manifesto?.versoes.at(-1);
  if (!ultima) throw new Error(`Nenhum CV gerado para ${vagaId}; rode "cv gerar --vaga ${vagaId}" antes.`);
  const pasta = path.join(dataRoot, 'artifacts', 'cv', vagaId, ultima.hash);
  const payload = JSON.parse(await readFile(path.join(pasta, 'payload.json'), 'utf8'));
  const gate = avaliarGate({ payload, afirmacoes: base.claims, textoAts: extrairTexto(await readFile(path.join(pasta, 'cv-ats.pdf'))) });
  // O evento e o manifesto usam a versão gravada; o resultado novo vale para a projeção e para o painel.
  await atualizarGateNoManifesto(dataRoot, { vagaId, versao: ultima.hash, gate });
  const aprovada = await registrarGate({ dataRoot, vagaId, gate: { ...gate, versao: ultima.hash }, tipoCv: payload.tipo, ts });
  return { versao: ultima.hash, gate, aprovada };
}
