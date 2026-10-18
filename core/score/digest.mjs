// Digest da rodada: só novidades. Falha de fonte nunca vira "sem vagas" e não avança o contador de rodadas sem altas.
import { appendEvents } from '../store/events.mjs';
import { localDay } from '../store/schema.mjs';

// Falha de fonte ou de estágio: a rodada não conferiu tudo, então não prova que "não houve alta".
const falhou = rodada => Boolean(rodada.falha) || (rodada.fontes ?? []).some(fonte => fonte.estado === 'erro');
const naoConferida = rodada => (rodada.fontes ?? []).filter(fonte => fonte.estado === 'erro' || fonte.estado === 'indisponivel');

// Endereço público sem querystring, fragmento nem host local.
export function urlPublica(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || /^(localhost|127\.|10\.|192\.168\.|\[::1\])/.test(parsed.hostname)) return null;
    return `${parsed.origin}${parsed.pathname}`;
  } catch { return null; }
}

const idsDaRodada = rodada => new Set([...(rodada.novas_ids ?? []), ...(rodada.avaliadas_ids ?? [])]);
const novasAltas = (rodada, projecao) => projecao.filter(vaga => idsDaRodada(rodada).has(vaga.id) && vaga.aderencia === 'alta');

// Rodadas consecutivas (da mais recente para trás) sem nova alta. Rodada com falha de fonte não conta nem zera.
export function contarRodadasSemAltas(historico, projecao) {
  let total = 0;
  for (const rodada of historico) {
    if (novasAltas(rodada, projecao).length) { total = 0; continue; }
    if (falhou(rodada)) continue;
    total += 1;
  }
  return total;
}

export function buildDigest({ rodada, projecao, historico = [], processos = [], acompanhamento = [], avaliacoes = [] }) {
  const dia = localDay(rodada.ts);
  const ids = idsDaRodada(rodada);
  const destaque = projecao.filter(vaga => ids.has(vaga.id) && ['alta', 'media'].includes(vaga.aderencia));
  const talvez = projecao.filter(vaga => (rodada.novas_ids ?? []).includes(vaga.id) && vaga.triagem?.decisao === 'talvez' && !vaga.descarte_usuario?.descartada);
  const prazos = rodada.mudancas_prazo ?? [];
  const perguntas = rodada.perguntas_pendentes ?? 0;
  const pendentes = naoConferida(rodada);
  const secoes = [];
  if (destaque.length) {
    secoes.push(`## Novas vagas de alta e média aderência (${destaque.length})`, ...destaque.map(vaga => {
      const url = urlPublica(vaga.url);
      return `- ${vaga.cargo}, ${vaga.empresa} (${vaga.aderencia})${url ? ` - ${url}` : ''}`;
    }));
  }
  if (prazos.length) {
    const porId = new Map(projecao.map(vaga => [vaga.id, vaga]));
    secoes.push('## Mudança de prazo', ...prazos.map(item => `- ${porId.get(item.id)?.cargo ?? item.id}: prazo até ${item.prazo}`));
  }
  const decisoes = [];
  if (talvez.length) decisoes.push(`- ${talvez.length} ${talvez.length === 1 ? 'vaga em "talvez"' : 'vagas em "talvez"'} aguardam sua decisão`);
  if (perguntas) decisoes.push(`- ${perguntas} ${perguntas === 1 ? 'pergunta pendente' : 'perguntas pendentes'} para você responder`);
  if (decisoes.length) secoes.push('## Aguardando você', ...decisoes);

  const listaAcompanhamento = [
    ...(acompanhamento ?? []),
    ...(processos ?? []),
    ...(rodada.acompanhamento ?? []),
  ].filter(p => p && (p.alerta === 'atencao' || p.alerta === 'lembrar'));

  if (listaAcompanhamento.length) {
    secoes.push(
      '## Acompanhamento de processos',
      ...listaAcompanhamento.map(p => {
        const emp = p.empresa ? `${p.empresa} - ` : '';
        const carg = p.cargo ?? p.vaga_id;
        const tag = p.alerta === 'lembrar' ? '🚨 LEMBRAR' : '⚠️ ATENÇÃO';
        return `- ${tag} (${p.dias_inatividade}d sem contato): ${emp}${carg} - Etapa: ${p.etapa_atual ?? 'em andamento'}`;
      })
    );
  }

  const listaAvaliacoes = [
    ...(avaliacoes ?? []),
    ...(rodada.avaliacoes ?? []),
    ...(rodada.avaliacoes_empresas ?? []),
  ].filter(Boolean);

  if (listaAvaliacoes.length) {
    secoes.push(
      `## Avaliações de empresas da rodada (${listaAvaliacoes.length})`,
      ...listaAvaliacoes.map(av => {
        const qtd = av.quantidade != null ? `, ${av.quantidade} avaliações` : '';
        return `- ${av.empresa}: ${av.nota} (${av.plataforma}${qtd})`;
      })
    );
  }

  if (rodada.falha) secoes.unshift('## Rodada interrompida', `- A rodada foi interrompida no estágio ${rodada.falha.estagio}: ${rodada.falha.erro}`);
  const vazio = secoes.length === 0;
  const linhas = [`# Radar de ${dia}`];
  if (vazio) linhas.push(pendentes.length ? 'Sem novidades nas fontes conferidas.' : 'Sem novidades hoje.');
  else linhas.push(...secoes);
  if (pendentes.length) linhas.push('', '## Fontes não conferidas', ...pendentes.map(fonte => `- ${fonte.id}: ${fonte.estado}${fonte.erro ? ` (${fonte.erro})` : ''}`));
  const semAltas = contarRodadasSemAltas([...historico, rodada], projecao);
  return { texto: `${linhas.join('\n')}\n`, vazio, rodadas_sem_altas: semAltas, destaque: destaque.length, nao_conferidas: pendentes.map(fonte => fonte.id) };
}

export async function registrarRodada(dataRoot, dados, now = new Date()) {
  const ts = now.toISOString();
  return appendEvents(dataRoot, [{ id: `rodada:${ts}`, ts, ator: 'radar', tipo: 'radar.rodada', entidade: 'radar', entidade_id: localDay(ts), dados: { ...dados, ts } }], { now: ts });
}
