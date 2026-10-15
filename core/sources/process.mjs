// Processo externo das fontes opcionais: ambiente limpo, tempo limite e saída limitada.
import { spawn } from 'node:child_process';
import { SourceError } from './index.mjs';

const ENV_PERMITIDO = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'windir', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL'];

// Ambiente sem credencial: só o mínimo para o processo achar seus executáveis, mais o que o chamador definir.
export function cleanEnv(extra = {}, base = process.env) {
  const env = {};
  for (const name of ENV_PERMITIDO) if (base[name] !== undefined) env[name] = base[name];
  return { ...env, ...extra };
}

export function runProcess(comando, args, { env, cwd, timeoutMs = 120000, maxBytes = 20 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(comando, args, { env, cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { reject(new SourceError('indisponivel', `não foi possível iniciar o processo: ${error.message}`)); return; }
    let stdout = '';
    let stderr = '';
    let excedeu = false;
    const timer = setTimeout(() => { child.kill(); reject(new SourceError('timeout', `processo excedeu ${timeoutMs} ms`)); }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > maxBytes) { excedeu = true; child.kill(); } });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', error => { clearTimeout(timer); reject(new SourceError(error.code === 'ENOENT' ? 'indisponivel' : 'erro', error.code === 'ENOENT' ? 'executável não encontrado' : `falha ao iniciar o processo: ${error.code ?? error.message}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (excedeu) reject(new SourceError('erro', 'saída do processo grande demais'));
      else resolve({ code, stdout, stderr });
    });
  });
}
