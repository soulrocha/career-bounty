// Sanitizador do conteúdo recebido: texto limpo e seguro antes de regra e LLM.
// Remove HTML ativo, assinatura, rodapé, citação, URLs privadas ou desconhecidas, controles e o delimitador de dado.
import { limparTextoNaoConfiavel } from '../privacy/untrusted.mjs';
import { portalDoDominio } from './portais.mjs';

export const REMOVIDO = '[link removido]';
const ENTIDADES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
const FIM_DO_ASSUNTO = /[.,;:!?)\]]+$/;
const CAMINHO_PRIVADO = /(reset|password|senha|redefin|confirm|verif|unsubscribe|descadastr|optout|opt-out|token|auth|login|signin|magic|activate|ativar|aceitar|invite|convite|track|click|redirect|session|callback)/i;
const SEGMENTO_OPACO = /[A-Za-z0-9_-]{24,}/;
const RODAPE = /(descadastr|unsubscribe|cancel(ar|e) (a |sua )?(inscri|assinatura)|pol[ií]tica de privacidade|voc[eê] est[aá] recebendo|you are receiving|manage (your )?(email )?preferences|gerenciar prefer[eê]ncias|todos os direitos reservados|all rights reserved|©|^enviado do meu|^sent from my)/i;
const CITACAO = [/^(em|on)\s.{3,200}(escreveu|wrote)\s*:?\s*$/i, /^-{2,}\s*(original message|mensagem original|forwarded message|mensagem encaminhada)\s*-{2,}\s*$/i, /^_{5,}\s*$/, /^de:\s.+\s(enviad[oa]|sent)\s*(em|:)/i];

function textoDeHtml(entrada) {
  if (!/<\/?[a-z][^>]*>/i.test(entrada)) return entrada;
  return entrada
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|head|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/?(br|p|div|li|tr|td|th|h[1-6]|table|ul|ol|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (inteiro, nome) => {
      const chave = nome.toLowerCase();
      if (Object.hasOwn(ENTIDADES, chave)) return ENTIDADES[chave];
      const codigo = chave.startsWith('#x') ? parseInt(chave.slice(2), 16) : chave.startsWith('#') ? parseInt(chave.slice(1), 10) : NaN;
      return Number.isInteger(codigo) && codigo > 31 && codigo < 0x110000 ? String.fromCodePoint(codigo) : ' ';
    });
}

// Devolve a URL pública sem rastreio, ou null quando é privada, opaca ou de host desconhecido.
function urlPublica(bruta, extras) {
  let url;
  try { url = new URL(bruta); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const portal = portalDoDominio(url.hostname, extras);
  if (!portal) return null;
  if (portal === 'linkedin' && !url.pathname.startsWith('/jobs/view/')) return null;
  if (CAMINHO_PRIVADO.test(url.pathname) || url.pathname.split('/').some(segmento => SEGMENTO_OPACO.test(segmento))) return null;
  return `${url.origin}${url.pathname}`;
}

function tratarUrls(texto, extras, mantidas) {
  return texto.replace(/https?:\/\/[^\s<>"'`]+/gi, achada => {
    const cauda = FIM_DO_ASSUNTO.exec(achada)?.[0] ?? '';
    const publica = urlPublica(cauda ? achada.slice(0, -cauda.length) : achada, extras);
    if (!publica) return `${REMOVIDO}${cauda}`;
    if (!mantidas.includes(publica)) mantidas.push(publica);
    return `${publica}${cauda}`;
  });
}

function cortarEmCitacaoERodape(texto) {
  const linhas = texto.split('\n');
  const fim = linhas.findIndex((linha, i) => {
    const l = linha.trim();
    return /^--\s*$/.test(l) || CITACAO.some(re => re.test(l)) || (i > 0 && RODAPE.test(l));
  });
  return (fim === -1 ? linhas : linhas.slice(0, fim)).filter(linha => !linha.trimStart().startsWith('>')).join('\n');
}

const cortar = (texto, max) => [...texto].slice(0, max).join('').trimEnd();

export function sanitizarEmail(entrada, { max = 1500, extras = [] } = {}) {
  const avisos = [];
  const urls = [];
  let texto = limparTextoNaoConfiavel(textoDeHtml(String(entrada ?? '').replace(/\r\n?/g, '\n')), { max: 1_000_000 }).texto;
  texto = cortarEmCitacaoERodape(texto);
  texto = tratarUrls(texto, extras, urls);
  texto = texto.split('\n').map(linha => linha.replace(/[ \t ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  texto = limparTextoNaoConfiavel(texto, { max: 1_000_000 }).texto;
  if ([...texto].length > max) { texto = cortar(texto, max); avisos.push(`texto cortado em ${max} caracteres`); }
  return { texto, urls, avisos };
}

// Assunto e trecho: linha única, mesma política de URL, sem delimitador.
export function sanitizarCampo(entrada, max = 300, { extras = [] } = {}) {
  const { texto } = sanitizarEmail(String(entrada ?? '').replace(/\s+/g, ' '), { max: 1_000_000, extras });
  return cortar(texto.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim(), max);
}
