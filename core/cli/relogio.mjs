// core/cli/relogio.mjs
// Helper compartilhado para obtenção do relógio atual com suporte a relógio simulado (--now + --teste).

export function relogio(values) {
  if (!values['--now']) return new Date();
  if (!values['--teste']) throw new Error('--now só é aceito junto com --teste (relógio simulado, para testes).');
  const now = new Date(values['--now']);
  if (Number.isNaN(now.getTime())) throw new Error('Opção inválida: --now deve ser uma data ISO.');
  return now;
}
