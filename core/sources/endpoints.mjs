// Endereços públicos das fontes. Ficam aqui para os módulos de coleta não misturarem host e caminho.
export const ENDPOINTS = {
  gupy: 'https://portal.gupy.io/api/job-search/jobs',
  freehire: 'https://freehire.me',
  inhire: 'https://api.inhire.app',
  solides: 'https://vagas.solides.com.br',
  linkedin: 'https://www.linkedin.com',
};

export const isLoopback = host => host === '127.0.0.1' || host === 'localhost' || host === '[::1]';

// Teste e uso local podem apontar para um servidor em loopback; qualquer outro host precisa ser o oficial.
export function checkedBase(value, oficial, nome) {
  const base = value ?? oficial;
  let url;
  try { url = new URL(base); } catch { throw new Error(`${nome}: base_url inválida.`); }
  const permitido = url.host === new URL(oficial).host || (isLoopback(url.hostname) && url.protocol === 'http:');
  if (!permitido) throw new Error(`${nome}: host não permitido (${url.hostname}); use o endereço oficial.`);
  if (url.protocol !== 'https:' && !isLoopback(url.hostname)) throw new Error(`${nome}: use HTTPS.`);
  return base.replace(/\/+$/, '');
}
