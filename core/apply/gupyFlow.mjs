// Candidatura assistida na Gupy (F6.14): reaproveita fila, reserva, extrator, matcher, perguntas, aprovação nominal e
// comprovante. O que é próprio da Gupy: a etapa da página (só perguntas da vaga recebem ação; teste, personalidade, vídeo
// e qualquer etapa desconhecida param), o aceite de risco no config pessoal e a trava diária (gupy.max_por_dia, aplicada
// no consumo da aprovação). Não existe "Sobre você" por vaga: o documento é o perfil (F6.13).

// Sinais da etapa, lidos na página: títulos e rótulos de botão curtos, se há campos de formulário e a origem.
// A descrição da vaga não entra: palavra solta no texto do anúncio não basta para classificar a etapa.
// Só títulos de nível 1 e 2 (o h3 da descrição não conta) e só botões (links de menu como "Meus testes" não contam).
export const SCRIPT_ETAPA_GUPY = '(()=>{const N=s=>(s||"").replace(/\\s+/g," ").trim(),V=e=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=="hidden";'
  + 'return{origem:location.origin,titulos:[...document.querySelectorAll("h1,h2,[role=heading][aria-level=\\"1\\"],[role=heading][aria-level=\\"2\\"]")].filter(V).map(e=>N(e.textContent).slice(0,80)).slice(0,12),'
  + 'botoes:[...document.querySelectorAll("button,input[type=submit],input[type=button]")].filter(V).map(e=>N(e.textContent||e.value||e.getAttribute("aria-label")).slice(0,40)).filter(Boolean).slice(0,40),'
  + 'campos:[...document.querySelectorAll("input:not([type=hidden]),select,textarea")].filter(V).length}})()';

// Na dúvida, é pós-inscrição (para): teste, prova, avaliação, fit cultural, quiz, personalidade, vídeo, agendamento.
const POS_INSCRICAO = /\b(teste|testes|prova|provas|avalia[cç][aã]o|avalia[cç][oõ]es|fit cultural|quiz|question[aá]rio de (perfil|personalidade|conhecimento)|perfil comportamental|personalidade|v[ií]deo|grava[cç][aã]o|gravar|assessment|game|jogo|desafio|case|agendar|agendamento|entrevista)\b/i;
// A etapa de perguntas precisa dizer "pergunta(s)" ou "informações adicionais" no título; "responda" sozinho não basta.
const PERGUNTAS = /\b(perguntas?( da vaga| adicionais| do recrutador| da empresa)?|informa[cç][oõ]es adicionais)\b/i;
const SUCESSO = /\b(candidatura (enviada|realizada|conclu[ií]da)|inscri[cç][aã]o (realizada|conclu[ií]da)|parab[eé]ns)\b/i;

// { etapa: 'perguntas' | 'pos_inscricao' | 'sucesso' | 'desconhecida', motivo }.
export function classificarEtapa(sinais) {
  if (!sinais || typeof sinais !== 'object' || !Array.isArray(sinais.titulos) || !Array.isArray(sinais.botoes) || !Number.isInteger(sinais.campos)) {
    return { etapa: 'desconhecida', motivo: 'sinais da página ilegíveis' };
  }
  if (!/^https:\/\/([a-z0-9-]+\.)*gupy\.io$/.test(String(sinais.origem ?? ''))) return { etapa: 'desconhecida', motivo: 'página fora da Gupy' };
  const titulos = sinais.titulos.map(String).join(' | ');
  const botoes = sinais.botoes.map(String).join(' | ');
  if (POS_INSCRICAO.test(titulos) || POS_INSCRICAO.test(botoes)) return { etapa: 'pos_inscricao', motivo: 'etapa depois da inscrição (teste, personalidade, vídeo ou agendamento): não é iniciada' };
  if (SUCESSO.test(titulos)) return { etapa: 'sucesso', motivo: 'candidatura já concluída nesta página' };
  if (sinais.campos > 0 && PERGUNTAS.test(titulos)) return { etapa: 'perguntas', motivo: null };
  return { etapa: 'desconhecida', motivo: 'etapa da Gupy não reconhecida: ação humana' };
}

// Aceite de risco da rota Gupy: a pessoa liga no config pessoal; o repositório não traz aceite embutido.
export function exigirAceiteGupy(settings) {
  if (!settings?.gupy?.aceite_termos) {
    throw new Error('A rota Gupy está desligada: para usar a candidatura assistida na Gupy, ponha "gupy": { "aceite_termos": true } no seu config.yml (o risco de automatizar a sua conta é seu).');
  }
}
