// Portal de candidatura: vem do destino observado, nunca de fontes de reputação (porte de refresh.py).
import { fold, pyOr } from '../dedup/keys.mjs';
import { hostname, urlsplit, ValueError } from '../dedup/pyurl.mjs';

const DOMAINS = [
  ['Gupy', ['gupy.io']], ['Lever', ['lever.co']], ['Greenhouse', ['greenhouse.io']], ['Ashby', ['ashbyhq.com']],
  ['InHire', ['inhire.app']], ['Quickin', ['quickin.io']], ['Sólides', ['solides.com.br', 'solides.jobs']], ['Recrut.ai', ['recrut.ai']],
  ['Workable', ['workable.com']], ['Breezy', ['breezy.hr']], ['iCIMS', ['icims.com']], ['Pandapé', ['pandape.info', 'pandape.com.br']],
  ['Vagas.com', ['vagas.com.br']], ['Deel', ['jobs.deel.com']],
  ['CareersPage', ['careers-page.com']], ['Workday', ['myworkdayjobs.com', 'myworkdaysite.com']], ['SmartRecruiters', ['smartrecruiters.com']],
  ['SuccessFactors', ['successfactors.com', 'successfactors.eu', 'successfactors.com.br']],
];

// Portais privados de recrutamento de uma empresa específica ficam na configuração: `portais_extras: { "Rótulo": ["host"] }`.
export function portalCandidatura(job, config = {}) {
  const j = job ?? {};
  const url = pyOr(j.application_url, j.url);
  let parsed;
  let host;
  try {
    parsed = urlsplit(url);
    host = (hostname(parsed) ?? '').toLowerCase().replace(/\.+$/, '');
  } catch (error) {
    if (error instanceof ValueError) return 'Pendente';
    throw error;
  }
  if (!['http', 'https'].includes(parsed.scheme)) return 'Pendente';
  const extras = config?.portais_extras && typeof config.portais_extras === 'object' ? Object.entries(config.portais_extras) : [];
  for (const [label, suffixes] of [...DOMAINS, ...extras]) {
    if ((Array.isArray(suffixes) ? suffixes : []).some(suffix => typeof suffix === 'string' && (host === suffix || host.endsWith(`.${suffix}`)))) return label;
  }
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return j.candidatura_simplificada === true ? 'LinkedIn — candidatura simplificada' : 'Pendente';
  return j.portal_site_confirmado === true ? 'Site da empresa' : 'Pendente';
}

export function curriculoNecessario(job, config) {
  const skip = new Set((config?.cv_skip_portals ?? ['gupy']).map(fold));
  return !skip.has(fold(portalCandidatura(job, config)));
}
