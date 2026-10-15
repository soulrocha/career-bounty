import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, run, tempDir } from '../helpers/cli.mjs';
import { git } from '../helpers/git.mjs';
import { flattenStrings } from '../../core/privacy/scan.mjs';
import { loadSettings, validateSettings } from '../../core/config.mjs';

async function withConfig(t, config) {
  const dataRoot = await tempDir(t);
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify(config));
  return dataRoot;
}

test('config.example.yml valida no schema e só traz placeholders e padrões', async () => {
  const example = JSON.parse(await readFile(path.join(repoRoot, 'config.example.yml'), 'utf8'));
  const settings = validateSettings(example);
  assert.equal(settings.envio.padrao, 'parar_antes_de_enviar');
  assert.equal(settings.fontes.linkedin_guest.ativo, false);
  for (const value of flattenStrings(example)) {
    assert.match(value, /^(<[^>]+>|parar_antes_de_enviar|confirmar_lote)$/, `valor não-placeholder: ${value}`);
  }
});

test('apply plan com a config padrão nunca devolve enviar_automatico', async t => {
  const dataRoot = await tempDir(t);
  const result = run(['apply', 'plan', '--json'], { dataRoot });
  assert.equal(result.status, 0);
  assert.equal(result.json.acao, 'parar_antes_de_enviar');
  assert.notEqual(result.json.acao, 'enviar_automatico');
});

test('linkedin_guest só liga com aceite_termos no mesmo bloco', async t => {
  const ligado = { fontes: { linkedin_guest: { ativo: true } } };
  await assert.rejects(loadSettings({ dataRoot: await withConfig(t, ligado) }), /linkedin_guest.*aceite_termos.*termos/is);
  const aceito = { fontes: { linkedin_guest: { ativo: true, aceite_termos: true } } };
  assert.equal((await loadSettings({ dataRoot: await withConfig(t, aceito) })).fontes.linkedin_guest.ativo, true);
  const soAceite = { fontes: { linkedin_guest: { aceite_termos: true } } };
  assert.equal((await loadSettings({ dataRoot: await withConfig(t, soAceite) })).fontes.linkedin_guest.ativo, false);
});

test('regra de envio enviar_automatico sem limite_dia é recusada', async t => {
  const semLimite = { envio: { regras: [{ id: 'r1', acao: 'enviar_automatico' }] } };
  await assert.rejects(loadSettings({ dataRoot: await withConfig(t, semLimite) }), /envio\.regras\[0\].*limite_dia/);
  const limiteRuim = { envio: { regras: [{ id: 'r1', acao: 'enviar_automatico', limite_dia: 0 }] } };
  await assert.rejects(loadSettings({ dataRoot: await withConfig(t, limiteRuim) }), /limite_dia/);
  const ok = { envio: { regras: [{ id: 'r1', acao: 'enviar_automatico', limite_dia: 5 }] } };
  assert.equal((await loadSettings({ dataRoot: await withConfig(t, ok) })).envio.regras.length, 1);
});

test('o repositório ignora e não contém config.yml, identity.yml, denylist.txt nem secrets/', () => {
  for (const name of ['config.yml', 'identity.yml', 'privacy/denylist.txt', 'secrets/token.txt']) {
    assert.equal(git(repoRoot, ['check-ignore', '-q', name]).status, 0, `${name} deveria estar no .gitignore`);
  }
  const tracked = git(repoRoot, ['ls-files']).stdout.split('\n').filter(Boolean);
  const forbidden = tracked.filter(f => /(^|\/)(config\.yml|denylist\.txt)$/.test(f) || /(^|\/)secrets\//.test(f) || (/(^|\/)identity\.yml$/.test(f) && !f.startsWith('examples/persona-ficticia/')));
  assert.deepEqual(forbidden, []);
});

test('doctor imprime os padrões ativos em uma linha', async t => {
  const dataRoot = await tempDir(t);
  const text = run(['doctor'], { dataRoot });
  assert.match(text.stdout, /^envio: manual; LinkedIn guest: desligado$/m);
  assert.equal(run(['doctor', '--json'], { dataRoot }).json.padroes, 'envio: manual; LinkedIn guest: desligado');
  const ligado = await withConfig(t, { fontes: { linkedin_guest: { ativo: true, aceite_termos: true } }, envio: { regras: [{ id: 'r', acao: 'enviar_automatico', limite_dia: 3 }] } });
  assert.equal(run(['doctor', '--json'], { dataRoot: ligado }).json.padroes, 'envio: automático (1 regra ativa); LinkedIn guest: ligado');
});
