// core/store/projections/historico.mjs
// Projeção pura do histórico e linha do tempo cronológica por vaga.
// Reúne descobertas, candidaturas, contatos, etapas, encerramentos e descartes.

import { localDay } from '../schema.mjs';
import { normalizarEtapaEmail } from '../../mail/reducer.mjs';
import { aplicadaDe } from '../rules.mjs';

export function projectHistorico(eventos = [], { inicio, fim, situacao, portal, now = new Date() } = {}) {
  const hoje = localDay(now);
  const vagasMap = new Map();
  const contatosMap = new Map();

  function obterVaga(vagaId) {
    if (!vagasMap.has(vagaId)) {
      vagasMap.set(vagaId, {
        vaga_id: vagaId,
        empresa: null,
        cargo: null,
        portal: null,
        situacao_processo: 'ativo',
        desfecho: null,
        ultimo_movimento: hoje,
        linha_do_tempo: [],
        itens: [],
      });
    }
    const v = vagasMap.get(vagaId);
    v.itens = v.linha_do_tempo;
    return v;
  }

  // Primeiro passo: identificar dados preliminares das vagas para metadados
  for (const evento of eventos) {
    const d = evento.dados ?? {};
    if (evento.tipo === 'vaga.descoberta') {
      const v = d.vaga ?? d;
      const vaga = obterVaga(evento.entidade_id);
      vaga.empresa = v.empresa ?? vaga.empresa;
      vaga.cargo = v.cargo ?? vaga.cargo;
      vaga.portal = v.portal ?? v.portal_origem ?? vaga.portal;
    } else if (evento.tipo === 'vaga.importada' && d.legado) {
      const vaga = obterVaga(evento.entidade_id);
      vaga.empresa = d.legado.empresa ?? vaga.empresa;
      vaga.cargo = d.legado.cargo ?? vaga.cargo;
      vaga.portal = d.legado.portal ?? d.legado.portal_origem ?? vaga.portal;
    }
  }

  // Segundo passo: ordenar cronologicamente por ts
  const ordenados = [...eventos].sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''));

  for (const evento of ordenados) {
    const d = evento.dados ?? {};
    const tipo = evento.tipo;

    if (tipo === 'vaga.descoberta') {
      const v = d.vaga ?? d;
      const vaga = obterVaga(evento.entidade_id);
      vaga.empresa = v.empresa ?? vaga.empresa;
      vaga.cargo = v.cargo ?? vaga.cargo;
      vaga.portal = v.portal ?? v.portal_origem ?? vaga.portal;
      const data = localDay(evento.ts);
      vaga.linha_do_tempo.push({
        id: evento.id,
        tipo: 'descoberta',
        origem: evento.ator ?? 'radar',
        data,
        ts: evento.ts,
        titulo: v.cargo ? `Vaga descoberta: ${v.cargo}` : 'Vaga descoberta',
        detalhe: v.url ?? null,
      });
    } else if (tipo === 'vaga.importada' && d.legado) {
      const vaga = obterVaga(evento.entidade_id);
      vaga.empresa = d.legado.empresa ?? vaga.empresa;
      vaga.cargo = d.legado.cargo ?? vaga.cargo;
      vaga.portal = d.legado.portal ?? d.legado.portal_origem ?? vaga.portal;
      if (aplicadaDe(d.legado) || d.legado.candidatura_usuario?.aplicada) {
        const dataCand = d.legado.candidatura_usuario?.data || d.legado.data || localDay(evento.ts);
        vaga.situacao_processo = 'aguardando_retorno';
        vaga.linha_do_tempo.push({
          id: evento.id,
          tipo: 'candidatura',
          origem: evento.ator ?? 'painel',
          data: dataCand,
          ts: evento.ts,
          titulo: 'Candidatura registrada',
          detalhe: 'Candidatura importada do histórico',
        });
      }
    } else if (tipo === 'candidatura.marcada') {
      const vaga = obterVaga(evento.entidade_id);
      const dataCand = d.data ?? localDay(evento.ts);
      if (d.aplicada) {
        if (vaga.situacao_processo !== 'encerrado') {
          vaga.situacao_processo = 'aguardando_retorno';
        }
        vaga.linha_do_tempo.push({
          id: evento.id,
          tipo: 'candidatura',
          origem: evento.ator ?? 'painel',
          data: dataCand,
          ts: evento.ts,
          titulo: 'Candidatura registrada',
          detalhe: 'Candidatura enviada/marcada',
        });
      } else {
        vaga.linha_do_tempo.push({
          id: evento.id,
          tipo: 'candidatura',
          origem: evento.ator ?? 'painel',
          data: dataCand,
          ts: evento.ts,
          titulo: 'Candidatura desmarcada',
          detalhe: 'Candidatura desmarcada',
        });
      }
    } else if (tipo === 'contato.registrado') {
      const contatoId = evento.entidade_id || d.id;
      const dataContato = d.data ?? localDay(evento.ts);
      const itemContato = {
        id: contatoId,
        tipo: 'contato',
        origem: evento.ator ?? (d.direcao === 'recebido' ? 'recrutador' : 'candidato'),
        canal: d.canal,
        direcao: d.direcao,
        data: dataContato,
        ts: evento.ts,
        titulo: d.pessoa?.nome ? `Contato com ${d.pessoa.nome}` : `Contato via ${d.canal ?? 'canal'}`,
        resumo: d.resumo ?? null,
        detalhe: d.resumo ?? null,
        pergunta: d.pergunta ?? null,
        proxima_etapa: d.proxima_etapa ?? null,
        pessoa: d.pessoa ?? null,
        endereco: d.endereco ?? null,
      };
      contatosMap.set(contatoId, { ...d, item: itemContato, ts: evento.ts });
      if (d.vaga_id) {
        const vaga = obterVaga(d.vaga_id);
        if (vaga.situacao_processo !== 'encerrado') {
          if (d.pergunta || d.proxima_etapa) {
            vaga.situacao_processo = 'aguardando_voce';
          } else if (d.direcao === 'enviado') {
            vaga.situacao_processo = 'aguardando_retorno';
          }
        }
        vaga.linha_do_tempo.push({ ...itemContato });
      }
    } else if (tipo === 'contato.vinculado') {
      const cId = d.contato_id || evento.entidade_id;
      const c = contatosMap.get(cId);
      if (c && d.vaga_id) {
        c.vaga_id = d.vaga_id;
        const vaga = obterVaga(d.vaga_id);
        if (vaga.situacao_processo !== 'encerrado') {
          if (c.pergunta || c.proxima_etapa) {
            vaga.situacao_processo = 'aguardando_voce';
          } else if (c.direcao === 'enviado') {
            vaga.situacao_processo = 'aguardando_retorno';
          }
        }
        if (!vaga.linha_do_tempo.some(it => it.id === cId)) {
          vaga.linha_do_tempo.push({ ...c.item });
        }
      }
    } else if (tipo === 'contato.removido') {
      const cId = d.contato_id || evento.entidade_id;
      contatosMap.delete(cId);
      for (const vaga of vagasMap.values()) {
        vaga.linha_do_tempo = vaga.linha_do_tempo.filter(it => it.id !== cId);
        vaga.itens = vaga.linha_do_tempo;
      }
    } else if (tipo === 'processo.etapa') {
      const vagaId = d.vaga_id || evento.entidade_id;
      const vaga = obterVaga(vagaId);
      const dataEtapa = d.data ?? localDay(evento.ts);
      if (vaga.situacao_processo !== 'encerrado') {
        vaga.situacao_processo = (d.etapa === 'teste') ? 'aguardando_voce' : 'aguardando_retorno';
      }
      vaga.linha_do_tempo.push({
        id: evento.id,
        tipo: 'etapa',
        origem: evento.ator ?? 'cli',
        etapa: d.etapa,
        data: dataEtapa,
        ts: evento.ts,
        titulo: `Etapa: ${d.etapa}`,
        detalhe: d.detalhe ?? null,
      });
    } else if (tipo === 'processo.encerrado') {
      const vagaId = d.vaga_id || evento.entidade_id;
      const vaga = obterVaga(vagaId);
      vaga.situacao_processo = 'encerrado';
      vaga.desfecho = d.desfecho;
      const dataFim = d.data ?? localDay(evento.ts);
      vaga.linha_do_tempo.push({
        id: evento.id,
        tipo: 'desfecho',
        origem: evento.ator ?? 'cli',
        desfecho: d.desfecho,
        data: dataFim,
        ts: evento.ts,
        titulo: `Processo encerrado: ${d.desfecho}`,
        detalhe: d.nota ?? null,
        nota: d.nota ?? null,
      });
    } else if (tipo === 'email.recebido') {
      const vagaId = d.vaga_id || evento.entidade_id;
      if (vagaId) {
        const vaga = obterVaga(vagaId);
        const dataEmail = d.data_email ?? localDay(evento.ts);
        const etapaNorm = normalizarEtapaEmail(d.etapa);
        if (etapaNorm === 'encerrado' || d.etapa === 'negativa' || d.etapa === 'encerrada') {
          vaga.situacao_processo = 'encerrado';
          vaga.desfecho = 'reprovado';
          vaga.linha_do_tempo.push({
            id: evento.id,
            tipo: 'desfecho',
            origem: 'email',
            desfecho: 'reprovado',
            data: dataEmail,
            ts: evento.ts,
            titulo: 'E-mail de negativa',
            assunto: d.assunto ?? null,
            detalhe: d.assunto ? `E-mail de negativa: ${d.assunto}` : 'E-mail de negativa recebido',
          });
        } else {
          if (vaga.situacao_processo !== 'encerrado') {
            vaga.situacao_processo = (etapaNorm === 'teste') ? 'aguardando_voce' : 'ativo';
          }
          vaga.linha_do_tempo.push({
            id: evento.id,
            tipo: 'etapa',
            origem: 'email',
            etapa: etapaNorm,
            data: dataEmail,
            ts: evento.ts,
            titulo: d.assunto ? `E-mail recebido: ${d.assunto}` : 'E-mail recebido',
            assunto: d.assunto ?? null,
            detalhe: d.assunto ?? null,
          });
        }
      }
    } else if (tipo === 'vaga.descartada') {
      const vagaId = evento.entidade_id || d.vaga_id;
      if (vagaId) {
        const vaga = obterVaga(vagaId);
        vaga.situacao_processo = 'encerrado';
        vaga.desfecho = vaga.desfecho ?? 'descartada';
        const dataDesc = d.data ?? localDay(evento.ts);
        vaga.linha_do_tempo.push({
          id: evento.id,
          tipo: 'descarte',
          origem: evento.ator ?? 'painel',
          data: dataDesc,
          ts: evento.ts,
          titulo: 'Vaga descartada',
          detalhe: d.motivo ?? 'Vaga descartada',
          motivo: d.motivo ?? null,
        });
      }
    }
  }

  // Finalização de cada vaga: ordenar linha do tempo cronologicamente e calcular ultimo_movimento
  const listaCompleta = [];
  for (const vaga of vagasMap.values()) {
    vaga.linha_do_tempo.sort((a, b) =>
      a.data.localeCompare(b.data) || (a.ts ?? '').localeCompare(b.ts ?? '')
    );
    vaga.itens = vaga.linha_do_tempo;
    const datas = vaga.linha_do_tempo.map(item => item.data).filter(Boolean);
    vaga.ultimo_movimento = datas.at(-1) ?? hoje;
    listaCompleta.push(vaga);
  }

  // Aplicar filtros puros
  let filtradas = listaCompleta;

  if (portal) {
    filtradas = filtradas.filter(v => v.portal && v.portal.toLowerCase() === portal.toLowerCase());
  }

  if (situacao) {
    filtradas = filtradas.filter(v => v.situacao_processo === situacao);
  }

  if (inicio) {
    filtradas = filtradas.filter(v => v.ultimo_movimento >= inicio);
  }

  if (fim) {
    filtradas = filtradas.filter(v => v.ultimo_movimento <= fim);
  }

  // Ordenação por último movimento DESC (mais recente primeiro)
  filtradas.sort((a, b) =>
    b.ultimo_movimento.localeCompare(a.ultimo_movimento) || b.vaga_id.localeCompare(a.vaga_id)
  );

  const totais = {
    total: filtradas.length,
    ativos: filtradas.filter(v => v.situacao_processo === 'ativo').length,
    aguardando_retorno: filtradas.filter(v => v.situacao_processo === 'aguardando_retorno').length,
    aguardando_voce: filtradas.filter(v => v.situacao_processo === 'aguardando_voce').length,
    encerrados: filtradas.filter(v => v.situacao_processo === 'encerrado').length,
  };

  return {
    historico: filtradas,
    totais,
    total: filtradas.length,
  };
}
