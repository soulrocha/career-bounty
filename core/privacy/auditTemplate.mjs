import { readFile } from 'node:fs/promises';
import { scanText } from './scan.mjs';

// Auditoria de um template de painel antes de copiá-lo para o repositório público.
// O relatório traz só tipo e posição; o valor encontrado nunca é impresso nem guardado.

const DATA_IMAGE = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]{200,}/gi;

export const VERIFICACOES = ['imagem-base64', 'email', 'telefone', 'cpf', 'caminho-usuario', 'caminho-vault', 'empresa-denylist', 'identidade'];

export function auditTemplate(text, context) {
  const achados = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const match of line.matchAll(DATA_IMAGE)) achados.push({ tipo: 'imagem-base64', linha: index + 1, coluna: match.index + 1 });
  });
  // As imagens já foram tratadas; sem elas o restante é varrido por linha, como no pre-commit.
  const semImagens = text.replace(DATA_IMAGE, 'IMAGEM');
  for (const finding of scanText(semImagens, context, 'template')) achados.push({ tipo: finding.rule, linha: finding.line });
  const avisos = context.hasIdentity ? [] : ['identity.yml ausente: valores de identidade não foram verificados.'];
  const verificados = VERIFICACOES.filter(tipo => tipo !== 'identidade' || context.hasIdentity);
  achados.sort((a, b) => a.linha - b.linha || a.tipo.localeCompare(b.tipo));
  return { ok: achados.length === 0, verificados, achados, avisos };
}

export async function auditTemplateFile(filename, context) {
  return auditTemplate(await readFile(filename, 'utf8'), context);
}
