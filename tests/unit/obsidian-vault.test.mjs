import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, run, tempDir } from '../helpers/cli.mjs';
import { createObsidianVault } from '../../core/kb/sources/obsidianVault.mjs';
import { carregarFontes } from '../../core/kb/fontes.mjs';
import { lerBase } from '../../core/kb/base.mjs';

async function nota(raiz, relativo, texto) {
  await mkdir(path.dirname(path.join(raiz, relativo)), { recursive: true });
  await writeFile(path.join(raiz, relativo), texto);
}

// Vault falso pequeno: duas notas de arco, uma de outro contexto, uma sem frontmatter, um modelo de CV e uma nota fora do manifesto.
async function vaultFalso(t) {
  const raiz = await tempDir(t, 'vault-falso-');
  await nota(raiz, '50-Resultados/arco-a.md', '---\ntipo: resultado\ncontexto: trabalho\nnivel_prova: entregue\nafirmacoes: [AF-101, AF-104]\n---\n# Arco A\nTexto longo do arco A que nunca deve sair daqui.\n');
  await nota(raiz, '50-Resultados/arco-b.md', '---\ntipo: resultado\ncontexto: trabalho\nnivel_prova: relato\n---\n# Arco B\nSem afirmações ligadas.\n');
  await nota(raiz, '50-Resultados/outro-contexto.md', '---\ntipo: resultado\ncontexto: pessoal-reservado\nnivel_prova: relato\n---\n# Reservado\nNão pode sair.\n');
  await nota(raiz, '50-Resultados/sem-front.md', '# Nota sem frontmatter\nTexto.\n');
  await nota(raiz, '50-Resultados/afirmacao-solta.md', '---\nid: AF-900\nnivel_prova: verificado\nuso: [CV]\ncontexto: trabalho\n---\nEntregou o painel fictício em 3 semanas.\n');
  await nota(raiz, '10-Pessoal/cv/base.txt', 'RESUMO\n• Item de CV fictício.\n');
  await nota(raiz, 'fora-do-manifesto.md', '---\nid: AF-999\nnivel_prova: verificado\n---\nNunca deve ser lida.\n');
  const manifesto = {
    contextos_permitidos: ['trabalho'],
    notas: [
      { caminho: '50-Resultados/arco-a.md', papel: 'arco' },
      { caminho: '50-Resultados/arco-b.md', papel: 'arco' },
      { caminho: '50-Resultados/outro-contexto.md', papel: 'arco' },
      { caminho: '50-Resultados/sem-front.md', papel: 'arco' },
      { caminho: '50-Resultados/afirmacao-solta.md', papel: 'afirmacao' },
      { caminho: '10-Pessoal/cv/base.txt', papel: 'modelo_cv', modelo: 'base-ats' },
    ],
  };
  return { raiz, manifesto };
}

test('só as notas do manifesto são lidas; a nota fora dele nunca é aberta', async t => {
  const { raiz, manifesto } = await vaultFalso(t);
  const abertos = [];
  const vault = createObsidianVault({ raiz, manifesto, lerArquivo: async arquivo => { abertos.push(path.relative(raiz, arquivo).replaceAll('\\', '/')); return readFile(arquivo, 'utf8'); } });
  await vault.claims();
  await vault.arcs();
  await vault.cvTemplates();
  assert.ok(abertos.length > 0);
  assert.ok(!abertos.includes('fora-do-manifesto.md'));
  assert.ok(abertos.every(a => manifesto.notas.some(n => n.caminho === a)), abertos.join(','));
});

test('frontmatter de afirmação e de arco vira o mesmo contrato do markdown-folder', async t => {
  const { raiz, manifesto } = await vaultFalso(t);
  const vault = createObsidianVault({ raiz, manifesto });
  const [af] = await vault.claims();
  assert.deepEqual([af.id, af.nivel_prova, af.uso, af.texto, af.arquivo], ['AF-900', 'verificado', ['CV'], 'Entregou o painel fictício em 3 semanas.', '50-Resultados/afirmacao-solta.md']);
  assert.deepEqual(Object.keys(af).sort(), ['arquivo', 'empresa', 'id', 'nivel_prova', 'numeros', 'origem', 'periodo', 'publicavel', 'texto', 'uso']);
  const arcos = await vault.arcs();
  assert.deepEqual(arcos.map(a => [a.id, a.titulo, a.afirmacoes]), [['arco-a', 'Arco A', ['AF-101', 'AF-104']], ['arco-b', 'Arco B', []]]);
  assert.ok(arcos.every(a => !('texto' in a)), 'o corpo do arco não sai do adaptador');
  const [cv] = await vault.cvTemplates();
  assert.deepEqual([cv.modelo, cv.formato, cv.texto.includes('Item de CV')], ['base-ats', 'txt', true]);
});

test('caminho com .. ou absoluto no manifesto é recusado', async t => {
  const { raiz } = await vaultFalso(t);
  for (const caminho of ['../fora.md', '50-Resultados/../../fora.md', path.join(raiz, '50-Resultados/arco-a.md'), '/etc/passwd', 'C:\\Windows\\win.ini', '50-Resultados\\..\\x.md']) {
    assert.throws(() => createObsidianVault({ raiz, manifesto: { notas: [{ caminho, papel: 'arco' }] } }), /caminho.*recusado/i, caminho);
  }
  assert.throws(() => createObsidianVault({ raiz, manifesto: { notas: [{ caminho: 'a.md', papel: 'desconhecido' }] } }), /papel/);
  assert.throws(() => createObsidianVault({ raiz: 'relativa', manifesto: { notas: [] } }), /raiz.*absoluto/);
});

test('o adaptador não tem método nem import de escrita', async () => {
  const vault = createObsidianVault({ raiz: path.resolve('.'), manifesto: { notas: [] } });
  assert.deepEqual(Object.keys(vault).sort(), ['arcs', 'avisos', 'claims', 'cvTemplates', 'identity']);
  assert.ok(Object.keys(vault).every(nome => !/write|save|delete|remove|append|put|update|set|copy|move/i.test(nome)));
  const fonte = await readFile(path.join(repoRoot, 'core', 'kb', 'sources', 'obsidianVault.mjs'), 'utf8');
  assert.ok(!/writeFile|appendFile|unlink|rmdir|\brm\b|rename|mkdir|copyFile|createWriteStream|truncate/.test(fonte));
});

test('nota sem frontmatter é ignorada com aviso; nota de outro contexto nunca é devolvida', async t => {
  const { raiz, manifesto } = await vaultFalso(t);
  const vault = createObsidianVault({ raiz, manifesto });
  const arcos = await vault.arcs();
  assert.ok(!arcos.some(a => a.id === 'sem-front' || a.id === 'outro-contexto'));
  const avisos = vault.avisos();
  assert.ok(avisos.some(a => /sem-front\.md.*sem frontmatter/.test(a)), avisos.join('|'));
  assert.ok(avisos.some(a => /outro-contexto\.md.*contexto/.test(a)));
  const todo = JSON.stringify([await vault.claims(), arcos, await vault.cvTemplates()]);
  assert.ok(!todo.includes('Não pode sair'));
  assert.ok(!todo.includes('nunca deve sair daqui'));
});

test('contexto padrão é só pessoal: sem a lista no manifesto, o contexto de trabalho não passa', async t => {
  const { raiz, manifesto } = await vaultFalso(t);
  const vault = createObsidianVault({ raiz, manifesto: { notas: manifesto.notas } });
  assert.deepEqual(await vault.arcs(), []);
  assert.deepEqual(await vault.claims(), []);
});

test('nota listada que não existe vira aviso, não erro', async t => {
  const { raiz } = await vaultFalso(t);
  const vault = createObsidianVault({ raiz, manifesto: { notas: [{ caminho: 'nao-existe.md', papel: 'arco' }] } });
  assert.deepEqual(await vault.arcs(), []);
  assert.match(vault.avisos()[0], /nao-existe\.md.*não encontrada/);
});

test('a raiz e o manifesto vêm só do DATA_ROOT: config.yml (vault_root) e fontes.yml', async t => {
  const { raiz, manifesto } = await vaultFalso(t);
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  await cp(path.join(repoRoot, 'tests', 'fixtures', 'kb-quadrantes'), path.join(dataRoot, 'kb'), { recursive: true });
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ vault_root: raiz }));
  await writeFile(path.join(dataRoot, 'fontes.yml'), JSON.stringify({ versao: 1, obsidian_vault: manifesto }));
  const { fontes } = await carregarFontes({ dataRoot });
  assert.deepEqual(fontes.map(f => f.nome), ['markdown-folder', 'obsidian-vault']);
  const base = await lerBase(fontes);
  assert.deepEqual(base.arcos.map(a => a.id), ['arco-a', 'arco-b']);
  assert.ok(base.claims.some(c => c.id === 'AF-900') && base.claims.some(c => c.id === 'AF-101'));
  assert.ok(base.avisos.some(a => /obsidian-vault: .*sem-front\.md/.test(a)));
  assert.equal(base.cvTemplates[0].modelo, 'base-ats');
  // arco que aponta afirmação inexistente na base é erro nomeado
  await nota(raiz, '50-Resultados/arco-b.md', '---\ntipo: resultado\ncontexto: trabalho\nafirmacoes: [AF-777]\n---\n# Arco B\n');
  await assert.rejects(lerBase(fontes), /arco-b\.md.*AF-777/);
});

test('fontes.yml inválido: chave desconhecida, raiz dentro do DATA_ROOT ou ausente', async t => {
  const { raiz, manifesto } = await vaultFalso(t);
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  await writeFile(path.join(dataRoot, 'fontes.yml'), JSON.stringify({ versao: 1, qualquer: {} }));
  await assert.rejects(carregarFontes({ dataRoot }), /fontes\.yml.*qualquer/);
  await writeFile(path.join(dataRoot, 'fontes.yml'), JSON.stringify({ versao: 1, obsidian_vault: manifesto }));
  await assert.rejects(carregarFontes({ dataRoot }), /raiz do vault/i);
  await writeFile(path.join(dataRoot, 'fontes.yml'), JSON.stringify({ versao: 1, obsidian_vault: { ...manifesto, raiz: path.join(dataRoot, 'kb') } }));
  await assert.rejects(carregarFontes({ dataRoot }), /DATA_ROOT/);
  await writeFile(path.join(dataRoot, 'fontes.yml'), '{nao-json');
  await assert.rejects(carregarFontes({ dataRoot }), /fontes\.yml.*JSON/);
  await writeFile(path.join(dataRoot, 'fontes.yml'), JSON.stringify({ versao: 1, obsidian_vault: { ...manifesto, raiz } }));
  assert.equal((await carregarFontes({ dataRoot })).fontes.length, 2);
});
