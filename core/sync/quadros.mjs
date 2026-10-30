// Fluxo binário da sincronização: cada arquivo é uma linha JSON de cabeçalho ({ path, sha256, size, ... }) seguida
// de exatamente `size` bytes. O fluxo termina com a linha {"fim":true}; sem ela, o fluxo é tratado como cortado.

const FIM = Buffer.from('{"fim":true}\n');

export function escrever(stream, dados) {
  return new Promise((resolve, reject) => {
    const aoErro = error => reject(error);
    stream.once('error', aoErro);
    const ok = stream.write(dados, error => { stream.off('error', aoErro); if (error) reject(error); });
    if (ok) { stream.off('error', aoErro); resolve(); } else stream.once('drain', () => { stream.off('error', aoErro); resolve(); });
  });
}

export async function escreverQuadro(stream, cabecalho, bytes) {
  await escrever(stream, Buffer.from(`${JSON.stringify({ ...cabecalho, size: bytes.length })}\n`));
  if (bytes.length) await escrever(stream, bytes);
}

export const escreverFim = stream => escrever(stream, FIM);

export async function* lerQuadros(readable, { limiteCabecalho = 64 * 1024 } = {}) {
  let partes = [];
  let tamanho = 0;
  let cabecalho = null;
  const juntar = () => { const tudo = partes.length === 1 ? partes[0] : Buffer.concat(partes, tamanho); partes = [tudo]; return tudo; };
  const consumir = n => { const tudo = juntar(); const resto = tudo.subarray(n); partes = resto.length ? [resto] : []; tamanho = resto.length; return tudo.subarray(0, n); };
  for await (const pedaco of readable) {
    partes.push(pedaco);
    tamanho += pedaco.length;
    while (true) {
      if (!cabecalho) {
        const fim = juntar().indexOf(10);
        if (fim < 0) {
          if (tamanho > limiteCabecalho) throw new Error('cabeçalho de quadro grande demais');
          break;
        }
        const linha = consumir(fim + 1).subarray(0, fim).toString('utf8');
        if (!linha.trim()) continue;
        cabecalho = JSON.parse(linha);
        if (cabecalho.fim === true) return;
        if (!Number.isSafeInteger(cabecalho.size) || cabecalho.size < 0) throw new Error('quadro com tamanho inválido');
      }
      if (tamanho < cabecalho.size) break;
      const bytes = Buffer.from(consumir(cabecalho.size));
      const quadro = { ...cabecalho, bytes };
      cabecalho = null;
      yield quadro;
    }
  }
  throw new Error('fluxo de sincronização cortado antes do fim');
}
