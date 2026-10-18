// Preferência de vaga da pessoa: modalidades aceitas, a preferida e a região onde presencial ou híbrido serve.
// O /setup pergunta e chama este comando; ele valida antes de gravar e preserva o resto do config.yml.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateSettings } from '../config.mjs';
import { fold } from '../dedup/keys.mjs';
import { atomicJson } from '../store/atomicWrite.mjs';
import { resolveDataRoot } from '../store/dataRoot.mjs';

const lista = valor => valor.split(',').map(item => item.trim()).filter(Boolean);

async function lerConfig(arquivo) {
  try { return JSON.parse(await readFile(arquivo, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`config.yml inválido (precisa ser JSON): ${error.message}`);
  }
}

function resumo(criterios = {}) {
  return {
    modalidades: criterios.modalidades ?? [],
    modalidade_preferida: criterios.modalidade_preferida ?? null,
    regiao_presencial: criterios.regiao_presencial ?? [],
    definidas: Boolean(criterios.modalidades?.length),
  };
}

function texto(r) {
  if (!r.definidas) return 'Preferência de modalidade não definida. Use --modalidades remoto,hibrido,presencial [--preferida remoto] [--regiao "cidade, cidade"].';
  return [`Modalidades aceitas: ${r.modalidades.join(', ')}`, `Preferida: ${r.modalidade_preferida ?? 'nenhuma'}`,
    `Região para presencial e híbrido: ${r.regiao_presencial.join(', ') || 'não definida (presencial não elimina)'}`].join('\n');
}

export const preferenciasCommands = {
  async preferencias(rest, { parseFlags }) {
    const flags = parseFlags(rest, { allowed: ['--modalidades', '--preferida', '--regiao'], withValue: ['--modalidades', '--preferida', '--regiao'] });
    const arquivo = path.join(resolveDataRoot(), 'config.yml');
    const config = await lerConfig(arquivo);
    const alterar = ['--modalidades', '--preferida', '--regiao'].some(flag => flags[flag] !== undefined);
    if (!alterar) {
      const r = resumo(validateSettings(config).radar.criterios);
      return { result: r, text: texto(r) };
    }
    const criterios = { ...(config.radar?.criterios ?? {}) };
    if (flags['--modalidades'] !== undefined) criterios.modalidades = lista(flags['--modalidades']);
    if (flags['--preferida'] !== undefined) criterios.modalidade_preferida = flags['--preferida'].trim();
    if (flags['--regiao'] !== undefined) criterios.regiao_presencial = lista(flags['--regiao']).map(fold);
    const novo = { ...config, radar: { ...(config.radar ?? {}), criterios } };
    // Valida antes de gravar e grava a forma normalizada (sem acento, sem repetição).
    const validado = validateSettings(novo).radar.criterios;
    for (const chave of ['modalidades', 'modalidade_preferida', 'regiao_presencial']) if (validado[chave] !== undefined) criterios[chave] = validado[chave];
    await atomicJson(arquivo, novo);
    const r = resumo(validado);
    return { result: r, text: texto(r) };
  },
};
