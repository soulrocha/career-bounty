import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { access, readFile, stat as fsStat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { identityStrings } from '../privacy/scan.mjs';
import { activeRules, describeDefaults, loadSettings } from '../config.mjs';

export const CAREER_OPS_TAG = 'v1.36.0';
const defaultRepoRoot = fileURLToPath(new URL('../../', import.meta.url));

// CAREER_BOUNTY_REPO_ROOT permite apontar o clone a diagnosticar (usado nos testes).
function realHooksPath() {
  const repoRoot = process.env.CAREER_BOUNTY_REPO_ROOT || defaultRepoRoot;
  const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoRoot, encoding: 'utf8' });
  if (inside.status !== 0) return null;
  const toplevel = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
  if (realpathSync.native(toplevel) !== realpathSync.native(repoRoot)) return null;
  return spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
}

const exists = filename => access(filename).then(() => true, () => false);

// Diagnóstico somente leitura. Dependências injetáveis para os testes.
export async function runDoctor({
  dataRoot,
  nodeVersion = process.versions.node,
  platform = process.platform,
  hooksPath = realHooksPath,
  stat = fsStat,
} = {}) {
  const settings = await loadSettings({ dataRoot });
  dataRoot = settings.dataRoot;
  const checks = [];
  const add = (id, status, mensagem) => checks.push({ id, status, mensagem });

  const major = Number(nodeVersion.split('.')[0]);
  if (major >= 20) add('node', 'ok', `Node ${nodeVersion}`);
  else add('node', 'falha', `Node ${nodeVersion} é antigo: instale o Node 20 ou superior.`);

  if (await exists(dataRoot)) add('data_root', 'ok', 'DATA_ROOT existe.');
  else add('data_root', 'aviso', 'DATA_ROOT ainda não existe: rode o setup para criar o esqueleto.');

  let identity = null;
  try { identity = JSON.parse(await readFile(path.join(dataRoot, 'identity.yml'), 'utf8')); } catch { /* ausente ou inválido */ }
  if (identity !== null && identityStrings(identity).length) add('identidade', 'ok', 'identity.yml preenchido: a camada pessoal do pre-commit está ativa.');
  else add('identidade', 'aviso', 'identity.yml ausente ou sem valores: o pre-commit roda só as regras genéricas. Rode o setup para criar o modelo e preencha com os seus dados.');

  const engine = path.join(dataRoot, 'engines', 'career-ops');
  let installed = null;
  try { installed = JSON.parse(await readFile(path.join(engine, 'package.json'), 'utf8')).version ?? null; } catch { /* ausente */ }
  if (installed === null) {
    add('career_ops', 'ok', `career-ops não instalado (opcional: só a fonte-ponte usa). Para usar, clone a tag ${CAREER_OPS_TAG} em "${engine}" com git clone --branch.`);
  } else if (`v${installed}` !== CAREER_OPS_TAG) {
    add('career_ops', 'aviso', `career-ops v${installed} instalado; a versão fixada é ${CAREER_OPS_TAG}.`);
  } else add('career_ops', 'ok', `career-ops ${CAREER_OPS_TAG}`);

  const secrets = path.join(dataRoot, 'secrets');
  try {
    const info = await stat(secrets);
    if (platform !== 'win32' && (info.mode & 0o077) !== 0) add('secrets', 'aviso', 'secrets/ está com permissão aberta: rode chmod 700 nessa pasta.');
    else add('secrets', 'ok', 'secrets/ existe.');
  } catch { add('secrets', 'aviso', 'secrets/ ausente: rode o setup.'); }

  const hooks = hooksPath();
  if (hooks === null) add('hooks', 'ok', 'Fora de um clone git: hooks não se aplicam.');
  else if (hooks === '.githooks') add('hooks', 'ok', 'core.hooksPath aponta para .githooks.');
  else add('hooks', 'falha', 'core.hooksPath não aponta para .githooks: rode npm run prepare no clone.');

  const rules = activeRules(settings);
  if (rules.length) add('envio', 'aviso', `ATENÇÃO: ${rules.length} regra(s) de envio automático ativa(s) em config.yml.`);
  else add('envio', 'ok', 'Nenhuma regra de envio automático ativa.');

  const pausado = await exists(path.join(dataRoot, 'envio.pausado'));
  if (pausado) add('kill_switch', 'aviso', 'ATENÇÃO: envio pausado pelo kill switch (envio.pausado presente).');
  else add('kill_switch', 'ok', 'Kill switch desligado (envio liberado).');

  if (settings.fontes.linkedin_guest.ativo) add('linkedin_guest', 'aviso', 'ATENÇÃO: coletor guest do LinkedIn ligado; você respondeu pelos termos de uso do site.');
  else add('linkedin_guest', 'ok', 'Coletor guest do LinkedIn desligado.');

  const migracaoPath = path.join(dataRoot, 'state', 'migration.json');
  try {
    const migracao = JSON.parse(await readFile(migracaoPath, 'utf8'));
    if (migracao.mode === 'ativo') {
      add('migracao', 'ok', 'Modo ativo: migração concluída (corte realizado).');
    } else {
      add('migracao', 'aviso', 'Modo sombra ativo: use migrate --verify para conferir paridade e migrate --corte para ativar.');
    }
  } catch {
    add('migracao', 'ok', 'Sem migração do legado (instalação nova): a gravação já é a definitiva.');
  }

  const perfilCvPath = path.join(dataRoot, 'cv', 'perfil.json');
  try {
    const perfil = JSON.parse(await readFile(perfilCvPath, 'utf8'));
    if (perfil && (perfil.resumo || (Array.isArray(perfil.experiencias) && perfil.experiencias.length > 0))) {
      add('cv_perfil', 'ok', 'Perfil de CV preenchido (cv/perfil.json presente).');
    } else {
      add('cv_perfil', 'aviso', 'cv/perfil.json presente mas sem resumo ou experiências: preencha conforme docs/CV.md.');
    }
  } catch {
    add('cv_perfil', 'aviso', 'Perfil de CV ausente: crie cv/perfil.json com seus dados conforme docs/CV.md (necessário para cv gerar).');
  }

  add('conector_gmail', 'ok', 'informativo: o conector Gmail só pode ser conferido dentro da sessão do Claude (spike F3.1).');

  return { ok: checks.every(c => c.status !== 'falha'), dataRoot, checks, padroes: describeDefaults(settings) };
}
