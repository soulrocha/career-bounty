// Transporte da sincronização: roda `<comando...> sync-remote <op> --raiz <raiz>` e conversa pelo stdin/stdout.
// Com o servidor, o comando é o ssh seguido do node e do CLI remotos; nos testes, o node e o CLI locais.
import { spawn } from 'node:child_process';
import { escrever, escreverFim, escreverQuadro, lerQuadros } from './quadros.mjs';

function iniciar({ comando, raiz, op, json, inatividadeMs }) {
  const args = [...comando.slice(1), 'sync-remote', op, '--raiz', raiz, ...(json ? ['--json'] : [])];
  const filho = spawn(comando[0], args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  let motivo = null;
  let timer;
  const vigiar = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { motivo = `sem resposta do servidor por ${Math.round(inatividadeMs / 1000)} s`; filho.kill(); }, inatividadeMs);
  };
  vigiar();
  filho.stdout.on('data', vigiar);
  filho.stderr.on('data', pedaco => { stderr = (stderr + pedaco).slice(-2000); vigiar(); });
  filho.stdin.on('error', () => {});
  const fim = new Promise((resolve, reject) => {
    filho.on('error', error => { clearTimeout(timer); reject(new Error(`não foi possível iniciar ${comando[0]}: ${error.code ?? error.message}`)); });
    filho.on('close', codigo => {
      clearTimeout(timer);
      if (motivo) reject(new Error(motivo));
      else if (codigo !== 0) reject(new Error(`sync-remote ${op} saiu com código ${codigo}: ${stderr.trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 300)}`));
      else resolve();
    });
  });
  fim.catch(() => {});
  return { filho, fim, vigiar };
}

async function lerJsonDe(processo) {
  const partes = [];
  for await (const parte of processo.filho.stdout) partes.push(parte);
  const texto = Buffer.concat(partes).toString('utf8');
  let resposta;
  try { resposta = JSON.parse(texto); } catch { await processo.fim; throw new Error('resposta do servidor não é JSON'); }
  if (resposta?.error) { await processo.fim.catch(() => {}); throw new Error(`servidor: ${resposta.error}`); }
  await processo.fim;
  return resposta;
}

export function transporteComando({ comando, raiz, inatividadeMs = 90000 }) {
  const abrir = (op, json) => iniciar({ comando, raiz, op, json, inatividadeMs });
  return {
    async manifest() {
      const processo = abrir('manifest', true);
      processo.filho.stdin.end();
      const resposta = await lerJsonDe(processo);
      return { snapshotRoot: resposta.snapshotRoot ?? null, arquivos: new Map(Object.entries(resposta.arquivos ?? {})) };
    },
    // Chama aoReceber({ path, sha256, bytes }) para cada arquivo, na ordem pedida.
    async baixar(paths, aoReceber) {
      if (!paths.length) return;
      const processo = abrir('get', false);
      processo.filho.stdin.end(JSON.stringify({ paths }));
      for await (const quadro of lerQuadros(processo.filho.stdout)) await aoReceber(quadro);
      await processo.fim;
    },
    // itens: [{ path, esperado }]; lerBytes(item) devolve os bytes atuais ou null (arquivo sumiu: não envia).
    async enviar(itens, lerBytes) {
      if (!itens.length) return { resultados: [], enviados: new Map() };
      const processo = abrir('put', true);
      const resposta = lerJsonDe(processo);
      resposta.catch(() => {});
      const enviados = new Map();
      try {
        for (const item of itens) {
          const atual = await lerBytes(item);
          if (!atual) continue;
          enviados.set(item.path, atual.sha256);
          await escreverQuadro(processo.filho.stdin, { path: item.path, sha256: atual.sha256, esperado: item.esperado }, atual.bytes);
          processo.vigiar();
        }
        await escreverFim(processo.filho.stdin);
        processo.filho.stdin.end();
      } catch (error) {
        processo.filho.kill();
        await resposta.catch(() => {});
        throw error;
      }
      return { ...(await resposta), enviados };
    },
    async apagar(itens) {
      if (!itens.length) return { resultados: [] };
      const processo = abrir('del', true);
      await escrever(processo.filho.stdin, JSON.stringify({ itens }));
      processo.filho.stdin.end();
      return lerJsonDe(processo);
    },
  };
}
