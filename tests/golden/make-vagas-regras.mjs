// Combinações sintéticas para a caracterização das regras puras do refresh.py (F1.10/F1.11).
// Empresas só da lista fictícia; hosts de portais são montados por partes para o fixture não conter URL real literal.
// Uso: node tests/golden/make-vagas-regras.mjs > entrada.json
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const dom = (...parts) => parts.join('.');
const GUPY = dom('gupy', 'io');
const LEVER = dom('lever', 'co');
const GREEN = dom('greenhouse', 'io');
const ASHBY = dom('ashbyhq', 'com');
const INHIRE = dom('inhire', 'app');
const LINKEDIN = dom('linkedin', 'com');
const WORKDAY = dom('myworkdayjobs', 'com');
const DEEL = dom('jobs', 'deel', 'com');
const EVIL = dom('malicioso', 'test');
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64');

const EMPRESAS = ['Empresa Alfa', 'Empresa Beta', 'Empresa Gama', 'Empresa Delta', 'Empresa Épsilon', '', null, 'EMPRESA   alfa', 'Empresa Zeta & Cia', 'Ação Ñandú Ltda'];
const CARGOS = ['Gestor de Tecnologia', 'Líder Técnico', 'Engineering Manager', '', null, 'Coordenação de Operações', 'GERENTE   de Projetos'];

// Fonte única das cidades sintéticas: o gerador Python injeta a mesma lista no refresh.py (ver refresh_sintetico.py).
const REGIAO = JSON.parse(readFileSync(new URL('./regiao-sintetica.json', import.meta.url), 'utf8'));

export const CONFIG = { clt: { onsite_min: 8000, remote_hybrid_min: 7000 }, pj: { min: 12000 }, regiao_presencial: REGIAO };

export function urls() {
  const list = [
    `https://empresa-alfa.${GUPY}/jobs/1234567`, `https://empresa-alfa.${GUPY}/jobs/1234567/`, `HTTPS://EMPRESA-ALFA.${GUPY.toUpperCase()}/jobs/1234567?utm_source=x&id=9`,
    `https://empresa-alfa.${GUPY}/job/${b64({ jobId: 7654321, source: 'portal' })}`, `https://empresa-alfa.${GUPY}/job/${b64({ jobId: 'abc-12' })}`,
    `https://empresa-alfa.${GUPY}/job/${b64({ semId: 1 })}`, `https://empresa-alfa.${GUPY}/job/${b64([1, 2])}`, `https://empresa-alfa.${GUPY}/job/${b64('texto')}`,
    `https://empresa-alfa.${GUPY}/job/naoebase64!!`, `https://empresa-alfa.${GUPY}/job/${b64({ jobId: 99999 }).replace(/=+$/, '')}`, `https://empresa-alfa.${GUPY}/job/${b64({ jobId: 0 })}`,
    `https://empresa-alfa.${GUPY}/job/abcde`, `https://empresa-alfa.${GUPY}/job/${b64({ jobId: 31337 }).replace(/\+/g, '-').replace(/\//g, '_')}`,
    `https://job-boards.eu.${GREEN}/modelo/jobs/1020304050`, `https://job-boards.${GREEN}/modelo/jobs/1020304050`, `https://boards.${GREEN}/modelo?gh_jid=555666777`,
    `https://jobs.${LEVER}/modelo/0a1b2c3d-1111-2222-3333-444455556666`, `https://jobs.${LEVER}/modelo/abc`, `https://jobs.${ASHBY}/modelo/00000000-1111-2222-3333-444444444444`,
    `https://modelo.${INHIRE}/vagas/123456`, `https://${DEEL}/job-boards/modelo/98765432`, `https://www.${LINKEDIN}/jobs/view/3999888777`, `https://www.${LINKEDIN}/jobs/view/3999888777/?refId=1&jk=88`,
    `https://modelo.${WORKDAY}/pt-BR/careers/job/Cidade-Modelo/Gestor_R-12345`, `https://vagas.exemplo.test/jobs/123456`, `https://vagas.exemplo.test/positions/159`, `https://vagas.exemplo.test/posicao/gestor-de-tecnologia`,
    `https://vagas.exemplo.test/?id=12&jobId=3&x=y&jk=a%20b&gh_jid=q+r`, `https://vagas.exemplo.test/p?id=%C3%A7%FF&jobId=`, `https://vagas.exemplo.test/p?id=a&id=b&&=c&jk`, `https://vagas.exemplo.test/a b/c#fragmento`,
    `  https://vagas.exemplo.test/espacos/777777  `, `https://vagas.exemplo.test/tab\tnova\nlinha/888888`, 'vagas.exemplo.test/sem-esquema/555555', '//vagas.exemplo.test/sem-esquema-de-rede/666666', '/caminho/relativo/4444444',
    'mailto:contato@exemplo.test', 'javascript:alert(1)', `javascript:https://a.${GUPY}`, `https://${GUPY}.${EVIL}/jobs/1`, `https://${EVIL}/?url=https%3A%2F%2Fx.${GUPY}`, `https://${GUPY}@${EVIL}`, `https://${EVIL}/${GUPY}`,
    `https://empresa.${GUPY}./jobs/222222`, `https://EMPRESA.${GUPY}:8443/jobs/333333`, `https://usuario:senha@vagas.exemplo.test/jobs/444444`, 'http://[::1]/jobs/123456', 'http://[::1/jobs/1', 'http://::1]/jobs/1', 'http://[nao-ipv6]/x',
    'https://ｅｘｅｍｐｌｏ.test/vaga/101010', 'https://exemplo℀.test/x', 'https://exemplo.test/ação/987654', 'https://exemplo.test/%7Euser/12345678', '', '   ', null, 0, false, 12345,
  ];
  return list;
}

function vagasParaRegras() {
  const out = [];
  let n = 0;
  for (const url of urls()) {
    out.push({ empresa: EMPRESAS[n % EMPRESAS.length], cargo: CARGOS[n % CARGOS.length], url });
    n += 1;
  }
  for (const [empresa, cargo] of [['Empresa Alfa', 'Gestor'], ['Empresa Beta', 'Gestor'], ['Empresa Alfa', 'gestor '], ['empresa alfa', 'GESTOR'], ['Consultoria Exemplo / Empresa Alfa', 'Squad Leader PL']]) {
    out.push({ empresa, cargo, url: 'https://vagas.exemplo.test/positions/159' }, { empresa, cargo }, { empresa, cargo, url: '' });
  }
  out.push({}, { url: null }, { empresa: null, cargo: null, url: null }, { empresa: 7, cargo: 12, url: {} });
  return out;
}

function vagasParaPortal() {
  const out = vagasParaRegras();
  const extra = [];
  for (const job of out.slice(0, 60)) extra.push({ ...job, application_url: `https://jobs.${LEVER}/modelo/destino-1` }, { ...job, application_url: '', url: job.url });
  extra.push({ url: `https://www.${LINKEDIN}/jobs/view/123456`, candidatura_simplificada: true }, { url: `https://www.${LINKEDIN}/jobs/view/123456`, candidatura_simplificada: 'true' },
    { url: `https://www.${LINKEDIN}/jobs/view/123456`, application_url: `https://empresa.${GUPY}/jobs/123456` }, { url: `https://jobs.empresa.test/role`, portal_site_confirmado: true },
    { url: `https://jobs.empresa.test/role`, portal_site_confirmado: 1 }, { url: `https://jobs.empresa.test/role` });
  for (const host of ['solides.com.br', 'solides.jobs', 'recrut.ai', 'workable.com', 'breezy.hr', 'icims.com', 'pandape.info', 'pandape.com.br', 'vagas.com.br', 'careers-page.com', 'myworkdaysite.com', 'smartrecruiters.com', 'successfactors.eu', 'successfactors.com.br', 'quickin.io', 'breezy.hr.test']) {
    extra.push({ url: `https://x.${host}/vaga/1` }, { url: `https://${host}/vaga/1` });
  }
  return [...out, ...extra];
}

function cenariosConstraints() {
  const out = [];
  const modalidades = ['remoto', 'Remoto', 'híbrido', 'hybrid', 'presencial', 'onsite', 'remoto na página', 'desconhecida', 'não informado', 'a confirmar', 'pendente', '', null, undefined, 'Presencial no texto; réplica indica híbrido'];
  const locais = ['Brasil', 'Cidade Modelo', 'Vila Exemplo - Estado', 'São Paulo', 'CM', '', null, 'Outra Cidade'];
  const regimes = ['CLT', 'clt', 'PJ', 'pj', 'Cooperado', '', null, 'CLT ou PJ'];
  const salarios = [null, 6999, 7000, 7500, 7999, 8000, 11999, 12000, 12000.5, 'R$ 9.000', 0];
  for (const modalidade of modalidades) for (const local of locais.slice(0, 5)) for (const regime of regimes.slice(0, 5)) {
    out.push({ modalidade, local, regime, salario: salarios[(out.length * 7) % salarios.length] });
  }
  for (const salario of salarios) for (const regime of ['CLT', 'PJ']) for (const modalidade of ['remoto', 'presencial', 'híbrido']) out.push({ modalidade, local: 'Cidade Modelo', regime, salario });
  for (const regime of ['CLT', 'PJ']) {
    for (const [min, max] of [[5000, 6000], [5000, 7000], [5000, 20000], [20000, 30000], [null, 9000], [9000, null]]) {
      out.push({ modalidade: 'remoto', local: 'Brasil', regime, salario: 9000, salario_min: min, salario_max: max }, { modalidade: 'remoto', regime, salario_min: min, salario_maximo: max });
    }
    out.push({ modalidade: 'remoto', regime, salario_original: { moeda: 'USD', minimo: 1 } }, { modalidade: 'remoto', regime, salario_original: 'texto' }, { modalidade: 'remoto', regime, salario_original: {} }, { modalidade: 'remoto', regime, salario_original: '' });
  }
  for (const elegivel of [false, true, null, undefined]) out.push({ modalidade: 'remoto', regime: 'CLT', salario: 9000, elegivel_brasil: elegivel }, { modalidade: 'híbrido', local: 'Cidade Modelo', regime: 'CLT', elegivel_brasil: elegivel });
  out.push({}, { modalidade: 'presencial', local: 'Cidade Modelo', regime: 'CLT', salario: 8000 }, { modalidade: 'presencial', local: 'Cidade Modelo', regime: 'CLT', salario: 7999 });
  return out;
}

export function casosRegras() {
  const casos = [];
  for (const url of urls()) casos.push({ funcao: 'canonicalUrl', entrada: { url } });
  for (const nome of EMPRESAS) casos.push({ funcao: 'company_key', entrada: { nome } });
  for (const job of vagasParaRegras()) casos.push({ funcao: 'role_key', entrada: { job } }, { funcao: 'id_for', entrada: { job } });
  for (const job of vagasParaPortal()) casos.push({ funcao: 'portal_candidatura', entrada: { job } });
  const configs = [{ ...CONFIG }, { ...CONFIG, cv_skip_portals: ['gupy', 'lever'] }, { ...CONFIG, cv_skip_portals: [] }, { ...CONFIG, cv_skip_portals: ['LEVER', 'Pandapé'] }];
  vagasParaPortal().slice(0, 120).forEach((job, i) => casos.push({ funcao: 'curriculo_necessario', entrada: { job, config: configs[i % configs.length] } }));
  for (const job of cenariosConstraints()) casos.push({ funcao: 'constraints', entrada: { job, config: CONFIG } });
  return casos;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.stdout.write(JSON.stringify(casosRegras()));
