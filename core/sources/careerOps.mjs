// Ponte para o career-ops (MIT) rodando como processo externo na tag fixada.
// O executável é configurado pela pessoa; aqui só se exige que ele imprima JSON `{ jobs: [...] }` (ou a lista).
import path from 'node:path';
import { SourceError } from './index.mjs';
import { diaDe, modalidadeDe, requisicaoDaUrl } from './common.mjs';
import { cleanEnv, runProcess } from './process.mjs';

export const CAREER_OPS_TAG = 'v1.36.0';

export function mapJob(job) {
  if (!job || typeof job !== 'object') return null;
  const { portal, requisicao_id } = requisicaoDaUrl(job.url);
  return { portal, requisicao_id, empresa: job.company, cargo: job.title, local: job.location || null, modalidade: modalidadeDe(job.location),
    url: job.url, publicado_em: diaDe(job.postedAt), descricao: typeof job.description === 'string' ? job.description : '' };
}

export function createCareerOps(config = {}) {
  return {
    id: 'careerops',
    async collect(ctx) {
      if (!config.comando) throw new SourceError('indisponivel', 'fontes.careerops.comando não configurado');
      if (!ctx.dataRoot) throw new SourceError('erro', 'DATA_ROOT ausente no contexto da coleta');
      const env = cleanEnv({ CAREER_OPS_DATA_DIR: path.join(ctx.dataRoot, 'cache', 'career-ops') });
      const timeoutMs = config.timeout_ms ?? 120000;
      const versao = await runProcess(config.comando, config.versao_args ?? ['--version'], { env, timeoutMs: 15000 });
      if (versao.code !== 0 || !versao.stdout.includes(CAREER_OPS_TAG)) {
        throw new SourceError('versao', `career-ops fora da tag fixada ${CAREER_OPS_TAG}: ${versao.stdout.trim().slice(0, 80) || 'sem versão'}`);
      }
      const scan = await runProcess(config.comando, config.args ?? ['scan', '--dry-run', '--json'], { env, timeoutMs });
      if (scan.code !== 0) throw new SourceError('erro', `career-ops saiu com código ${scan.code}: ${scan.stderr.trim().split(/\r?\n/).pop() ?? ''}`.trim());
      let saida;
      try { saida = JSON.parse(scan.stdout); } catch { throw new SourceError('estrutura_mudou', 'a saída do career-ops não é JSON'); }
      const lista = Array.isArray(saida) ? saida : saida?.jobs;
      if (!Array.isArray(lista)) throw new SourceError('estrutura_mudou', 'a saída do career-ops não traz a lista jobs');
      return lista.map(mapJob).filter(Boolean);
    },
  };
}
