// core/store/projections/processos.mjs
// Projeção pura de processos seletivos e acompanhamento.
// Agrega candidaturas, e-mails, contatos e etapas em visão única do funil.

import { localDay } from '../schema.mjs';
import { normalizarEtapaEmail } from '../../mail/reducer.mjs';
import {
  ORDEM_ETAPAS_PROCESSO,
  aplicadaDe,
} from '../rules.mjs';

function diferencaDias(diaA, diaB) {
  if (!diaA || !diaB) return 0;
  const tA = Date.parse(`${diaA}T12:00:00Z`);
  const tB = Date.parse(`${diaB}T12:00:00Z`);
  return Math.max(0, Math.round((tB - tA) / 86400000));
}

export function projectProcessos(eventos, { now = new Date(), config = {} } = {}) {
  const hoje = localDay(now);
  const diasAviso = config?.acompanhamento?.dias_aviso ?? 5;
  const diasLembrete = config?.acompanhamento?.dias_lembrete ?? 7;

  const processosMap = new Map();
  const vagasMeta = new Map();
  const contatosMap = new Map();

  function obterProcesso(vagaId) {
    if (!processosMap.has(vagaId)) {
      const meta = vagasMeta.get(vagaId) ?? {};
      processosMap.set(vagaId, {
        vaga_id: vagaId,
        empresa: meta.empresa ?? null,
        cargo: meta.cargo ?? null,
        etapa_atual: 'aplicada',
        situacao: 'ativo',
        desfecho: null,
        alerta: 'normal',
        quem_falou_por_ultimo: null,
        ultima_interacao_data: null,
        dias_inatividade: 0,
        eventos: [],
      });
    }
    const p = processosMap.get(vagaId);
    if (!p.empresa && vagasMeta.has(vagaId)) {
      p.empresa = vagasMeta.get(vagaId).empresa ?? p.empresa;
      p.cargo = vagasMeta.get(vagaId).cargo ?? p.cargo;
    }
    return p;
  }

  // Primeiro passo: mapear metadados de vagas e contatos para vinculações
  for (const evento of eventos) {
    const d = evento.dados ?? {};
    if (evento.tipo === 'vaga.importada' && d.legado) {
      vagasMeta.set(evento.entidade_id, {
        empresa: d.legado.empresa ?? null,
        cargo: d.legado.cargo ?? null,
      });
    } else if (evento.tipo === 'vaga.descoberta') {
      vagasMeta.set(evento.entidade_id, {
        empresa: d.empresa ?? null,
        cargo: d.cargo ?? null,
      });
    }
  }

  // Segundo passo: processar eventos cronologicamente
  const ordenados = [...eventos].sort((a, b) =>
    (a.ts ?? '').localeCompare(b.ts ?? '')
  );

  for (const evento of ordenados) {
    const d = evento.dados ?? {};
    const tipo = evento.tipo;

    if (tipo === 'vaga.importada' && d.legado) {
      if (aplicadaDe(d.legado)) {
        const p = obterProcesso(evento.entidade_id);
        p.empresa = d.legado.empresa ?? p.empresa;
        p.cargo = d.legado.cargo ?? p.cargo;
        const dataCand = d.legado.candidatura_usuario?.data
          || d.legado.candidatura_email?.data
          || d.legado.data
          || localDay(evento.ts);
        if (d.legado.candidatura_email?.etapa) {
          p.etapa_atual = normalizarEtapaEmail(d.legado.candidatura_email.etapa) ?? p.etapa_atual;
        }
        p.situacao = 'aguardando_retorno';
        p.quem_falou_por_ultimo = 'candidato';
        p.eventos.push({
          tipo: 'candidatura.marcada',
          data: dataCand,
          ts: evento.ts,
          detalhe: 'Candidatura importada do histórico',
        });
      }
    } else if (tipo === 'candidatura.marcada') {
      if (d.aplicada) {
        const p = obterProcesso(evento.entidade_id);
        p.etapa_atual = 'aplicada';
        p.situacao = 'aguardando_retorno';
        p.quem_falou_por_ultimo = 'candidato';
        p.eventos.push({
          tipo: 'candidatura.marcada',
          data: d.data ?? localDay(evento.ts),
          ts: evento.ts,
          detalhe: 'Candidatura registrada',
        });
      }
    } else if (tipo === 'email.recebido') {
      const vagaId = d.vaga_id || evento.entidade_id;
      if (vagaId) {
        const p = obterProcesso(vagaId);
        const dataEmail = d.data_email ?? localDay(evento.ts);
        const etapaNorm = normalizarEtapaEmail(d.etapa);
        p.quem_falou_por_ultimo = 'empresa';
        if (etapaNorm === 'encerrado' || d.etapa === 'negativa' || d.etapa === 'encerrada') {
          p.situacao = 'encerrado';
          p.desfecho = 'reprovado';
          p.eventos.push({
            tipo: 'email.recebido',
            data: dataEmail,
            ts: evento.ts,
            etapa: 'encerrado',
            detalhe: d.assunto ? `E-mail de negativa: ${d.assunto}` : 'E-mail de negativa recebido',
          });
        } else {
          if (etapaNorm && ORDEM_ETAPAS_PROCESSO.includes(etapaNorm)) {
            const idxAtual = ORDEM_ETAPAS_PROCESSO.indexOf(p.etapa_atual);
            const idxNova = ORDEM_ETAPAS_PROCESSO.indexOf(etapaNorm);
            if (idxNova > idxAtual) {
              p.etapa_atual = etapaNorm;
            }
          }
          p.situacao = (etapaNorm === 'teste') ? 'aguardando_voce' : 'ativo';
          p.eventos.push({
            tipo: 'email.recebido',
            data: dataEmail,
            ts: evento.ts,
            etapa: etapaNorm,
            detalhe: d.assunto ? `E-mail recebido: ${d.assunto}` : 'E-mail recebido',
          });
        }
      }
    } else if (tipo === 'contato.registrado') {
      const contatoId = evento.entidade_id || d.id;
      contatosMap.set(contatoId, { ...d, ts: evento.ts });
      if (d.vaga_id) {
        const p = obterProcesso(d.vaga_id);
        const dataContato = d.data ?? localDay(evento.ts);
        const quem = d.direcao === 'enviado' ? 'candidato' : 'empresa';
        p.quem_falou_por_ultimo = quem;
        if (p.situacao !== 'encerrado') {
          if (d.direcao === 'recebido') {
            p.situacao = (d.pergunta || d.proxima_etapa) ? 'aguardando_voce' : 'ativo';
          } else {
            p.situacao = 'aguardando_retorno';
          }
        }
        p.eventos.push({
          tipo: 'contato.registrado',
          data: dataContato,
          ts: evento.ts,
          canal: d.canal,
          direcao: d.direcao,
          resumo: d.resumo,
          detalhe: d.resumo,
          pergunta: d.pergunta ?? null,
          proxima_etapa: d.proxima_etapa ?? null,
        });
      }
    } else if (tipo === 'contato.vinculado') {
      const cId = d.contato_id || evento.entidade_id;
      const c = contatosMap.get(cId);
      if (c && d.vaga_id) {
        c.vaga_id = d.vaga_id;
        const p = obterProcesso(d.vaga_id);
        const dataContato = c.data ?? localDay(evento.ts);
        const quem = c.direcao === 'enviado' ? 'candidato' : 'empresa';
        p.quem_falou_por_ultimo = quem;
        if (p.situacao !== 'encerrado') {
          if (c.direcao === 'recebido') {
            p.situacao = (c.pergunta || c.proxima_etapa) ? 'aguardando_voce' : 'ativo';
          } else {
            p.situacao = 'aguardando_retorno';
          }
        }
        p.eventos.push({
          tipo: 'contato.registrado',
          data: dataContato,
          ts: c.ts ?? evento.ts,
          canal: c.canal,
          direcao: c.direcao,
          resumo: c.resumo,
          detalhe: c.resumo,
        });
      }
    } else if (tipo === 'processo.etapa') {
      const vagaId = d.vaga_id || evento.entidade_id;
      const p = obterProcesso(vagaId);
      const dataEtapa = d.data ?? localDay(evento.ts);
      p.etapa_atual = d.etapa;
      p.quem_falou_por_ultimo = 'candidato';
      if (p.situacao !== 'encerrado') {
        p.situacao = (d.etapa === 'teste') ? 'aguardando_voce' : 'aguardando_retorno';
      }
      p.eventos.push({
        tipo: 'processo.etapa',
        data: dataEtapa,
        ts: evento.ts,
        etapa: d.etapa,
        detalhe: d.detalhe ?? null,
      });
    } else if (tipo === 'processo.encerrado') {
      const vagaId = d.vaga_id || evento.entidade_id;
      const p = obterProcesso(vagaId);
      const dataFim = d.data ?? localDay(evento.ts);
      p.situacao = 'encerrado';
      p.desfecho = d.desfecho;
      p.eventos.push({
        tipo: 'processo.encerrado',
        data: dataFim,
        ts: evento.ts,
        desfecho: d.desfecho,
        nota: d.nota ?? null,
        detalhe: d.nota ?? null,
      });
    } else if (tipo === 'vaga.descartada') {
      const vagaId = evento.entidade_id || d.vaga_id;
      if (processosMap.has(vagaId)) {
        const p = processosMap.get(vagaId);
        if (p.situacao !== 'encerrado') {
          p.situacao = 'encerrado';
          p.desfecho = p.desfecho ?? 'descartada';
          p.eventos.push({
            tipo: 'vaga.descartada',
            data: localDay(evento.ts),
            ts: evento.ts,
            detalhe: 'Vaga descartada',
          });
        }
      }
    }
  }

  // Finalização e cálculos para cada processo
  const processosLista = [];

  for (const p of processosMap.values()) {
    // Ordenar histórico de eventos cronologicamente
    p.eventos.sort((a, b) =>
      a.data.localeCompare(b.data) || (a.ts ?? '').localeCompare(b.ts ?? '')
    );

    const datas = p.eventos.map(e => e.data).filter(Boolean).sort();
    p.ultima_interacao_data = datas.at(-1) ?? hoje;
    p.dias_inatividade = diferencaDias(p.ultima_interacao_data, hoje);

    if (p.situacao === 'encerrado') {
      p.alerta = 'normal';
    } else if (p.dias_inatividade >= diasLembrete) {
      p.alerta = 'lembrar';
    } else if (p.dias_inatividade >= diasAviso) {
      p.alerta = 'atencao';
    } else {
      p.alerta = 'normal';
    }

    processosLista.push(p);
  }

  // Ordenar processos: primeiro os não encerrados com maior inatividade, depois encerrados
  processosLista.sort((a, b) => {
    if (a.situacao === 'encerrado' && b.situacao !== 'encerrado') return 1;
    if (a.situacao !== 'encerrado' && b.situacao === 'encerrado') return -1;
    return b.dias_inatividade - a.dias_inatividade;
  });

  const pendentes = processosLista.filter(
    p => p.situacao !== 'encerrado' && p.alerta !== 'normal'
  );

  const totais = {
    total: processosLista.length,
    ativos: processosLista.filter(p => p.situacao !== 'encerrado').length,
    aguardando_retorno: processosLista.filter(p => p.situacao === 'aguardando_retorno').length,
    aguardando_voce: processosLista.filter(p => p.situacao === 'aguardando_voce').length,
    encerrados: processosLista.filter(p => p.situacao === 'encerrado').length,
    atencao: processosLista.filter(p => p.situacao !== 'encerrado' && p.alerta === 'atencao').length,
    lembrar: processosLista.filter(p => p.situacao !== 'encerrado' && p.alerta === 'lembrar').length,
  };

  return {
    processos: processosLista,
    pendentes,
    totais,
  };
}
