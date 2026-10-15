// Vaga canônica: chave (portal, requisição). A mesma vaga em várias fontes vira uma só, com várias aparições.
// Fingerprint (empresa + cargo) só sinaliza possível duplicata; nunca funde. Aparição do LinkedIn sem destino
// fica como vaga pendente de destino.
import { companyKey, fold, idFor, roleKey } from './keys.mjs';

const chaveDe = vaga => (vaga.portal && vaga.requisicao_id ? `${vaga.portal}:${vaga.requisicao_id}` : roleKey(vaga));
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

// Situação frente ao que o usuário já tem: nova, conhecida, aplicada ou descartada.
export function classificar(canonicas, projecao) {
  const porId = new Map(projecao.map(vaga => [vaga.id, vaga]));
  return canonicas.map(item => {
    const atual = porId.get(item.id);
    let situacao = 'nova';
    if (atual) {
      situacao = 'conhecida';
      if (atual.descarte_usuario?.descartada) situacao = 'descartada';
      else if (atual.candidatura_usuario?.aplicada || atual.candidatura_email?.aplicada || atual.candidatura_portal?.aplicada || atual.historico) situacao = 'aplicada';
    }
    return { ...item, situacao };
  });
}
