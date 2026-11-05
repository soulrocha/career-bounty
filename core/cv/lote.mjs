// CV automático depois da avaliação: toda vaga que chega ao painel com aderência alta, boa, média ou condicional
// já tem os PDFs. Baixa, incompatível e pendente ficam sob demanda (botão do painel ou `cv gerar`).
import { curriculoNecessario } from '../apply/portal.mjs';
import { gerarCvDaVaga } from './gerar.mjs';
import { lerManifesto } from './artifacts.mjs';
import { encontrarNavegador } from './navegador.mjs';

export const ADERENCIAS_CV_AUTOMATICO = new Set(['alta', 'boa', 'media', 'condicional']);

export function vagasParaCvAutomatico(vagas, { comCv, settings }) {
  return vagas.filter(v => ADERENCIAS_CV_AUTOMATICO.has(v.aderencia)
    && v.url_status !== 'encerrada'
    && !v.candidatura_usuario?.aplicada
    && !v.descarte_usuario?.descartada
    && v.curriculo_necessario !== false && curriculoNecessario(v, settings)
    && !comCv.has(v.id));
}

export async function vagasComCv(dataRoot, vagas) {
  const ids = new Set();
  for (const v of vagas) {
    try { if (await lerManifesto(dataRoot, v.id)) ids.add(v.id); } catch {}
  }
  return ids;
}

// Uma vaga por vez (cada uma abre o navegador para os PDFs). Falha de uma vaga vira item em `falhas` e não para o lote.
// Sem navegador (a VM não tem), nenhuma vaga conseguiria o PDF: o lote nem começa.
export async function gerarCvsAutomaticos({ dataRoot, settings, vagas, comCv, gerar = gerarCvDaVaga, navegador = encontrarNavegador() }) {
  const resultado = { gerados: [], bloqueados: [], falhas: [] };
  if (!navegador) return { ...resultado, pulado: 'sem_navegador' };
  for (const v of vagasParaCvAutomatico(vagas, { comCv: comCv ?? await vagasComCv(dataRoot, vagas), settings })) {
    try {
      const r = await gerar({ dataRoot, settings, vagaId: v.id });
      if (!r.gerado) continue;
      (r.gate.status === 'ok' ? resultado.gerados : resultado.bloqueados).push(v.id);
    } catch (error) {
      resultado.falhas.push({ id: v.id, erro: String(error.message ?? error).slice(0, 200) });
    }
  }
  return resultado;
}
