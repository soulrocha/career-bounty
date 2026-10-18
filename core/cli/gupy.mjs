import { readFile } from 'node:fs/promises';
import { loadSettings } from '../config.mjs';
import { lerBase } from '../kb/base.mjs';
import { carregarFontes } from '../kb/fontes.mjs';
import { embrulhar } from '../privacy/untrusted.mjs';
import { iniciarPerfil, proporPerfil, editarPerfil, confirmarPerfil, encerrarPerfil } from '../apply/gupyProfile.mjs';

const uso = 'Uso: gupy perfil iniciar --aba <id> | propor --aba <id> --extracao <json> --proposta <json> | editar --aba <id> --secao <secao> --hash <sha256> | confirmar --aba <id> --secao <secao> --extracao <json> | encerrar --aba <id> [--forcar]';
const json = async file => JSON.parse(await readFile(file, 'utf8'));
// O texto atual vem da página (dado não confiável): sai embrulhado; o perfil cru não volta ao modelo.
const textoDaPagina = valor => (Array.isArray(valor) ? valor.map(v => embrulhar(String(v))) : valor === null || valor === undefined ? null : embrulhar(String(valor)));
const resumoDaProposta = d => ({
  proposta_hash: d.proposta_hash,
  itens: d.itens.map(i => ({ secao: i.secao, hash: i.hash, antes_hash: i.antes_hash, ...(i.manual ? { manual: true } : {}), atual: textoDaPagina(i.atual), proposto: i.proposto })),
  ignoradas: d.ignoradas ?? [],
});

export const gupyCommands = {
  async gupy(rest, { parseFlags }) {
    const [perfil, sub, ...flags] = rest;
    const permitidos = { iniciar: ['--aba'], propor: ['--aba', '--extracao', '--proposta'], editar: ['--aba', '--secao', '--hash'], confirmar: ['--aba', '--secao', '--extracao'], encerrar: ['--aba', '--forcar'] };
    if (perfil !== 'perfil' || !Object.hasOwn(permitidos, sub)) throw Error(uso);
    const comValor = permitidos[sub].filter(k => k !== '--forcar');
    const values = parseFlags(flags, { allowed: permitidos[sub], withValue: comValor });
    if (comValor.some(k => !values[k])) throw Error(uso);
    const { dataRoot, ...settings } = await loadSettings();
    const args = { tabId: values['--aba'], ts: process.env.CAREER_BOUNTY_NOW ?? new Date().toISOString() };
    if (sub === 'iniciar') return { result: await iniciarPerfil(dataRoot, args) };
    if (sub === 'encerrar') return { result: await encerrarPerfil(dataRoot, { ...args, forcar: Boolean(values['--forcar']) }) };
    if (sub === 'confirmar') return { result: await confirmarPerfil(dataRoot, { ...args, secao: values['--secao'], extracao: await json(values['--extracao']) }) };
    const { claims: afirmacoes } = await lerBase((await carregarFontes({ dataRoot, settings })).fontes);
    if (sub === 'propor') return { result: resumoDaProposta(await proporPerfil(dataRoot, { ...args, extracao: await json(values['--extracao']), proposta: await json(values['--proposta']), afirmacoes })) };
    return { result: { script: await editarPerfil(dataRoot, { ...args, secao: values['--secao'], hash: values['--hash'], afirmacoes }) } };
  },
};
