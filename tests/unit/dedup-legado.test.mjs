// Casamento de vagas coletadas com o legado real: requisicao_id nulo, id legado diferente de idFor, URLs de portal.
// Tudo sintético: empresas fictícias e identificadores inventados.
import assert from 'node:assert/strict';
import test from 'node:test';
import { consolidar, classificar } from '../../core/dedup/consolidar.mjs';
import { chavesCanonicas } from '../../core/dedup/keys.mjs';
import { aplicadaDe } from '../../core/store/rules.mjs';
import { projectEvents } from '../../core/store/project.mjs';
import { makeVaga } from '../../core/sources/vaga.mjs';

const coletada = extra => makeVaga({ fonte: 'x', empresa: 'Empresa Alfa', cargo: 'Gerente de Engenharia', descricao: 'texto', ...extra });
const legada = (id, extra) => ({ id, empresa: 'Empresa Alfa', cargo: 'Gerente de Engenharia', status: 'avaliada-sem-envio', requisicao_id: null, ...extra });
const situacaoDe = (vagaColetada, legados) => classificar(consolidar([vagaColetada]), legados)[0].situacao;
const UUID = '0b3f5c1e-8a2d-4e6f-9c7b-1d2e3f4a5b6c';
const gupyCodificada = n => `https://empresa-alfa.gupy.io/job/${Buffer.from(JSON.stringify({ jobId: n, source: 'x' })).toString('base64')}`;

test('Gupy: URL codificada ou direta do legado casa com a coleta, mesmo com id legado e requisicao_id nulo', () => {
  const coleta = coletada({ portal: 'gupy', requisicao_id: '5550001', url: 'https://empresa-alfa.gupy.io/jobs/5550001' });
  assert.equal(situacaoDe(coleta, [legada('alfa-antigo-1', { url: gupyCodificada(5550001), candidatura_usuario: { aplicada: true } })]), 'aplicada');
  assert.equal(situacaoDe(coleta, [legada('alfa-antigo-2', { url: 'https://empresa-alfa.gupy.io/jobs/5550001?jobBoardSource=gupy_public_page', descarte_usuario: { descartada: true } })]), 'descartada');
});

test('Greenhouse, Lever, Inhire e Solides: URL do legado vira a mesma chave de portal da coleta', () => {
  const casos = [
    [{ portal: 'greenhouse', requisicao_id: '7654321', url: 'https://job-boards.greenhouse.io/empresa-alfa/jobs/7654321' }, 'https://eu.greenhouse.io/empresa-alfa/jobs/7654321?gh_jid=7654321'],
    [{ portal: 'lever', requisicao_id: UUID, url: `https://jobs.lever.co/empresa-alfa/${UUID}` }, `https://jobs.lever.co/empresa-alfa/${UUID}/apply`],
    [{ portal: 'inhire', requisicao_id: UUID, url: `https://empresa-alfa.inhire.app/vagas/${UUID}` }, `https://x.inhire.app/empresa-alfa/vagas/${UUID}/gerente-de-engenharia`],
    [{ portal: 'solides', requisicao_id: '445566', url: 'https://vagas.solides.com.br/vaga/445566' }, 'https://empresa-alfa.vagas.solides.com.br/vaga/445566-gerente-de-engenharia'],
  ];
  for (const [coleta, urlLegada] of casos) {
    assert.equal(situacaoDe(coletada(coleta), [legada('legado-x', { url: urlLegada, comprovante_envio: 'protocolo 123' })]), 'aplicada', coleta.portal);
  }
});

test('flags importadas do legado contam como aplicada: usuário, e-mail, portal, status confirmado, histórico e comprovante', () => {
  for (const flags of [{ candidatura_usuario: { aplicada: true } }, { candidatura_email: { aplicada: true } }, { candidatura_portal: { aplicada: true } },
    { status: 'candidatura-enviada-confirmada' }, { historico: true }, { comprovante_envio: 'recibo' }, { comprovante_envio: { numero: '1' } }]) {
    assert.equal(aplicadaDe(legada('a', flags)), true, JSON.stringify(flags));
  }
  for (const flags of [{}, { comprovante_envio: '' }, { comprovante_envio: {} }, { candidatura_usuario: { aplicada: false } }]) {
    assert.equal(aplicadaDe(legada('b', flags)), false, JSON.stringify(flags));
  }
});

test('requisicao_id do legado em texto livre ou sem portal também gera chave', () => {
  assert.ok(chavesCanonicas(legada('l', { url: 'https://www.linkedin.com/jobs/view/4400000009/' })).includes('linkedin:4400000009'));
  assert.ok(chavesCanonicas(legada('l', { url: 'https://br.linkedin.com/jobs/view/gerente-de-engenharia-4400000009' })).includes('linkedin:4400000009'));
  assert.ok(chavesCanonicas(legada('l', { requisicao_id: 'LinkedIn 4400000009; identificador no portal oficial não localizado.' })).includes('linkedin:4400000009'));
  assert.ok(chavesCanonicas(legada('l', { requisicao_id: '5550001', url: 'https://empresa-alfa.gupy.io/jobs/5550001' })).includes('gupy:5550001'));
  assert.ok(chavesCanonicas(legada('l', { requisicao_id: 'greenhouse.io:99887', url: 'https://x.test/y' })).includes('greenhouse:99887'));
  assert.deepEqual(chavesCanonicas(legada('l', { url: 'https://carreiras.exemplo.test/vaga/abc' })), []);
});

test('vaga só avaliada no legado continua conhecida; sem relação com o legado é nova', () => {
  const coleta = coletada({ portal: 'gupy', requisicao_id: '5550001', url: 'https://empresa-alfa.gupy.io/jobs/5550001' });
  assert.equal(situacaoDe(coleta, [legada('a', { url: 'https://empresa-alfa.gupy.io/jobs/5550001' })]), 'conhecida');
  assert.equal(situacaoDe(coleta, [legada('b', { url: 'https://empresa-alfa.gupy.io/jobs/9990009', candidatura_usuario: { aplicada: true } })]), 'nova');
});

test('aplicada sem chave utilizável (sem URL, ou só LinkedIn) vira pendente de conferência, não nova', () => {
  const coleta = coletada({ portal: 'gupy', requisicao_id: '5550001', url: 'https://empresa-alfa.gupy.io/jobs/5550001' });
  const semUrl = legada('sem-url', { url: '', candidatura_usuario: { aplicada: true } });
  const soLinkedin = legada('so-linkedin', { url: 'https://www.linkedin.com/jobs/view/4400000009/', descarte_usuario: { descartada: true } });
  for (const legado of [semUrl, soLinkedin]) {
    const [item] = classificar(consolidar([coleta]), [legado]);
    assert.equal(item.situacao, 'pendente_conferencia');
    assert.equal(item.conferir_com, legado.id);
  }
  assert.equal(situacaoDe(coletada({ portal: 'gupy', requisicao_id: '5550001', cargo: 'Analista Contábil', url: 'https://empresa-alfa.gupy.io/jobs/5550001' }), [semUrl]), 'nova', 'cargo diferente não gera pendência');
  assert.equal(situacaoDe(coleta, [legada('so-avaliada', { url: '' })]), 'nova', 'só vaga aplicada ou descartada gera pendência');
});

test('aparição por outra URL da coleta (LinkedIn) casa com o legado pelo id do LinkedIn', () => {
  const aparicao = coletada({ fonte: 'linkedin_guest', portal: 'linkedin', requisicao_id: '4400000009', url: 'https://www.linkedin.com/jobs/view/gerente-4400000009', aparicao: true });
  assert.equal(situacaoDe(aparicao, [legada('l', { url: 'https://br.linkedin.com/jobs/view/4400000009/', candidatura_usuario: { aplicada: true } })]), 'aplicada');
});

const importado = vagas => ({ id: 'legado:1', ts: '2026-10-01T10:00:00.000Z', ator: 'migracao', tipo: 'legado.importado', entidade: 'pipeline', entidade_id: 'p', dados: { legado: { schema_version: 1, atualizado: '2026-10-01', vagas } } });
const descoberta = (id, vaga) => ({ id: `d:${id}`, ts: '2026-10-10T10:00:00.000Z', ator: 'radar', tipo: 'vaga.descoberta', entidade: 'vaga', entidade_id: id, dados: { vaga, aparicoes: [{ fonte: vaga.fonte, url: vaga.url }] } });

test('herança: republicação de vaga que o legado marcou como descartada ou aplicada herda a marca; vagas legadas entre si não mudam', () => {
  const descartada = legada('alfa-desc', { url: gupyCodificada(5550001), descarte_usuario: { descartada: true, registrado_em: '2026-09-01T10:00:00-03:00' } });
  const aplicada = legada('alfa-apl', { url: `https://jobs.lever.co/empresa-alfa/${UUID}`, comprovante_envio: 'recibo' });
  const gemea = legada('alfa-gemea', { url: 'https://empresa-alfa.gupy.io/jobs/5550001' });
  const projetado = projectEvents([
    importado([descartada, aplicada, gemea]),
    descoberta('nova-1', coletada({ portal: 'gupy', requisicao_id: '5550001', url: 'https://empresa-alfa-novo.gupy.io/jobs/5550001' })),
    descoberta('nova-2', coletada({ portal: 'lever', requisicao_id: UUID, url: `https://jobs.lever.co/empresa-alfa/${UUID}/apply` })),
  ]).vagas;
  const por = id => projetado.find(v => v.id === id);
  assert.equal(por('nova-1').descarte_usuario.descartada, true);
  assert.equal(por('nova-1').descarte_usuario.herdado_de, 'alfa-desc');
  assert.equal(por('nova-2').candidatura_herdada.aplicada, true);
  assert.equal(por('nova-2').candidatura_herdada.herdado_de, 'alfa-apl');
  assert.equal(aplicadaDe(por('nova-2')), true);
  assert.equal(por('alfa-gemea').descarte_usuario, undefined, 'vaga legada nunca herda de outra legada (sombra segue sem diferença)');
  assert.equal(por('alfa-apl').candidatura_herdada, undefined);
});
