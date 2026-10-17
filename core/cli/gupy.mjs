import { readFile } from 'node:fs/promises';
import { loadSettings } from '../config.mjs';
import { lerBase } from '../kb/base.mjs';
import { carregarFontes } from '../kb/fontes.mjs';
import { iniciarPerfil, proporPerfil, editarPerfil, confirmarPerfil } from '../apply/gupyProfile.mjs';

const uso = 'Uso: gupy perfil iniciar --aba <id> | propor --aba <id> --extracao <json> --proposta <json> | editar --aba <id> --secao <secao> --hash <sha256> | confirmar --aba <id> --secao <secao> --extracao <json>';
const json = async file => JSON.parse(await readFile(file, 'utf8'));
export const gupyCommands = {
  async gupy(rest, { parseFlags }) {
    const [perfil, sub, ...flags] = rest;
    const permitidos = { iniciar: ['--aba'], propor: ['--aba', '--extracao', '--proposta'], editar: ['--aba', '--secao', '--hash'], confirmar: ['--aba', '--secao', '--extracao'] };
    if (perfil !== 'perfil' || !Object.hasOwn(permitidos, sub)) throw Error(uso);
    const values = parseFlags(flags, { allowed: permitidos[sub], withValue: permitidos[sub] });
    if (permitidos[sub].some(k => !values[k])) throw Error(uso);
    const { dataRoot, ...settings } = await loadSettings();
    const args = { tabId: values['--aba'], ts: process.env.CAREER_BOUNTY_NOW ?? new Date().toISOString() };
    if (sub === 'iniciar') return { result: await iniciarPerfil(dataRoot, args) };
    if (sub === 'confirmar') return { result: await confirmarPerfil(dataRoot, { ...args, secao: values['--secao'], extracao: await json(values['--extracao']) }) };
    const { claims: afirmacoes } = await lerBase((await carregarFontes({ dataRoot, settings })).fontes);
    if (sub === 'propor') return { result: await proporPerfil(dataRoot, { ...args, extracao: await json(values['--extracao']), proposta: await json(values['--proposta']), afirmacoes }) };
    return { result: { script: await editarPerfil(dataRoot, { ...args, secao: values['--secao'], hash: values['--hash'], afirmacoes }) } };
  },
};
