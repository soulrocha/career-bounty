import assert from 'node:assert/strict';
import test from 'node:test';
import { cabecalhoDownloadCv, nomeArquivoCv } from '../../core/cv/artifacts.mjs';

test('o PDF para enviar se chama Empresa-Vaga-Nome.pdf e o visual leva o sufixo', () => {
  assert.equal(nomeArquivoCv({ empresa: 'Empresa Alfa', cargo: 'Gerente de Produto', nome: 'Ana Exemplo', tipo: 'ats' }), 'Empresa Alfa-Gerente de Produto-Ana Exemplo.pdf');
  assert.equal(nomeArquivoCv({ empresa: 'Empresa Alfa', cargo: 'Gerente de Produto', nome: 'Ana Exemplo', tipo: 'visual' }), 'Empresa Alfa-Gerente de Produto-Ana Exemplo (visual).pdf');
});

test('caracteres proibidos no Windows, emoji e espaços repetidos saem do nome; acento fica', () => {
  assert.equal(nomeArquivoCv({ empresa: 'Somos 💚 Ltda.', cargo: 'Sênior Tech Manager | Jornada: "Empresa"/BR?', nome: 'Ana Exemplo', tipo: 'ats' }),
    'Somos Ltda-Sênior Tech Manager Jornada Empresa BR-Ana Exemplo.pdf');
});

test('parte vazia é omitida e nome muito longo é cortado', () => {
  assert.equal(nomeArquivoCv({ empresa: '', cargo: 'Gerente', nome: '', tipo: 'ats' }), 'Gerente.pdf');
  assert.equal(nomeArquivoCv({ empresa: '', cargo: '', nome: '', tipo: 'ats' }), 'curriculo.pdf');
  assert.ok(nomeArquivoCv({ empresa: 'E'.repeat(300), cargo: 'C', nome: 'N', tipo: 'ats' }).length <= 150);
});

test('o cabeçalho abre o PDF na aba e sugere o nome, com fallback ASCII', () => {
  assert.equal(cabecalhoDownloadCv('Sênior-Ana.pdf'), `inline; filename="Senior-Ana.pdf"; filename*=UTF-8''S%C3%AAnior-Ana.pdf`);
});
