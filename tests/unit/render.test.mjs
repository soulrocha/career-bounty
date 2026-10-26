import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot } from '../helpers/cli.mjs';
import { makeLegado } from '../fixtures/make-legado.mjs';
import { auditTemplate } from '../../core/privacy/auditTemplate.mjs';
import { buildContext } from '../../core/privacy/scan.mjs';
import { PUBLIC_TEMPLATE } from '../../panel/template.mjs';
import { adaptadores, ativa, relatorioMarkdown, renderPainel } from '../../panel/render.mjs';

const LSEP = String.fromCharCode(0x2028);
const template = await readFile(PUBLIC_TEMPLATE, 'utf8');
const persona = JSON.parse(await readFile(path.join(repoRoot, 'examples/persona-ficticia/identity.yml'), 'utf8'));
const perfil = { nome: persona.nome, especialidade: 'Gestão de equipes de tecnologia', regiao: 'Cidade Exemplo e remoto', aviso: 'Piso e alvo vêm da configuração.', pdfs_base: [{ texto: 'PDF-base', href: 'curriculos/base.pdf' }] };

const limpa = ({ candidatura_usuario, historico_marcacoes, descarte_usuario, historico_descartes, candidatura_email, candidatura_portal, historico, historico_anterior, ...resto }) => resto;
function projecao(extra = []) {
  const base = makeLegado({ vagas: 6, emails: 0, seed: 11 });
  base.vagas = base.vagas.map(limpa).map(v => ({ ...v, url_status: 'aberta', aderencia: 'boa', status: 'avaliada-sem-envio' }));
  base.vagas.push(...extra);
  return base;
}

// Extrai o objeto DATA do HTML gerado com um parser de verdade (acorn não existe aqui: o JSON é lido do script).
function extrairDados(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'exatamente um <script>; nada no dado pode fechar a tag');
  const match = scripts[0][1].match(/^\s*const DATA=([\s\S]*?);\nconst esc=/);
  assert.ok(match, 'marcador const DATA=...');
  return JSON.parse(match[1]);
}

test('o HTML gerado contém os dados das vagas sintéticas, lidos por parser', () => {
  const p = projecao();
  const dados = extrairDados(renderPainel(p, { template, perfil, hoje: '2026-10-14' }));
  assert.deepEqual(dados.vagas, p.vagas);
  assert.deepEqual(dados.perfil, perfil);
  assert.equal(dados.queue, 0);
  assert.deepEqual(dados.historico, []);
});

test('o histórico reúne vagas com candidatura confirmada, por e-mail, portal ou marcação da pessoa', () => {
  const p = projecao([{ id: 'h1', empresa: 'Empresa Beta', cargo: 'X', url_status: 'aberta', candidatura_email: { aplicada: true } }, { id: 'h2', empresa: 'Empresa Gama', cargo: 'Y', url_status: 'aberta', candidatura_usuario: { aplicada: true } }]);
  const dados = extrairDados(renderPainel(p, { template, perfil }));
  assert.deepEqual(dados.historico.map(v => v.id), ['h1', 'h2']);
});

test('os filtros do painel existem no template: aderência, modalidade, regime, portal, candidatura e descarte', () => {
  const html = renderPainel(projecao(), { template, perfil });
  for (const rotulo of ['Filtrar aderência', 'Filtrar modalidade', 'Filtrar regime', 'Filtrar portal de candidatura', 'Filtrar candidatura', 'Filtrar descarte', 'Pesquisar vagas']) {
    assert.match(html, new RegExp(`aria-label="${rotulo}"`), rotulo);
  }
  for (const id of ['fit', 'mode', 'contract', 'portal', 'applied', 'discard']) assert.match(html, new RegExp(`<select id="${id}"`), id);
});

test('o painel abre e limpa os filtros em "Ainda não me candidatei"', () => {
  const html = renderPainel(projecao(), { template, perfil });
  assert.match(html, /<option value="nao" selected>Ainda não me candidatei<\/option>/);
  assert.match(html, /cand: 'nao',/);
  assert.match(html, /S\.cand = 'nao';[\s\S]*?getElementById\('applied'\)\.value = 'nao';/);
});

test('dois renders da mesma projeção produzem bytes idênticos', () => {
  const p = projecao();
  const a = renderPainel(p, { template, perfil, hoje: '2026-10-14' });
  const b = renderPainel(structuredClone(p), { template, perfil, hoje: '2026-10-14' });
  assert.equal(Buffer.compare(Buffer.from(a), Buffer.from(b)), 0);
  assert.notEqual(a, renderPainel(p, { template, perfil, hoje: '2026-10-15' }));
});

test('texto da vaga com </script>, <!-- e padrões de substituição não quebra o HTML', () => {
  const descricao = `<!-- $& $1 $\` -->` + LSEP + 'fim';
  const p = projecao([{ id: 'xss', empresa: 'Empresa Beta', cargo: '</script><script>alert(1)</script>', descricao, url_status: 'aberta', aderencia: 'boa' }]);
  const html = renderPainel(p, { template, perfil: { ...perfil, nome: '</script>Ana' }, hoje: '2026-10-14' });
  const dados = extrairDados(html);
  const vaga = dados.vagas.find(v => v.id === 'xss');
  assert.equal(vaga.cargo, '</script><script>alert(1)</script>');
  assert.equal(vaga.descricao, descricao);
  assert.equal(dados.perfil.nome, '</script>Ana');
  assert.ok(!html.includes('</script><script>alert'));
});

test('o marcador de data é escapado como HTML', () => {
  const html = renderPainel(projecao(), { template, perfil, hoje: '<b>"x"</b>' });
  assert.ok(html.includes('Atualizado em &lt;b&gt;&quot;x&quot;&lt;/b&gt;'));
});

test('template inválido é recusado', () => {
  assert.throws(() => renderPainel(projecao(), { template: '<html></html>' }), /__DATA__/);
});

test('relatório Markdown contém só vagas ativas', () => {
  const extras = [
    { id: 'desc', empresa: 'Empresa Beta', cargo: 'Descartada', url_status: 'aberta', aderencia: 'alta', descarte_usuario: { descartada: true } },
    { id: 'enc', empresa: 'Empresa Beta', cargo: 'Encerrada', url_status: 'encerrada', aderencia: 'alta' },
    { id: 'inc', empresa: 'Empresa Beta', cargo: 'Incompativel', url_status: 'aberta', aderencia: 'incompativel' },
    { id: 'hist', empresa: 'Empresa Beta', cargo: 'Historico', url_status: 'aberta', aderencia: 'alta', candidatura_usuario: { aplicada: true } },
    { id: 'ok', empresa: 'Empresa Beta', cargo: 'Ativa de verdade', url_status: 'aberta', aderencia: 'alta', motivos: ['Faz sentido | com pipe'], url: 'https://vagas.exemplo.test/jobs/1 (2)' },
  ];
  const p = projecao(extras);
  const md = relatorioMarkdown(p, { hoje: '2026-10-14' });
  for (const nome of ['Descartada', 'Encerrada', 'Incompativel', 'Historico']) assert.ok(!md.includes(nome), nome);
  assert.ok(md.includes('Ativa de verdade'));
  assert.ok(md.includes('Faz sentido / com pipe'));
  assert.match(md, /\[Abrir vaga\]\(https:\/\/vagas\.exemplo\.test\/jobs\/1%20%282%29\)/);
  assert.equal(p.vagas.filter(ativa).length, 7);
  assert.match(md, /^# Radar de vagas — 2026-10-14/);
  assert.match(relatorioMarkdown({ vagas: [] }, { hoje: 'x' }), /Nenhuma vaga ativa/);
});

test('o HTML gerado com a persona passa na auditoria do template (nada da identidade real vaza)', () => {
  const html = renderPainel(projecao(), { template, perfil, hoje: '2026-10-14' });
  // contexto de uma identidade DIFERENTE da persona: o render não pode conter dado de ninguém além do perfil fornecido
  const outra = buildContext({ identity: { nome: 'Fulana Inexistente da Silva' } });
  assert.deepEqual(auditTemplate(html, outra).achados, []);
  assert.deepEqual(auditTemplate(html, buildContext()).achados, []);
  assert.ok(!/data:image/.test(html));
});

test('adaptadores derivados do pipeline são determinísticos e escapam o conteúdo', () => {
  const dom = (...parts) => parts.join('.');
  const p = projecao([
    { id: 'l1', empresa: 'Empresa | Beta', cargo: 'Cargo\ncom quebra', url: `https://jobs.${dom('lever', 'co')}/modelo/abc`, status: 'nova' },
    { id: 'l2', empresa: 'Empresa Beta', cargo: 'Outro', url: `https://jobs.${dom('lever', 'co')}/modelo/def`, status: 'nova' },
    { id: 'g1', empresa: 'Empresa Gama', cargo: 'Z', url: `https://boards.${dom('greenhouse', 'io')}/gama/jobs/123456`, status: 'nova' },
  ]);
  const a = adaptadores(p, { hoje: '2026-10-14' });
  assert.deepEqual(Object.keys(a).sort(), ['job_search.md', 'portals.json', 'scan-history.tsv', 'seen_jobs.json']);
  assert.deepEqual(a, adaptadores(structuredClone(p), { hoje: '2026-10-14' }));
  assert.ok(a['job_search.md'].includes('| Empresa / Beta | Cargo com quebra |'));
  assert.ok(!/\tCargo\ncom/.test(a['scan-history.tsv']));
  const portais = JSON.parse(a['portals.json']).tracked_companies;
  assert.deepEqual(portais.map(x => `${x.provider}/${x.slug}`), ['lever/modelo', 'greenhouse/gama']);
  assert.equal(Object.keys(JSON.parse(a['seen_jobs.json'])).length, p.vagas.length);
  assert.match(a['job_search.md'], /^---\ntipo: nota/);
});

test('marcadores no conteúdo não quebram o render: __DATA__ e __STAMP__ vindos de dados ou do selo ficam inertes', () => {
  const armadilha = { id: 'armadilha', empresa: 'Empresa __DATA__ __STAMP__ $& $1 </script>', cargo: 'Gestor', url: 'https://vagas.exemplo.test/x', url_status: 'aberta', aderencia: 'boa', status: 'avaliada-sem-envio' };
  const p = { ...projecao([armadilha]), atualizado: '__DATA__' };
  const html = renderPainel(p, { template, perfil });
  const dados = extrairDados(html);
  assert.deepEqual(dados.vagas, p.vagas);
  assert.equal((html.match(/const DATA=/g) ?? []).length, 1);
  assert.ok(html.includes('__DATA__'), 'o selo aparece como texto, sem virar o payload');
  assert.ok(!html.includes('const DATA=__DATA__'));
  // o selo com marcador nem sequer muda onde o payload entra
  assert.deepEqual(extrairDados(renderPainel(p, { template, perfil, hoje: '2026-10-14' })).vagas, p.vagas);
  // template com o marcador de dado mencionado antes do uso real continua usando só a primeira ocorrência
  assert.throws(() => renderPainel(p, { template: '<html>sem marcador</html>', perfil }), /__DATA__/);
});

test('links de PDF base: o template aceita só curriculos/<arquivo>.pdf relativo e nunca esquema nem ..', () => {
  const esc = template.match(/^const esc=.*$/m)?.[0];
  const rel = template.match(/^const relLink=.*$/m)?.[0];
  assert.ok(esc && rel, 'o template define relLink');
  const relLink = new Function(`${esc}\n${rel}\nreturn relLink;`)();
  assert.match(relLink('curriculos/ats/base.pdf', 'ATS'), /^<a href="\/curriculos\/ats\/base\.pdf"/);
  for (const ruim of ['https://x.test/a.pdf', 'javascript:alert(1)', '//x.test/a.pdf', 'curriculos/../state/a.pdf', 'curriculos/a.txt', 'curriculos\a.pdf', '/curriculos/a.pdf', 'curriculos/a%2e.pdf', '', null]) assert.equal(relLink(ruim, 'x'), '', String(ruim));
  assert.match(template, /materialLinks=.*relLink\(/);
});
