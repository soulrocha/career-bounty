// Quais arquivos do DATA_ROOT vão para a base central. Caminhos relativos com "/" (iguais em Windows e Linux).
// Fica fora: o que é derivado (projeções, cache), o que é da máquina (lançador, logs, locks, temporários, cópias .bak,
// configuração do leitor de e-mail com caminhos locais, sessão de candidatura com abas do navegador local, aprovações
// consumidas no envio e orçamentos diários), segredos e os snapshots que não são o do estado atual.

const PASTAS_LOCAIS = new Set(['projections', 'cache', 'logs', 'secrets', 'rollback-backups']);
const ARQUIVOS_LOCAIS = new Set(['launcher.json', 'iniciar-painel.ps1', 'Iniciar painel.cmd', 'state/leitor-email.settings.json',
  'state/sessao-candidatura.json', 'state/aprovacoes.json']);
const RESERVADOS_WINDOWS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

// Relativo, sem "." nem "..", sem caractere que o Windows recusa e sem nome reservado: o arquivo precisa poder
// existir nos dois sistemas, senão vira erro permanente na rodada.
export function caminhoSeguro(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 400 || /[\\:*?"<>|\0-\x1f]/.test(rel) || rel.startsWith('/')) return false;
  return rel.split('/').every(parte => parte && parte !== '.' && parte !== '..' && !/[. ]$/.test(parte) && !RESERVADOS_WINDOWS.test(parte));
}

// snapshotRoot: o snapshot do estado atual ("backups/<id>"), null (nenhum backup) ou "*" (todos, usado no servidor).
export function sincronizavel(rel, { snapshotRoot = null } = {}) {
  if (!caminhoSeguro(rel)) return false;
  const partes = rel.split('/');
  const nome = partes.at(-1);
  if (partes.some(parte => parte.startsWith('.'))) return false;
  if (PASTAS_LOCAIS.has(partes[0]) || ARQUIVOS_LOCAIS.has(rel)) return false;
  if (rel.startsWith('state/orcamento-')) return false;
  if (/\.(lock|tmp)(\.|$)/.test(nome) || nome.includes('.bak') || nome.includes('.conflito-')) return false;
  if (partes[0] === 'backups') {
    if (partes.length < 3 || !snapshotRoot) return false;
    return snapshotRoot === '*' || rel.startsWith(`${snapshotRoot}/`);
  }
  return true;
}

// Log de eventos: um arquivo por dia e por host, só com acréscimo. Num conflito (base perdida, hostname repetido)
// as linhas dos dois lados são unidas em vez de uma versão vencer.
export const ehLogDeEventos = rel => /^events\/.+\.jsonl$/.test(rel);

export function unirLinhas(remoto, local) {
  const linhas = texto => texto.toString('utf8').split('\n').filter(linha => linha.trim());
  const vistas = new Set(linhas(remoto));
  const saida = [...vistas];
  for (const linha of linhas(local)) if (!vistas.has(linha)) { vistas.add(linha); saida.push(linha); }
  return Buffer.from(saida.length ? `${saida.join('\n')}\n` : '');
}
