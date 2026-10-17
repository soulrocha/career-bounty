// Driver base (F7.5, seam S8): envio em formulário público sem login, sem LLM, em navegador efêmero (perfil temporário,
// sem cookies, sem sessão da pessoa, sem acesso a secrets/). Contrato: dry-run preenche e para antes do clique; campo
// desconhecido, captcha, login ou DOM inesperado devolvem "blocked" com motivo e nada é enviado; só o PDF aprovado (hash
// conferido) é anexado; um único clique; comprovante lido por script. Quem chama decide a política e grava a tentativa.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { abrirNavegador } from '../../browser/cdp.mjs';
import { SCRIPT_EXTRATOR, bloqueadaPorHumano, normalizarExtracao, seletorDoCampo } from '../extrator.mjs';
import { casarCampos } from '../matcher.mjs';
import { scriptDePreenchimento } from '../preencher.mjs';
import { scriptDeEnvio } from '../sessao.mjs';

export const TEMPO_MAX_MS = 120_000;
const espera = ms => new Promise(r => setTimeout(r, ms));
const bloqueado = (motivo, extra = {}) => ({ estado: 'blocked', motivo, ...extra });

// portal: { nome, sucesso: RegExp, erro: RegExp }. cv: { caminho, sha256 }. antesDoClique: async () => void (grava "incerta").
export async function executarDriver({ portal, url, respostas, empresa = null, hoje, cv, dryRun = true, timeoutMs = TEMPO_MAX_MS, navegador, antesDoClique = async () => {}, abrir = abrirNavegador }) {
  if (!/^https?:\/\//.test(String(url))) return bloqueado('url_invalida');
  if (cv) {
    const sha = createHash('sha256').update(await readFile(cv.caminho)).digest('hex');
    if (sha !== cv.sha256) return bloqueado('pdf_diferente', { detalhe: 'o PDF no disco não é o aprovado (hash diferente)' });
  }
  const browser = await abrir(navegador ? { navegador } : {});
  let clicou = false;
  const trabalho = (async () => {
    const p = await browser.novaPagina();
    await p.ir(url);
    const extracao = normalizarExtracao(await p.avaliar(SCRIPT_EXTRATOR));
    if (bloqueadaPorHumano(extracao)) return bloqueado(Object.entries(extracao.bloqueios).filter(([, v]) => v).map(([k]) => k).join(','));
    if (!extracao.campos.length) return bloqueado('dom_mudou', { detalhe: 'nenhum campo reconhecido' });
    const casamento = casarCampos({ extracao, respostas, portal: portal.nome, empresa, hoje });
    if (casamento.desconhecidos.length) return bloqueado('campo_desconhecido', { campos: casamento.desconhecidos.map(c => ({ ref: c.ref, label: c.label, tipo: c.tipo, opcoes: c.opcoes })) });
    const arquivos = casamento.preenchimentos.filter(x => x.tipo === 'file');
    if (arquivos.length && !cv) return bloqueado('sem_cv', { detalhe: 'o formulário pede currículo e não há PDF aprovado' });
    const preenchido = await p.avaliar(scriptDePreenchimento(casamento.preenchimentos, { sensiveis: true }));
    if (preenchido.falharam.length) return bloqueado('preenchimento_falhou', { refs: preenchido.falharam });
    for (const a of arquivos) await p.anexar(seletorDoCampo(a.ref), [cv.caminho]);
    const preenchidos = casamento.preenchimentos.map(x => x.ref);
    if (dryRun) return { estado: 'dry_run', preenchidos };
    const botoes = normalizarExtracao(await p.avaliar(SCRIPT_EXTRATOR)).botoes_envio;
    if (botoes.length !== 1) return bloqueado('dom_mudou', { detalhe: `esperado 1 botão de envio, achados ${botoes.length}` });
    await antesDoClique();
    clicou = true;
    const clique = await p.avaliar(scriptDeEnvio('driver'));
    if (clique?.erro) return { estado: 'incerta', motivo: clique.erro };
    // Página de sucesso ou de erro: espera a navegação ou a mensagem aparecer.
    for (let i = 0; i < 40; i++) {
      await espera(250);
      let texto = '';
      try { texto = String(await p.avaliar('document.body ? document.body.innerText : ""')); } catch { continue; }
      if (portal.erro.test(texto)) return { estado: 'falhou', motivo: 'o portal recusou o envio', detalhe: texto.match(portal.erro)[0] };
      const m = portal.sucesso.exec(texto);
      if (m) return { estado: 'enviada', comprovante: { texto: m[0], url: await p.avaliar('location.origin'), data: new Date().toISOString(), ...(cv ? { pdf_sha256: cv.sha256 } : {}) }, preenchidos };
    }
    return { estado: 'enviada_sem_comprovante', preenchidos };
  })();
  try {
    let timer;
    const limite = new Promise(resolve => { timer = setTimeout(() => resolve(clicou ? { estado: 'incerta', motivo: 'tempo esgotado depois do clique' } : bloqueado('timeout')), timeoutMs); });
    const r = await Promise.race([trabalho, limite]);
    clearTimeout(timer);
    return r;
  } catch (e) {
    return clicou ? { estado: 'incerta', motivo: String(e.message).slice(0, 200) } : bloqueado('erro', { detalhe: String(e.message).slice(0, 200) });
  } finally {
    await browser.fechar();
  }
}
