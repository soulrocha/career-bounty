// Cenários sintéticos de reconsolidação (pipeline antigo + pesquisas novas) para a golden de refresh.py `_merged`.
// Uso: node tests/golden/make-cenarios-merge.mjs > cenarios.json
import { pathToFileURL } from 'node:url';
import { CONFIG } from './make-vagas-regras.mjs';

const dom = (...parts) => parts.join('.');
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64');
const URLS = [
  `https://empresa-alfa.${dom('gupy', 'io')}/jobs/111111`, `https://empresa-alfa.${dom('gupy', 'io')}/job/${b64({ jobId: 111111 })}`,
  `https://job-boards.eu.${dom('greenhouse', 'io')}/modelo/jobs/2222222222`, `https://job-boards.${dom('greenhouse', 'io')}/modelo/jobs/2222222222`,
  `https://jobs.${dom('lever', 'co')}/modelo/0a1b2c3d-1111-2222-3333-444455556666`, 'https://vagas.exemplo.test/posicao/a', 'https://vagas.exemplo.test/posicao/b', 'https://vagas.exemplo.test/jobs/333333', '',
];
const DESTINOS = [undefined, undefined, `https://jobs.${dom('lever', 'co')}/modelo/destino`, `https://empresa-alfa.${dom('gupy', 'io')}/jobs/999999`];
const EMPRESAS = ['Empresa Alfa', 'Empresa Beta', 'Empresa Gama', 'Empresa Delta'];
const DATAS = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
const ESTADOS = ['encerrada', 'link-invalido', 'link-indisponivel', 'portal-indisponivel', 'pendente-captcha', 'pendente-usuario', 'enviada', 'concluida', ''];

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function gerador(seed) {
  const random = rng(seed);
  const pick = list => list[Math.floor(random() * list.length)];
  const chance = p => random() < p;
  const vaga = ({ antiga }) => {
    const job = { empresa: pick(EMPRESAS), cargo: pick(['Gestor de Tecnologia', 'Líder Técnico', 'Engineering Manager']), url: pick(URLS), modalidade: pick(['remoto', 'híbrido', 'presencial', 'remoto']), local: pick(['Brasil', 'Cidade Modelo', 'São Paulo']), regime: pick(['CLT', 'PJ', 'CLT']), salario: pick([null, 6000, 7000, 8000, 12000]), aderencia: pick(['alta', 'boa', 'condicional', 'alta']), url_status: pick(['aberta', 'aberta', 'encerrada', 'nao-confirmada']) };
    if (chance(0.5)) job.consultado_em = pick(DATAS);
    if (chance(0.3)) job.application_url = pick(DESTINOS.filter(Boolean));
    if (chance(0.6)) job.fontes = [pick(['freehire', 'web', 'lista-a']), pick(['freehire', 'web'])];
    if (chance(0.5)) job.descricao_completa = 'x'.repeat(Math.floor(random() * 20));
    if (chance(0.4)) job.requisitos = [{ tipo: pick(['obrigatorio', 'desejavel']), avaliacao: pick(['atendido', 'nao-atendido']) }];
    if (chance(0.3)) job.pendencias = [pick(['Confirmar piso', 'Confirmar regime'])];
    if (chance(0.2)) job.lacunas = [pick(['a', 'b'])];
    if (chance(0.2)) job.id = `id-${Math.floor(random() * 5)}`;
    if (antiga) {
      job.id = job.id ?? `antigo-${Math.floor(random() * 1000)}`;
      if (chance(0.7)) job.status = pick(['avaliada-sem-envio', 'candidatura-enviada-confirmada', 'candidatura-enviada-informada-pelo-usuario', 'anuncio-encerrado', '']);
      if (chance(0.3)) job.candidatura_usuario = { aplicada: chance(0.7), data: '2026-10-07', origem: 'usuario-no-painel' };
      if (chance(0.2)) job.candidatura_email = { aplicada: chance(0.7), data: '2026-10-03' };
      if (chance(0.2)) job.candidatura_portal = { aplicada: chance(0.7), data: '2026-10-02' };
      if (chance(0.3)) job.execucao_candidatura = { estado: pick(ESTADOS), data: pick(DATAS), motivo: pick(['', 'Aguardando usuário', 'Captcha']) };
      if (chance(0.3)) job.comprovante_envio = { recibo: 'original' };
      if (chance(0.2)) job.curriculo = 'enviado.pdf';
      if (chance(0.2)) job.historico_marcacoes = [{ original: true }];
      if (chance(0.15)) job.descarte_usuario = { descartada: chance(0.5) };
      if (chance(0.1)) job.candidatura_simplificada = true;
      if (chance(0.1)) job.portal_site_confirmado = true;
    }
    return job;
  };
  return { vaga, random, pick, chance };
}

// Os cinco casos de test_rules.py (data da observação do destino × URL anterior).
function casosDestino() {
  const velho = `https://old.${dom('gupy', 'io')}/jobs/123456`;
  const novo = `https://jobs.${dom('lever', 'co')}/company/abc`;
  const base = { empresa: 'Empresa Alfa', cargo: 'Manager', url: 'https://exemplo.test/jobs/123456', regime: 'CLT', modalidade: 'remoto', local: 'Brasil', salario: null };
  return [['2026-10-08', novo, velho], ['2026-10-08', null, velho], ['2026-10-06', novo, velho], ['2026-10-07', novo, velho], ['2026-10-06', novo, null]].map(([data, url, anterior], i) => {
    const protegidos = { curriculo: 'sent.pdf', comprovante_envio: { recibo: 'original' }, candidatura_usuario: { aplicada: true, data: '2026-10-07' }, historico_marcacoes: [{ original: true }], descarte_usuario: { descartada: true }, historico_descartes: [{ original: true }] };
    const antiga = { ...base, ...protegidos, id: 'original', consultado_em: '2026-10-07', status: 'candidatura-enviada-confirmada', ...(anterior ? { application_url: anterior } : {}) };
    const nova = { ...base, consultado_em: data, url_status: 'aberta', aderencia: 'boa', ...(url ? { application_url: url } : {}) };
    return { nome: `destino-${i + 1}`, pipeline: { schema_version: 1, vagas: [antiga] }, historico: null, pesquisas: [{ nome: 'pesquisa-fixture.json', mtime: '2026-10-09', vagas: [nova] }], ajustes: [], config: CONFIG, hoje: '2026-10-14' };
  });
}

// Estados de execução da candidatura × marcação da pessoa × data da consulta.
function casosExecucao() {
  const base = { empresa: 'Empresa Beta', cargo: 'Gestor', url: 'https://vagas.exemplo.test/jobs/333333', regime: 'CLT', modalidade: 'remoto', local: 'Brasil', salario: 9000 };
  const lista = [];
  for (const estado of ESTADOS) for (const aplicada of [false, true]) for (const consulta of ['2026-10-04', '2026-10-05', '2026-10-07']) {
    const antiga = { ...base, id: 'exec', ...(aplicada ? { candidatura_usuario: { aplicada: true } } : {}), execucao_candidatura: { estado, data: '2026-10-05', motivo: estado ? 'Motivo sintético' : '' } };
    lista.push({ nome: `execucao-${estado || 'vazio'}-${aplicada ? 'aplicada' : 'livre'}-${consulta}`, pipeline: { schema_version: 1, vagas: [antiga] }, historico: [], pesquisas: [{ nome: 'pesquisa-a.json', mtime: consulta, vagas: [{ ...base, consultado_em: consulta, url_status: 'aberta', aderencia: 'alta' }] }], ajustes: [], config: CONFIG, hoje: '2026-10-14' });
  }
  return lista;
}

export function cenarios() {
  const lista = [...casosDestino(), ...casosExecucao()];
  for (let seed = 1; seed <= 160; seed += 1) {
    const g = gerador(seed);
    const antigas = Array.from({ length: Math.floor(g.random() * 4) }, () => g.vaga({ antiga: true }));
    const arquivos = Array.from({ length: 1 + Math.floor(g.random() * 3) }, (_, i) => ({ nome: `pesquisa-${String.fromCharCode(97 + i)}.json`, mtime: g.pick(DATAS), vagas: Array.from({ length: 1 + Math.floor(g.random() * 4) }, () => g.vaga({ antiga: false })), cobertura: g.chance(0.3) ? [{ consulta: 'x', fonte: 'web' }] : undefined }));
    const ajustes = g.chance(0.4) ? [{ ...g.vaga({ antiga: false }), aderencia: g.pick(['alta', 'boa']), lacunas: ['nova'], pendencias: ['Confirmar piso'] }] : [];
    const historico = g.chance(0.4) ? antigas.slice(0, 1).map(v => ({ ...v })) : null;
    lista.push({ nome: `aleatorio-${seed}`, pipeline: { schema_version: 1, vagas: antigas }, historico, pesquisas: arquivos, ajustes, config: seed % 7 === 0 ? { ...CONFIG, cv_skip_portals: [] } : CONFIG, hoje: '2026-10-14' });
  }
  return lista;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.stdout.write(JSON.stringify(cenarios()));
