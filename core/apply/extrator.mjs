// Extrator de formulário (F6.2): script curto que roda na página (Claude in Chrome via javascript_tool, ou CDP nos drivers)
// e devolve só a estrutura: campos {ref, label, tipo, obrigatorio, opcoes}, bloqueios {captcha, login, mfa} e os textos
// dos botões de envio. Nunca lê o valor de um campo. Cada campo recebe data-cb-ref para ser preenchido depois por seletor.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SCRIPT_EXTRATOR = readFileSync(fileURLToPath(new URL('./extractor.js', import.meta.url)), 'utf8').trim();
export const seletorDoCampo = ref => `[data-cb-ref="${ref}"]`;

const TIPOS = new Set(['text', 'email', 'tel', 'url', 'number', 'date', 'textarea', 'select', 'radio', 'checkbox', 'checkbox_grupo', 'file', 'search', 'month']);
const texto = (valor, max) => String(valor ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// A saída vem da página (dado não confiável): só passa o formato esperado, com limite de tamanho por campo.
export function normalizarExtracao(bruto) {
  if (!bruto || typeof bruto !== 'object' || !Array.isArray(bruto.campos)) throw new Error('Extração inválida: falta a lista de campos.');
  const campos = bruto.campos.slice(0, 80).map(c => ({
    ref: /^c\d{1,3}$/.test(c?.ref) ? c.ref : null,
    label: texto(c?.label, 120),
    tipo: TIPOS.has(c?.tipo) ? c.tipo : 'text',
    obrigatorio: c?.obrigatorio === true,
    ...(Array.isArray(c?.opcoes) ? { opcoes: c.opcoes.slice(0, 30).map(o => texto(o, 80)) } : {}),
  })).filter(c => c.ref);
  const b = bruto.bloqueios ?? {};
  return {
    campos,
    bloqueios: { captcha: b.captcha === true, login: b.login === true, mfa: b.mfa === true },
    botoes_envio: (Array.isArray(bruto.botoes_envio) ? bruto.botoes_envio : []).slice(0, 5).map(t => texto(t, 40)),
  };
}

export const bloqueadaPorHumano = extracao => extracao.bloqueios.captcha || extracao.bloqueios.login || extracao.bloqueios.mfa;
