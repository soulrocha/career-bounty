// Roteamento do envio (F6.8): formulário público de Greenhouse, Lever e Ashby vai para o driver (que só envia se a
// política da F7 permitir; o padrão é parar antes de enviar); Gupy vai para o fluxo assistido próprio (F6.14);
// o resto (Inhire, Solides, LinkedIn Easy Apply, portal desconhecido) vai para o preenchimento assistido (F6.10).
const DRIVERS = [
  ['greenhouse', /(^|\.)greenhouse\.io$/],
  ['lever', /(^|\.)lever\.co$/],
  ['ashby', /(^|\.)ashbyhq\.com$/],
];

function hostDe(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

export function rotaDe(vaga) {
  const host = hostDe(vaga.application_url ?? vaga.url);
  for (const [portal, padrao] of DRIVERS) if (padrao.test(host)) return { rota: 'driver', portal };
  if (/(^|\.)gupy\.io$/.test(host) || /gupy/i.test(vaga.portal_candidatura ?? '')) return { rota: 'gupy', portal: 'gupy' };
  if (/(^|\.)linkedin\.com$/.test(host)) return { rota: 'assistido', portal: 'linkedin' };
  if (/(^|\.)inhire\.app$/.test(host)) return { rota: 'assistido', portal: 'inhire' };
  if (/(^|\.)solides\.(com\.br|jobs)$/.test(host)) return { rota: 'assistido', portal: 'solides' };
  return { rota: 'assistido', portal: host || 'desconhecido' };
}
