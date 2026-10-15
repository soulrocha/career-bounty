// Vaga canônica: chave (portal, requisição). A mesma vaga em várias fontes vira uma só, com várias aparições.
// Fingerprint (empresa + cargo) só sinaliza possível duplicata; nunca funde. Aparição do LinkedIn sem destino
// fica como vaga pendente de destino.
import { chavesCanonicas, companyKey, fold, idFor, normalizarChave, roleKey } from './keys.mjs';
import { aplicadaDe, descartadaDe } from '../store/rules.mjs';

const chaveDe = vaga => (vaga.portal && vaga.requisicao_id ? `${vaga.portal}:${vaga.requisicao_id}` : (normalizarChave(roleKey(vaga)) ?? roleKey(vaga)));
const fingerprint = vaga => `${companyKey(vaga.empresa)}|${fold(vaga.cargo).replace(/[^a-z0-9]+/g, ' ').trim()}`;

export function consolidar(vagas) {
  const porChave = new Map();
  for (const vaga of vagas) {
    const chave = chaveDe(vaga);
    const aparicao = { fonte: vaga.fonte, portal: vaga.portal, url: vaga.url, ...(vaga.aparicao ? { aparicao: true } : {}) };
    const atual = porChave.get(chave);
    if (!atual) {
      porChave.set(chave, { chave, vaga: { ...vaga }, aparicoes: [aparicao] });
      continue;
    }
    if (!atual.aparicoes.some(item => item.fonte === aparicao.fonte && item.url === aparicao.url)) atual.aparicoes.push(aparicao);
    // O texto mais completo vence; uma aparição nunca sobrescreve a vaga de uma fonte com destino.
    if ((atual.vaga.aparicao && !vaga.aparicao) || (atual.vaga.aparicao === vaga.aparicao && vaga.descricao.length > atual.vaga.descricao.length)) {
      atual.vaga = { ...vaga };
    }
  }
  const lista = [...porChave.values()].map(item => {
    const { aparicao, ...vaga } = item.vaga;
    return { id: idFor(vaga), chave: item.chave, vaga: { ...vaga, ...(aparicao ? { aparicao: true } : {}) }, aparicoes: item.aparicoes,
      fontes: [...new Set(item.aparicoes.map(a => a.fonte))], destino_pendente: aparicao === true, possivel_duplicata: [] };
  });
  const grupos = new Map();
  for (const item of lista) {
    const fp = fingerprint(item.vaga);
    grupos.set(fp, [...(grupos.get(fp) ?? []), item]);
  }
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    for (const item of grupo) item.possivel_duplicata = grupo.filter(outro => outro !== item).map(outro => outro.id);
  }
  return lista;
}

// Situação frente ao que o usuário já tem: nova, conhecida, aplicada, descartada ou pendente de conferência.
// O casamento é por chave canônica de portal (portal + requisição), derivada também da URL e das aparições das vagas do legado,
// que quase nunca trazem requisicao_id e cujo id não é o idFor. Descartada vale mais que aplicada, que vale mais que conhecida.
const FORCA = { conhecida: 1, aplicada: 2, descartada: 3 };
const situacaoDeUma = vaga => (descartadaDe(vaga) ? 'descartada' : aplicadaDe(vaga) ? 'aplicada' : 'conhecida');
const soLinkedin = chaves => chaves.every(chave => chave.startsWith('linkedin:'));

export function classificar(canonicas, projecao) {
  const indice = new Map();
  const juntar = (chave, vaga) => { if (chave) indice.set(chave, [...(indice.get(chave) ?? []), vaga]); };
  const porConferir = new Map();
  for (const vaga of projecao) {
    juntar(`id:${vaga.id}`, vaga);
    const chaves = chavesCanonicas(vaga);
    for (const chave of chaves) juntar(`k:${chave}`, vaga);
    // Aplicada ou descartada que não dá para reconhecer por endereço (sem URL, ou só o espelho do LinkedIn) só se confere por empresa e cargo.
    if (situacaoDeUma(vaga) !== 'conhecida' && soLinkedin(chaves)) {
      const fp = fingerprint(vaga);
      if (fp !== '|') porConferir.set(fp, [...(porConferir.get(fp) ?? []), vaga]);
    }
  }
  const maisForte = vagas => vagas.reduce((melhor, vaga) => (!melhor || FORCA[situacaoDeUma(vaga)] > FORCA[situacaoDeUma(melhor)] ? vaga : melhor), null);
  return canonicas.map(item => {
    const chaves = new Set([normalizarChave(item.chave) ?? item.chave, ...chavesCanonicas({ ...item.vaga, aparicoes: item.aparicoes })]);
    const achadas = [...(indice.get(`id:${item.id}`) ?? []), ...[...chaves].flatMap(chave => indice.get(`k:${chave}`) ?? [])];
    const atual = maisForte(achadas);
    if (atual) return { ...item, id: atual.id, situacao: situacaoDeUma(atual) };
    const duvida = maisForte(porConferir.get(fingerprint(item.vaga)) ?? []);
    if (duvida) return { ...item, situacao: 'pendente_conferencia', conferir_com: duvida.id };
    return { ...item, situacao: 'nova' };
  });
}
