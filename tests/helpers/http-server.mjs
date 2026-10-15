// Servidor HTTP local para os testes de fonte: afirma que nenhuma requisição leva cookie nem credencial.
import { createServer } from 'node:http';

export async function startServer(t, handler) {
  process.env.CAREER_BOUNTY_TESTE = '1';
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    Promise.resolve(handler(req, res, requests)).catch(error => { res.statusCode = 500; res.end(String(error.message)); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, requests, assertSemCredenciais() {
    for (const request of requests) {
      for (const name of ['cookie', 'authorization']) if (request.headers[name] !== undefined) throw new Error(`requisição com ${name}: ${request.url}`);
    }
  } };
}

export const json = (res, body, status = 200, headers = {}) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
};
