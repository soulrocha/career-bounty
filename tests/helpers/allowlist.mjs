// Extrai empresas e domínios de um texto e devolve os que não pertencem à lista fictícia.
const COMPANY = [/"(?:empresa|company)"\s*:\s*"([^"]+)"/gi, /^\s*(?:empresa|company)\s*:\s*(.+?)\s*$/gim];
const HOSTS = [/https?:\/\/([a-z0-9.-]+)/gi, /@([a-z0-9.-]+\.[a-z]{2,})/gi];

// Namespace XML (xmlns="http://www.w3.org/...") é identificador do padrão, não domínio citado: sai antes da busca por host.
const XMLNS = /\sxmlns(?::[a-z]+)?="http:\/\/www\.w3\.org\/[^"]*"/gi;

const normalize = value => value.trim().replace(/^["']|["']$/g, '').toLowerCase();

export function findViolations(text, allowedCompanies) {
  const allowed = new Set(allowedCompanies.map(normalize));
  const violations = [];
  for (const pattern of COMPANY) {
    for (const match of text.matchAll(pattern)) {
      if (!allowed.has(normalize(match[1]))) violations.push({ kind: 'empresa' });
    }
  }
  const semNamespace = text.replace(XMLNS, '');
  for (const pattern of HOSTS) {
    for (const match of semNamespace.matchAll(pattern)) {
      const host = match[1].toLowerCase().replace(/\.$/, '');
      if (!/(^|\.)(test|example)$/.test(host) && host !== 'localhost' && host !== '127.0.0.1') violations.push({ kind: 'dominio' });
    }
  }
  return violations;
}
