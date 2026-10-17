// Portais de recrutamento conhecidos (domínio do remetente). Padrões genéricos: nenhuma empresa nomeada.
import { readFileSync } from 'node:fs';

export const PORTAIS = JSON.parse(readFileSync(new URL('./rules/portais.json', import.meta.url), 'utf8')).portais;

const sufixo = (dominio, base) => dominio === base || dominio.endsWith(`.${base}`);

// Portal cujo domínio confere (o próprio domínio ou um subdomínio dele). `extras` vêm do config pessoal.
export function portalDoDominio(dominio, extras = []) {
  const d = String(dominio ?? '').toLowerCase();
  for (const portal of PORTAIS) if (portal.dominios.some(base => sufixo(d, base))) return portal.id;
  if (extras.some(base => sufixo(d, String(base).toLowerCase()))) return 'extra';
  return null;
}

// Domínio que lembra um portal conhecido sem ser dele (ex.: marca dentro de outro domínio): suspeito de falsificação.
export function parecidoComPortal(dominio, extras = []) {
  const d = String(dominio ?? '').toLowerCase();
  if (portalDoDominio(d, extras)) return null;
  const colapsado = d.replace(/[^a-z0-9]/g, '');
  for (const portal of PORTAIS) {
    if (colapsado.includes(portal.marca)) return portal.id;
    if (portal.dominios.some(base => colapsado.includes(base.replace(/[^a-z0-9]/g, '')))) return portal.id;
  }
  return null;
}

export const dominiosDosPortais = (extras = []) => [...new Set([...PORTAIS.flatMap(p => p.dominios), ...extras.map(e => String(e).toLowerCase())])];
