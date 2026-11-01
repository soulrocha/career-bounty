// Sincronização vista do painel: uma rodada ao abrir (esperada só quando falta o estado ou a projeção, como num PC
// novo), outra a cada intervalo e outra logo depois de cada gravação. Falha nunca derruba o painel: vira status.
import { access } from 'node:fs/promises';
import path from 'node:path';
import { lerConfigSync, sincronizacaoOcupada, sincronizar } from '../core/sync/index.mjs';

export async function criarSyncDoPainel({ dataRoot, sincronizador, intervaloSyncMs, esperaSyncMs = 3000 }) {
  const config = sincronizador ? null : await lerConfigSync(dataRoot).catch(() => null);
  const rodada = sincronizador ?? (config ? () => sincronizar({ dataRoot }) : null);
  if (!rodada) return { inicial: async () => {}, agendar: () => {}, status: () => ({ configurado: false }), parar: () => {} };

  let estado = { ok: null, ultima: null, erro: null, conflitos: [] };
  let dadosNovos = 0;
  let emCurso = null;
  let deNovo = false;
  let espera = null;

  const rodar = () => {
    if (emCurso) { deNovo = true; return emCurso; }
    emCurso = (async () => {
      try {
        const r = await rodada();
        dadosNovos += (r.baixados ?? 0) + (r.apagados_local ?? 0);
        estado = { ok: true, ultima: r.ultima ?? new Date().toISOString(), erro: null, conflitos: r.conflitos ?? [], pendentes: r.pendentes ?? [] };
      } catch (error) {
        if (sincronizacaoOcupada(error)) return; // outra rodada (hook ou CLI) está em curso: o estado anterior vale
        estado = { ...estado, ok: false, ultima: new Date().toISOString(), erro: String(error.message ?? error).slice(0, 300) };
      } finally {
        emCurso = null;
        if (deNovo) { deNovo = false; rodar(); }
      }
    })();
    return emCurso;
  };

  const timer = setInterval(rodar, intervaloSyncMs ?? (config?.intervalo_s ?? 120) * 1000);
  timer.unref();
  const existe = rel => access(path.join(dataRoot, rel)).then(() => true, () => false);

  return {
    async inicial() {
      const faltaBase = !(await existe('state/migration.json')) || !(await existe('projections/pipeline-vagas.json'));
      if (faltaBase) await rodar(); else rodar();
    },
    agendar() {
      clearTimeout(espera);
      espera = setTimeout(rodar, esperaSyncMs);
      espera.unref();
    },
    status: () => ({ configurado: true, em_curso: Boolean(emCurso), ...estado, dados_novos: dadosNovos }),
    parar() { clearInterval(timer); clearTimeout(espera); },
  };
}
