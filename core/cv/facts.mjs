// Verificador de números e fatos (biblioteca compartilhada, F4 e gates da F5): todo número do texto precisa existir
// numa afirmação ligada com prova (verificado ou entregue). Adapta o verify-cv-facts do career-ops ao contrato de afirmações.
import { chaveNumero, extrairNumeros, numerosDaAfirmacao } from './numeros.mjs';
import { NIVEIS_COM_PROVA } from '../kb/schema.mjs';

const COM_PROVA = new Set(NIVEIS_COM_PROVA);

// Texto 34% contra afirmação 34,2%: mesmo valor depois de arredondar. Não é divergência grosseira, mas também não é o dado.
const arredonda = (texto, afirmacao) => texto.tipo === afirmacao.tipo && Number.isInteger(texto.valor) && !Number.isInteger(afirmacao.valor) && Math.round(afirmacao.valor) === texto.valor;

// ligadas: IDs das afirmações a que o texto se liga. Devolve { ok, problemas: [{ numero, codigo, motivo }] }.
export function verificarTexto({ texto, ligadas, afirmacoes, permitirArredondamento = false }) {
  const porId = new Map(afirmacoes.map(af => [af.id, af]));
  const alvo = ligadas.map(id => {
    if (!porId.has(id)) throw new Error(`Afirmação ligada inexistente: ${id}`);
    return porId.get(id);
  });
  const problemas = [];
  for (const af of alvo.filter(item => !COM_PROVA.has(item.nivel_prova))) {
    problemas.push({ numero: null, codigo: 'afirmacao_sem_prova', motivo: `${af.id} (${af.nivel_prova}) não sustenta fato nem número; só verificado ou entregue` });
  }
  const comProva = alvo.filter(af => COM_PROVA.has(af.nivel_prova));
  const doTexto = alvo.map(af => ({ af, numeros: numerosDaAfirmacao(af) }));
  for (const numero of extrairNumeros(texto)) {
    const chave = chaveNumero(numero);
    if (comProva.some(af => numerosDaAfirmacao(af).some(n => chaveNumero(n) === chave))) continue;
    const semProva = doTexto.find(({ af, numeros }) => !COM_PROVA.has(af.nivel_prova) && numeros.some(n => chaveNumero(n) === chave));
    if (semProva) { if (!problemas.some(p => p.codigo === 'afirmacao_sem_prova' && p.motivo.startsWith(semProva.af.id))) problemas.push({ numero: numero.bruto, codigo: 'afirmacao_sem_prova', motivo: `número ${numero.bruto} só existe em ${semProva.af.id}, que é ${semProva.af.nivel_prova}` }); continue; }
    const aproximado = comProva.flatMap(af => numerosDaAfirmacao(af).map(n => ({ af, n }))).find(({ n }) => arredonda(numero, n));
    if (aproximado) {
      if (!permitirArredondamento) problemas.push({ numero: numero.bruto, codigo: 'arredondamento', motivo: `número ${numero.bruto} arredonda ${aproximado.n.bruto} de ${aproximado.af.id}; use o valor exato` });
      continue;
    }
    const outra = afirmacoes.find(af => !ligadas.includes(af.id) && numerosDaAfirmacao(af).some(n => chaveNumero(n) === chave));
    if (outra) problemas.push({ numero: numero.bruto, codigo: 'numero_em_outra_afirmacao', motivo: `número ${numero.bruto} existe em ${outra.id}, que não está ligada a este texto` });
    else if (comProva.length) problemas.push({ numero: numero.bruto, codigo: 'numero_divergente', motivo: `número ${numero.bruto} não consta em ${ligadas.join(', ')}` });
    else problemas.push({ numero: numero.bruto, codigo: 'numero_orfao', motivo: `número ${numero.bruto} sem afirmação que o sustente` });
  }
  return { ok: problemas.length === 0, problemas };
}
