// core/company/daily.mjs
// Seleção inteligente de empresas e orquestração de avaliações no daily-run.
import { companyKey } from '../dedup/keys.mjs';
import { readEvents } from '../store/events.mjs';
import { projectEvents } from '../store/project.mjs';
import { projectAvaliacoes } from '../store/projections/avaliacoes.mjs';
import { avaliarEmpresa } from './evaluator.mjs';

export function selecionarEmpresasParaAvaliar({ vagas, projAvaliacoes, settings }) {
  const aderenciasAlvo = new Set(settings?.avaliacoes?.aderencias_alvo ?? ['alta', 'boa']);
  const teto = settings?.avaliacoes?.teto_diario ?? 5;
  const mapaPorEmpresa = projAvaliacoes?.por_empresa ?? {};

  const selecionadas = [];
  const vistas = new Set();

  for (const vaga of vagas ?? []) {
    if (!vaga?.empresa) continue;
    if (vaga.descarte_usuario?.descartada) continue;
    if (vaga.url_status && vaga.url_status !== 'aberta') continue;
    if (!aderenciasAlvo.has(vaga.aderencia)) continue;

    const chave = companyKey(vaga.empresa);
    if (!chave || vistas.has(chave)) continue;
    vistas.add(chave);

    const avaliacaoExistente = mapaPorEmpresa[chave];
    if (avaliacaoExistente && avaliacaoExistente.valida) {
      continue; // Já possui avaliação vigente
    }

    selecionadas.push({ empresa: vaga.empresa, empresa_chave: chave });
    if (selecionadas.length >= teto) break;
  }

  return selecionadas;
}

export async function executarAvaliacoesDaily({ dataRoot, settings, runner, now = new Date(), searchImpl }) {
  const { eventos } = await readEvents(dataRoot);
  const doc = projectEvents(eventos, { now });
  const projAvaliacoes = projectAvaliacoes(eventos, { now });

  const candidatas = selecionarEmpresasParaAvaliar({
    vagas: doc.vagas ?? [],
    projAvaliacoes,
    settings
  });

  const avaliadas = [];
  const falhas = [];

  for (const { empresa } of candidatas) {
    try {
      const dados = await avaliarEmpresa({
        empresa,
        dataRoot,
        runner,
        searchImpl,
        now
      });
      avaliadas.push(dados);
    } catch (error) {
      falhas.push({ empresa, erro: error.message });
    }
  }

  return {
    candidatas,
    avaliadas,
    falhas
  };
}
