// vault plan: gera a proposta de mudanças no Vault em DATA_ROOT/outbox/vault. Não existe "apply": o Vault só muda por mão humana.
import { loadSettings } from '../config.mjs';
import { analisarBase } from '../kb/analise.mjs';
import { gravarProposta } from '../kb/outbox.mjs';
import { montarPropostaVault, NOME_PROPOSTA } from '../kb/vaultProposal.mjs';

export const vaultCommands = {
  async vault(rest, { parseFlags }) {
    const [sub, ...flags] = rest;
    if (sub === 'apply') throw new Error('O subcomando apply não existe: as mudanças no Vault são feitas à mão, a partir da proposta de "vault plan".');
    if (sub !== 'plan') throw new Error(`Subcomando vault desconhecido: ${sub ?? ''}`.trim());
    parseFlags(flags, { allowed: [] });
    const settings = await loadSettings();
    const { base, itens } = await analisarBase({ dataRoot: settings.dataRoot, settings });
    const proposta = await gravarProposta(settings.dataRoot, 'vault', NOME_PROPOSTA, montarPropostaVault({ arcos: base.arcos, itens, afirmacoes: base.claims }));
    return { result: { proposta, itens: 5 }, text: `proposta gravada em ${proposta} (nenhum arquivo do Vault foi alterado)` };
  },
};
