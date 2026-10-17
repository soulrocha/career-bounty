// Contexto determinístico do /mentor: quadrantes, maiores lacunas, funil de vagas e alvo de carreira.
// Nunca inclui identidade (os valores são redigidos de qualquer texto) e nunca escreve nada.
import { redact } from '../privacy/redact.mjs';

const ADERENCIAS = ['alta', 'media', 'boa', 'baixa', 'condicional', 'incompativel', 'pendente'];
const TOPO = 8;

const aplicada = campo => Boolean(campo && typeof campo === 'object' && campo.aplicada);
const resumo = (texto, max = 150) => (String(texto).length > max ? `${String(texto).slice(0, max - 1).trimEnd()}…` : String(texto));

export function funilDeVagas(vagas) {
  const porAderencia = Object.fromEntries(ADERENCIAS.map(nome => [nome, 0]));
  let aplicadas = 0;
  let descartadas = 0;
  for (const vaga of vagas) {
    const nome = ADERENCIAS.includes(vaga.aderencia) ? vaga.aderencia : 'pendente';
    porAderencia[nome] += 1;
    if (aplicada(vaga.candidatura_usuario) || aplicada(vaga.candidatura_email) || aplicada(vaga.candidatura_portal)) aplicadas += 1;
    if (vaga.descarte_usuario?.descartada) descartadas += 1;
  }
  return { total: vagas.length, por_aderencia: porAderencia, aplicadas, descartadas };
}

export function montarContextoMentor({ quadrantes, vagas = [], preferencias, identidade = [], snapshotHash }) {
  const funil = funilDeVagas(vagas);
  const c = quadrantes.contagem;
  const linhas = ['# Contexto para o mentor (somente leitura)', '', `Snapshot da base: ${snapshotHash ?? 'sem snapshot'}`, '', '## Quadrantes', '',
    `- (a) dado e CV conferem: ${c.a}`, `- (b) dado fora do CV: ${c.b}`, `- (c) CV sem dado: ${c.c}`, `- (d) lacunas: ${c.d}`, ''];
  if (quadrantes.b.length) linhas.push('Dado fora do CV (mais fortes):', ...quadrantes.b.slice(0, TOPO).map(x => (x.tipo === 'afirmacao' ? `- ${x.id} (${x.nivel_prova}): ${x.texto}` : `- arco ${x.id}${x.titulo ? ` (${x.titulo})` : ''} sem afirmação ligada`)), '');
  if (quadrantes.c.length) linhas.push('CV sem dado que o sustente:', ...quadrantes.c.slice(0, TOPO).map(x => `- linha ${x.linha} (${x.codigo}): ${resumo(x.texto)} — ${x.motivo}`), '');
  if (quadrantes.d.length) linhas.push('Lacunas de maior peso:', ...quadrantes.d.slice(0, TOPO).map(x => `- [${x.peso}] ${x.descricao}`), '');
  const por = ADERENCIAS.filter(nome => funil.por_aderencia[nome] > 0).map(nome => `${nome} ${funil.por_aderencia[nome]}`).join(', ') || 'nenhuma';
  linhas.push('## Funil e alvo', '', `Funil de vagas: ${funil.total} vagas (${por}); ${funil.aplicadas} candidatura(s) marcadas, ${funil.descartadas} descartada(s).`);
  const alvos = [preferencias?.cargo_alvo, ...(preferencias?.cargos_alvo ?? [])].filter(Boolean);
  if (alvos.length) linhas.push(`Cargos-alvo: ${[...new Set(alvos)].join('; ')}.`);
  if (preferencias?.texto) linhas.push('', 'Perfil:', resumo(preferencias.texto, 600));
  const texto = redact(linhas.join('\n'), identidade).valor;
  return { texto, dados: { snapshot: snapshotHash ?? null, contagem: c, funil, alvos: [...new Set(alvos)] } };
}
