// Regras de domínio sobre a vaga legada: marcador público, "já me candidatei" e descarte.
// Portadas de painel_server.py por comportamento. Funções puras: o relógio vem no evento.
import { localDay } from './schema.mjs';

export const CONFIRMED = new Set(['candidatura-enviada-confirmada', 'candidatura-finalizada-confirmada',
  'candidatura-anterior-identificada-triagem-pendente', 'candidatura-anterior-mesmo-cargo-confirmada-id-a-verificar']);
export const MANUAL_STATUS = 'candidatura-enviada-informada-pelo-usuario';

// Marcador público de uma vaga: o que o painel mostra e o que POST devolve.
export function publicMarker(job) {
  const mark = job.candidatura_usuario ?? {};
  const email = job.candidatura_email ?? {};
  const portal = job.candidatura_portal ?? {};
  const previous = CONFIRMED.has(job.status) || Boolean(email.aplicada) || Boolean(portal.aplicada);
  return { id: job.id, aplicada: Boolean(mark.aplicada) || previous,
    data: (mark.aplicada ? mark.data : portal.data || email.data) ?? null,
    historico_confirmado: previous, status: job.status ?? null, evidencia_email: email.observacao ?? null,
    etapa_email: email.etapa ?? null, origem: mark.aplicada ? 'usuario-no-painel' : previous ? 'historico' : null,
    historico_anterior: Object.hasOwn(job, 'historico_anterior') ? job.historico_anterior : (Boolean(job.historico) && !mark.aplicada),
    descartada: Boolean(job.descarte_usuario?.descartada) };
}

// Valida uma data ISO real (AAAA-MM-DD), inclusive ano bissexto.
export function isoDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? text : null;
}

const hasConfirmedRecord = job => CONFIRMED.has(job.status) || Boolean(job.candidatura_email?.aplicada);

// Precondições de "Já me candidatei". Devolvem o motivo da recusa ou null.
export function checkMarcacao(job, { aplicada, data }, nowTs) {
  if (typeof aplicada !== 'boolean') return 'Marcação inválida.';
  if (aplicada) {
    if (!isoDate(data)) return 'Data inválida; use AAAA-MM-DD.';
    if (data > localDay(nowTs)) return 'A candidatura não pode ter data futura.';
  } else if (hasConfirmedRecord(job)) return 'O registro anterior confirmado foi preservado.';
  return null;
}

export function applyMarcacao(job, { aplicada, data, registrado_em }) {
  const next = { ...job };
  const previous = next.candidatura_usuario ?? {};
  const oldStatus = Object.hasOwn(previous, 'status_anterior') ? previous.status_anterior : (next.status ?? null);
  const marker = { aplicada, data: aplicada ? data : null, registrado_em, origem: 'usuario-no-painel', status_anterior: oldStatus };
  next.historico_marcacoes = [...(next.historico_marcacoes ?? []), { antes: previous, depois: marker }];
  next.candidatura_usuario = marker;
  if (aplicada && !CONFIRMED.has(next.status)) next.status = MANUAL_STATUS;
  else if (!aplicada && next.status === MANUAL_STATUS) next.status = oldStatus;
  return next;
}

export function applyDescarte(job, { descartada, registrado_em }) {
  const next = { ...job };
  const previous = next.descarte_usuario ?? {};
  const marker = { descartada, registrado_em, origem: 'usuario-no-painel' };
  next.historico_descartes = [...(next.historico_descartes ?? []), { antes: previous, depois: marker }];
  next.descarte_usuario = marker;
  return next;
}

// Chave da requisição da vaga: identifica a mesma vaga republicada com outro endereço.
export function requisicaoKey(vaga) {
  const value = vaga.requisicao_id ?? vaga.id_requisicao;
  return value === undefined || value === null || value === '' ? null : `req:${value}`;
}

const temComprovante = job => {
  const valor = job.comprovante_envio;
  if (valor === undefined || valor === null) return false;
  if (typeof valor === 'string') return valor.trim() !== '';
  if (typeof valor === 'object') return Object.keys(valor).length > 0;
  return Boolean(valor);
};

// A vaga já tem candidatura registrada? Junta o que a pessoa marcou, o histórico importado do legado (e-mail, portal,
// status confirmado, comprovante) e a marca herdada de outra publicação da mesma requisição.
export const aplicadaDe = job => Boolean(job.candidatura_usuario?.aplicada) || CONFIRMED.has(job.status) || Boolean(job.candidatura_email?.aplicada)
  || Boolean(job.candidatura_portal?.aplicada) || Boolean(job.candidatura_herdada?.aplicada) || Boolean(job.historico) || temComprovante(job);

export const descartadaDe = job => Boolean(job.descarte_usuario?.descartada);

export const CANAIS_CONTATO = new Set(['email', 'whatsapp', 'linkedin', 'telefone', 'outro']);
export const DIRECOES_CONTATO = new Set(['recebido', 'enviado']);

export function validarContatoRegistrado(dados, nowTs) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    return 'Dados do contato inválidos.';
  }
  if (!CANAIS_CONTATO.has(dados.canal)) {
    return `Canal inválido; use um dos seguintes: ${[...CANAIS_CONTATO].join(', ')}.`;
  }
  if (!DIRECOES_CONTATO.has(dados.direcao)) {
    return 'Direção inválida; use "recebido" ou "enviado".';
  }
  if (typeof dados.resumo !== 'string' || !dados.resumo.trim()) {
    return 'Resumo obrigatório do contato não informado.';
  }
  if (dados.resumo.length > 500) {
    return 'Resumo excede o limite de 500 caracteres.';
  }
  if (!isoDate(dados.data)) {
    return 'Data do contato inválida; use AAAA-MM-DD.';
  }
  if (dados.data > localDay(nowTs)) {
    return 'O contato não pode ter data futura.';
  }
  if (dados.pessoa !== undefined && dados.pessoa !== null) {
    if (typeof dados.pessoa !== 'object' || Array.isArray(dados.pessoa)) {
      return 'Campo pessoa deve ser um objeto.';
    }
  }
  if (dados.proxima_etapa !== undefined && dados.proxima_etapa !== null) {
    if (typeof dados.proxima_etapa !== 'object' || Array.isArray(dados.proxima_etapa)) {
      return 'Próxima etapa deve ser um objeto.';
    }
    if (typeof dados.proxima_etapa.texto !== 'string' || !dados.proxima_etapa.texto.trim()) {
      return 'Texto da próxima etapa é obrigatório quando o campo for informado.';
    }
    if (dados.proxima_etapa.data && !isoDate(dados.proxima_etapa.data)) {
      return 'Data da próxima etapa inválida; use AAAA-MM-DD.';
    }
  }
  return null;
}

export function validarContatoVinculado(dados) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    return 'Dados de vinculação inválidos.';
  }
  if (typeof dados.contato_id !== 'string' || !dados.contato_id.trim()) {
    return 'ID do contato obrigatório.';
  }
  if (typeof dados.vaga_id !== 'string' || !dados.vaga_id.trim()) {
    return 'ID da vaga obrigatório.';
  }
  return null;
}

export function validarContatoRemovido(dados) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    return 'Dados de remoção inválidos.';
  }
  if (typeof dados.contato_id !== 'string' || !dados.contato_id.trim()) {
    return 'ID do contato obrigatório.';
  }
  if (dados.motivo !== undefined && dados.motivo !== null) {
    if (typeof dados.motivo !== 'string' || !dados.motivo.trim()) {
      return 'Motivo da remoção deve ser um texto válido.';
    }
  }
  return null;
}

export const ETAPAS_PROCESSO = new Set([
  'aplicada',
  'triagem',
  'teste',
  'entrevista_rh',
  'entrevista_tecnica',
  'entrevista_gestor',
  'proposta',
  'aprovado',
]);

export const ORDEM_ETAPAS_PROCESSO = [
  'aplicada',
  'triagem',
  'teste',
  'entrevista_rh',
  'entrevista_tecnica',
  'entrevista_gestor',
  'proposta',
  'aprovado',
];

export const DESFECHOS_PROCESSO = new Set([
  'aprovado',
  'reprovado',
  'desistencia',
  'cancelado',
  'proposta_recusada',
]);

export const SITUACOES_PROCESSO = new Set([
  'ativo',
  'aguardando_retorno',
  'aguardando_voce',
  'encerrado',
]);

export const DESFECHOS_QUE_DESCARTAM = new Set([
  'reprovado',
  'desistencia',
  'cancelado',
  'proposta_recusada',
]);

export function validarEtapaProcesso(dados, nowTs = new Date().toISOString()) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    return 'Dados da etapa inválidos.';
  }
  if (typeof dados.vaga_id !== 'string' || !dados.vaga_id.trim()) {
    return 'ID da vaga obrigatório.';
  }
  if (!ETAPAS_PROCESSO.has(dados.etapa)) {
    return `Etapa inválida; use uma das seguintes: ${[...ETAPAS_PROCESSO].join(', ')}.`;
  }
  if (!isoDate(dados.data)) {
    return 'Data da etapa inválida; use AAAA-MM-DD.';
  }
  if (dados.data > localDay(nowTs)) {
    return 'A etapa não pode ter data futura.';
  }
  if (dados.detalhe !== undefined && dados.detalhe !== null) {
    if (typeof dados.detalhe !== 'string') {
      return 'Detalhe deve ser um texto.';
    }
    if (dados.detalhe.length > 500) {
      return 'Detalhe excede o limite de 500 caracteres.';
    }
  }
  return null;
}

export function validarEncerramentoProcesso(dados, nowTs = new Date().toISOString()) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    return 'Dados de encerramento inválidos.';
  }
  if (typeof dados.vaga_id !== 'string' || !dados.vaga_id.trim()) {
    return 'ID da vaga obrigatório.';
  }
  if (!DESFECHOS_PROCESSO.has(dados.desfecho)) {
    return `Desfecho inválido; use um dos seguintes: ${[...DESFECHOS_PROCESSO].join(', ')}.`;
  }
  if (!isoDate(dados.data)) {
    return 'Data de encerramento inválida; use AAAA-MM-DD.';
  }
  if (dados.data > localDay(nowTs)) {
    return 'O encerramento não pode ter data futura.';
  }
  if (dados.nota !== undefined && dados.nota !== null) {
    if (typeof dados.nota !== 'string') {
      return 'Nota deve ser um texto.';
    }
    if (dados.nota.length > 500) {
      return 'Nota excede o limite de 500 caracteres.';
    }
  }
  return null;
}

export const PLATAFORMAS_AVALIACAO = new Set(['Glassdoor', 'Indeed', 'Catho', 'Outro']);

export function validarEmpresaAvaliada(dados, nowTs = new Date().toISOString()) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    return 'Dados da avaliação de empresa inválidos.';
  }
  if (typeof dados.empresa !== 'string' || !dados.empresa.trim()) {
    return 'Nome da empresa é obrigatório.';
  }
  if (typeof dados.empresa_chave !== 'string' || !dados.empresa_chave.trim()) {
    return 'Chave normalizada da empresa é obrigatória.';
  }
  if (typeof dados.nota !== 'number' || !Number.isFinite(dados.nota) || dados.nota < 1.0 || dados.nota > 5.0) {
    return 'Nota deve ser um número entre 1.0 e 5.0.';
  }
  if (!Number.isInteger(dados.quantidade) || dados.quantidade < 0) {
    return 'Quantidade de avaliações deve ser um número inteiro maior ou igual a zero.';
  }
  if (!PLATAFORMAS_AVALIACAO.has(dados.plataforma)) {
    return `Plataforma inválida; use uma das seguintes: ${[...PLATAFORMAS_AVALIACAO].join(', ')}.`;
  }
  if (!isoDate(dados.data)) {
    return 'Data da avaliação inválida; use AAAA-MM-DD.';
  }
  if (dados.data > localDay(nowTs)) {
    return 'A avaliação não pode ter data futura.';
  }
  if (!Array.isArray(dados.fontes) || dados.fontes.length === 0) {
    return 'Fontes com URL são obrigatórias para registrar uma avaliação.';
  }
  for (const fonte of dados.fontes) {
    if (!fonte || typeof fonte !== 'object' || Array.isArray(fonte)) {
      return 'Item de fonte inválido.';
    }
    if (typeof fonte.url !== 'string' || !/^https?:\/\/[^\s]+$/i.test(fonte.url.trim())) {
      return 'URL da fonte inválida ou ausente.';
    }
    if (fonte.plataforma !== undefined && !PLATAFORMAS_AVALIACAO.has(fonte.plataforma)) {
      return `Plataforma da fonte inválida: ${fonte.plataforma}.`;
    }
  }
  if (dados.resumo !== undefined && dados.resumo !== null) {
    if (typeof dados.resumo !== 'string') {
      return 'Resumo deve ser um texto.';
    }
    if (dados.resumo.length > 500) {
      return 'Resumo excede o limite de 500 caracteres.';
    }
  }
  if (dados.validade_dias !== undefined && dados.validade_dias !== null) {
    if (!Number.isInteger(dados.validade_dias) || dados.validade_dias < 1) {
      return 'Validade em dias deve ser um inteiro positivo.';
    }
  }
  return null;
}

export function validarAfirmacaoIncluida(dados, nowTs = new Date().toISOString()) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    return 'Dados da afirmação incluída inválidos.';
  }
  if (typeof dados.afirmacao_id !== 'string' || !dados.afirmacao_id.trim()) {
    return 'ID da afirmação é obrigatório.';
  }
  if (dados.experiencia_id !== undefined && dados.experiencia_id !== null) {
    if (typeof dados.experiencia_id !== 'string' || !dados.experiencia_id.trim()) {
      return 'ID da experiência deve ser uma string válida.';
    }
  }
  if (!isoDate(dados.data)) {
    return 'Data de inclusão inválida; use AAAA-MM-DD.';
  }
  if (dados.data > localDay(nowTs)) {
    return 'A inclusão não pode ter data futura.';
  }
  return null;
}

export const STATUS_ITEM_ANALISE = new Set(['revisar', 'ignorado', 'ativo']);

export function validarItemMarcado(dados, nowTs = new Date().toISOString()) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    return 'Dados da marcação de item inválidos.';
  }
  if (typeof dados.item_id !== 'string' || !dados.item_id.trim()) {
    return 'ID do item é obrigatório.';
  }
  if (!STATUS_ITEM_ANALISE.has(dados.como)) {
    return 'Status da marcação inválido; use "revisar", "ignorado" ou "ativo".';
  }
  if (dados.motivo !== undefined && dados.motivo !== null) {
    if (typeof dados.motivo !== 'string') {
      return 'Motivo deve ser um texto.';
    }
    if (dados.motivo.length > 500) {
      return 'Motivo excede o limite de 500 caracteres.';
    }
  }
  if (!isoDate(dados.data)) {
    return 'Data da marcação inválida; use AAAA-MM-DD.';
  }
  if (dados.data > localDay(nowTs)) {
    return 'A marcação não pode ter data futura.';
  }
  return null;
}

export function validarLacunaEntrevista(dados, nowTs = new Date().toISOString()) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    return 'Dados do registro de entrevista para lacuna inválidos.';
  }
  if (typeof dados.item_id !== 'string' || !dados.item_id.trim()) {
    return 'ID do item de lacuna é obrigatório.';
  }
  if (typeof dados.pergunta !== 'string' || !dados.pergunta.trim()) {
    return 'Pergunta de entrevista é obrigatória.';
  }
  if (dados.arquivo_rascunho !== undefined && dados.arquivo_rascunho !== null) {
    if (typeof dados.arquivo_rascunho !== 'string' || !dados.arquivo_rascunho.trim()) {
      return 'Caminho do arquivo de rascunho deve ser um texto válido.';
    }
  }
  if (!isoDate(dados.data)) {
    return 'Data de entrevista inválida; use AAAA-MM-DD.';
  }
  if (dados.data > localDay(nowTs)) {
    return 'O agendamento de entrevista não pode ter data futura.';
  }
  return null;
}




