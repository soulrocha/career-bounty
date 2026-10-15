// Condições da vaga contra o piso da pessoa (porte de constraints() do refresh.py).
import { fold, pyText } from '../dedup/keys.mjs';

const UNKNOWN_MODES = ['desconhecida', 'nao informado', 'a confirmar', 'pendente'];

// Salário "numérico" como no legado: int ou float (booleano do Python também conta, mas não ocorre no pipeline).
const isNumber = value => typeof value === 'number';

export function constraints(job, config) {
  const j = job ?? {};
  // Cidades onde trabalho presencial é aceitável: lista da configuração privada (já sem acento e em minúsculas).
  const metro = config.regiao_presencial ?? [];
  const mode = fold(j.modalidade);
  const loc = fold(j.local);
  const regime = fold(j.regime);
  const result = { situacao: 'pendente', motivos: [], salario: j.salario ?? null, piso: null };
  const onsite = mode.includes('presencial') || mode.includes('onsite');
  if ((mode.includes('hibrid') || mode.includes('hybrid') || onsite) && loc && !metro.some(place => loc.includes(place))) {
    result.situacao = 'incompativel';
    result.motivos.push('Presença fora de BH/região metropolitana');
    return result;
  }
  if (mode.includes('remot') && j.elegivel_brasil === false) {
    result.situacao = 'incompativel';
    result.motivos.push('Remoto não elegível para residente no Brasil');
    return result;
  }
  if (regime === 'clt') result.piso = onsite ? config.clt.onsite_min : config.clt.remote_hybrid_min;
  else if (regime === 'pj') result.piso = config.pj.min;
  let salary = j.salario ?? null;
  const low = j.salario_min ?? null;
  const high = j.salario_max ?? j.salario_maximo ?? null;
  if (low !== null && high !== null) {
    result.faixa_publicada = { minimo: low, maximo: high, moeda: 'BRL', periodicidade: 'mensal' };
    salary = null;
    result.motivos.push('Faixa publicada não confirma valor da oferta; negociar acima do piso');
    if (result.piso !== null && high < result.piso) {
      result.situacao = 'incompativel';
      result.motivos.push('Teto da faixa abaixo do piso');
      return result;
    }
  }
  if (salary !== null && !isNumber(salary)) {
    result.motivos.push('Faixa publicada exige conferência de moeda, regime e base');
    salary = null;
  }
  if (salary === null) {
    const pending = low !== null || Boolean(pyText(j.salario_original));
    result.motivos.push(pending ? 'Valor fixo da oferta pendente; confirmar piso e pacote' : 'Salário não divulgado; confirmar piso e pacote');
  } else if (result.piso !== null) {
    result.situacao = salary >= result.piso ? 'atende' : 'incompativel';
    if (salary < result.piso) result.motivos.push('Salário fixo publicado abaixo do piso');
  }
  if (regime !== 'clt' && regime !== 'pj') {
    result.motivos.push('Regime contratual não informado');
    result.situacao = 'pendente';
  }
  if (!mode || UNKNOWN_MODES.includes(mode)) {
    result.motivos.push('Modalidade precisa de confirmação');
    result.situacao = 'pendente';
  }
  return result;
}
