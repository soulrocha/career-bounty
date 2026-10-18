// core/cli/empresa.mjs
// Comandos CLI para gestão e coleta de reputação de empresas (F9.4).
import { randomUUID } from 'node:crypto';
import { loadSettings } from '../config.mjs';
import { companyKey } from '../dedup/keys.mjs';
import { appendEvents } from '../store/events.mjs';
import { localDay } from '../store/schema.mjs';
import { validarEmpresaAvaliada } from '../store/rules.mjs';
import { avaliarEmpresa } from '../company/evaluator.mjs';
import { runnerDasOpcoes } from './llm.mjs';
import { relogio } from './relogio.mjs';

function inferirPlataforma(url) {
  if (!url || typeof url !== 'string') return 'Outro';
  const lower = url.toLowerCase();
  if (lower.includes('glassdoor')) return 'Glassdoor';
  if (lower.includes('indeed')) return 'Indeed';
  if (lower.includes('catho')) return 'Catho';
  return 'Outro';
}

export const empresaCommands = {
  async empresa(rest, options = {}) {
    const { parseFlags } = options;
    const [sub, ...flags] = rest;
    const settings = await loadSettings(options.dataRoot ? { dataRoot: options.dataRoot } : undefined);
    const dataRoot = options.dataRoot ?? settings.dataRoot;

    if (sub === 'registrar') {
      const values = parseFlags(flags, {
        allowed: ['--empresa', '--nota', '--quantidade', '--fonte', '--plataforma', '--resumo', '--data', '--validade', '--now', '--teste'],
        withValue: ['--empresa', '--nota', '--quantidade', '--fonte', '--plataforma', '--resumo', '--data', '--validade', '--now']
      });

      const now = relogio(values);
      const ts = now.toISOString();

      const empresa = values['--empresa'];
      if (!empresa) throw new Error('Opção obrigatória ausente: --empresa.');

      const notaRaw = values['--nota'];
      if (notaRaw === undefined) throw new Error('Opção obrigatória ausente: --nota.');
      const nota = Number(notaRaw);

      const quantidadeRaw = values['--quantidade'];
      if (quantidadeRaw === undefined) throw new Error('Opção obrigatória ausente: --quantidade.');
      const quantidade = Number(quantidadeRaw);

      const fonteUrl = values['--fonte'];
      if (!fonteUrl) throw new Error('Opção obrigatória ausente: --fonte.');

      const plataforma = values['--plataforma'] || inferirPlataforma(fonteUrl);
      const data = values['--data'] ?? localDay(ts);
      const resumo = values['--resumo'] ?? null;
      const validadeDias = values['--validade'] ? Number(values['--validade']) : 90;

      const chave = companyKey(empresa);

      const dados = {
        empresa,
        empresa_chave: chave,
        nota,
        quantidade,
        plataforma,
        data,
        fontes: [{ url: fonteUrl, plataforma }],
        resumo,
        validade_dias: validadeDias
      };

      const erro = validarEmpresaAvaliada(dados, ts);
      if (erro) throw new Error(`Opção inválida: ${erro}`);

      const evento = {
        id: `avaliacao:${chave}:${data}:${randomUUID().slice(0, 6)}`,
        ts,
        ator: 'usuario',
        tipo: 'empresa.avaliada',
        entidade: 'empresa',
        entidade_id: chave,
        dados
      };

      await appendEvents(dataRoot, [evento], { now: ts });

      const text = `Avaliação registrada: [${plataforma}] ${empresa} — Nota: ${nota} (${quantidade} avaliações) | Validade: ${validadeDias} dias`;
      return {
        result: {
          ok: true,
          id: evento.id,
          empresa,
          empresa_chave: chave,
          nota,
          quantidade,
          plataforma,
          data,
          validade_dias: validadeDias
        },
        text
      };
    }

    if (sub === 'avaliar') {
      const values = parseFlags(flags, {
        allowed: ['--empresa', '--live', '--replay', '--gravar', '--now', '--teste'],
        withValue: ['--empresa', '--replay', '--now']
      });

      const empresa = values['--empresa'];
      if (!empresa) throw new Error('Opção obrigatória ausente: --empresa.');

      const now = relogio(values);
      const runner = options.runner ?? await runnerDasOpcoes(values, settings);

      const dados = await avaliarEmpresa({
        empresa,
        dataRoot,
        runner,
        now
      });

      const text = `Avaliação concluída: [${dados.plataforma}] ${dados.empresa} — Nota: ${dados.nota} (${dados.quantidade} avaliações) | Validade: ${dados.validade_dias} dias`;
      return {
        result: {
          ok: true,
          ...dados
        },
        text
      };
    }

    throw new Error(`Subcomando empresa desconhecido: ${sub ?? ''}`.trim());
  }
};
