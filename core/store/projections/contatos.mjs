// core/store/projections/contatos.mjs
// Projeção pura de contatos com recrutadores.
// Transforma a sequência de eventos contato.registrado e contato.vinculado em visão estruturada.

import { localDay } from '../schema.mjs';

function diferencaDias(diaA, diaB) {
  if (!diaA || !diaB) return 0;
  const tA = Date.parse(`${diaA}T12:00:00Z`);
  const tB = Date.parse(`${diaB}T12:00:00Z`);
  return Math.max(0, Math.round((tB - tA) / 86400000));
}

export function projectContatos(eventos, { now = new Date() } = {}) {
  const contatosMap = new Map();
  const hoje = localDay(now);

  for (const evento of eventos) {
    if (evento.tipo === 'contato.registrado') {
      const d = evento.dados;
      const id = evento.entidade_id || d.id;
      contatosMap.set(id, {
        id,
        vaga_id: d.vaga_id ?? null,
        canal: d.canal,
        direcao: d.direcao,
        pessoa: d.pessoa ? { nome: d.pessoa.nome ?? null, papel: d.pessoa.papel ?? null } : null,
        nome: d.pessoa?.nome ?? null,
        papel: d.pessoa?.papel ?? null,
        resumo: d.resumo,
        pergunta: d.pergunta ?? null,
        proxima_etapa: d.proxima_etapa ? { texto: d.proxima_etapa.texto, data: d.proxima_etapa.data ?? null } : null,
        data: d.data,
        endereco: d.endereco ?? null,
        registrado_em: evento.ts,
      });
    } else if (evento.tipo === 'contato.vinculado') {
      const contato = contatosMap.get(evento.dados?.contato_id || evento.entidade_id);
      if (contato) {
        contato.vaga_id = evento.dados?.vaga_id;
      }
    } else if (evento.tipo === 'contato.removido') {
      const id = evento.dados?.contato_id || evento.entidade_id;
      contatosMap.delete(id);
    }
  }

  // Lista ordenada por data e ts
  const lista = [...contatosMap.values()].sort((a, b) =>
    a.data.localeCompare(b.data) || a.registrado_em.localeCompare(b.registrado_em)
  );

  const porVaga = {};
  const porPessoa = {};

  for (const c of lista) {
    const quemFalou = c.direcao === 'enviado' ? 'candidato' : 'recrutador';
    const dias = diferencaDias(c.data, hoje);

    c.ultimo_contato = c.data;
    c.dias_desde_ultimo_contato = dias;
    c.quem_falou_por_ultimo = quemFalou;

    // Agrupamento por vaga
    if (c.vaga_id) {
      if (!porVaga[c.vaga_id]) {
        porVaga[c.vaga_id] = {
          vaga_id: c.vaga_id,
          total: 0,
          ultimo_contato: c.data,
          dias_desde_ultimo_contato: dias,
          quem_falou_por_ultimo: quemFalou,
          contatos: [],
        };
      }
      const grupoVaga = porVaga[c.vaga_id];
      grupoVaga.total += 1;
      grupoVaga.ultimo_contato = c.data;
      grupoVaga.dias_desde_ultimo_contato = dias;
      grupoVaga.quem_falou_por_ultimo = quemFalou;
      grupoVaga.contatos.push(c);
    }

    // Agrupamento por pessoa
    const chavePessoa = c.nome ? c.nome.trim().toLowerCase().replace(/\s+/g, '-') : c.id;
    if (!porPessoa[chavePessoa]) {
      porPessoa[chavePessoa] = {
        nome: c.nome ?? 'Sem nome',
        papel: c.papel ?? null,
        total: 0,
        ultimo_contato: c.data,
        dias_desde_ultimo_contato: dias,
        quem_falou_por_ultimo: quemFalou,
        contatos_ids: [],
      };
    }
    const grupoPessoa = porPessoa[chavePessoa];
    grupoPessoa.total += 1;
    grupoPessoa.ultimo_contato = c.data;
    grupoPessoa.dias_desde_ultimo_contato = dias;
    grupoPessoa.quem_falou_por_ultimo = quemFalou;
    grupoPessoa.contatos_ids.push(c.id);
  }

  return {
    contatos: lista,
    por_vaga: porVaga,
    por_pessoa: porPessoa,
    total: lista.length,
  };
}
