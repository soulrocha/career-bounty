// JobSpy (Indeed e outros) como fonte externa opcional: o Python fica fora do núcleo.
// Contrato do executável configurado: recebe `--termo <texto> --dias <n>` e imprime uma lista JSON de registros do JobSpy.
import { SourceError } from './index.mjs';
import { diaDe, modalidadeDe, requisicaoDaUrl } from './common.mjs';
import { cleanEnv, runProcess } from './process.mjs';

function mapRecord(r) {
  if (!r || typeof r !== 'object') return null;
  const { requisicao_id } = requisicaoDaUrl(r.job_url);
  return { portal: typeof r.site === 'string' ? r.site.toLowerCase() : 'jobspy', requisicao_id, empresa: r.company, cargo: r.title,
    local: r.location || null, modalidade: r.is_remote === true ? 'remoto' : modalidadeDe(r.location), regime: r.job_type === 'fulltime' ? 'CLT' : null,
    salario_min: typeof r.min_amount === 'number' ? r.min_amount : null, salario_max: typeof r.max_amount === 'number' ? r.max_amount : null,
    url: r.job_url, publicado_em: diaDe(r.date_posted), descricao: typeof r.description === 'string' ? r.description : '' };
}

export function createJobSpy(config = {}) {
  return {
    id: 'jobspy',
    async collect(ctx) {
      if (!config.comando) throw new SourceError('indisponivel', 'fontes.jobspy.comando não configurado');
      const termos = config.termos?.length ? config.termos : (ctx.plano?.termos ?? []);
      const dias = Math.max(1, Math.round((Date.parse(`${ctx.janela.fim}T00:00:00Z`) - Date.parse(`${ctx.janela.inicio}T00:00:00Z`)) / 86400000));
      const porUrl = new Map();
      for (const termo of termos) {
        const result = await runProcess(config.comando, [...(config.args ?? []), '--termo', termo, '--dias', String(dias)], { env: cleanEnv(), timeoutMs: config.timeout_ms ?? 120000 });
        if (result.code !== 0) throw new SourceError('erro', `jobspy saiu com código ${result.code}: ${result.stderr.trim().split(/\r?\n/).pop() ?? ''}`.trim());
        let lista;
        try { lista = JSON.parse(result.stdout); } catch { throw new SourceError('estrutura_mudou', 'a saída do jobspy não é JSON'); }
        if (!Array.isArray(lista)) throw new SourceError('estrutura_mudou', 'a saída do jobspy não é uma lista');
        for (const registro of lista) {
          const vaga = mapRecord(registro);
          if (vaga && !porUrl.has(vaga.url)) porUrl.set(vaga.url, vaga);
        }
      }
      return [...porUrl.values()];
    },
  };
}
