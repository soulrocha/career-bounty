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

// Origem (https://host) permitida para o portal; URL com usuário/senha, outro host ou outro esquema não passa.
export function origemPermitida(portal, url) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (u.username || u.password) return false;
  return Array.isArray(portal?.origens) && portal.origens.includes(u.origin);
}

const ordenar = v => (Array.isArray(v) ? v.map(ordenar) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordenar(v[k])])) : v);
// Hash estável (chaves em ordem) das respostas que o driver vai usar: é o que a aprovação da política amarra.
export const hashRespostas = respostas => createHash('sha256').update(JSON.stringify(ordenar(respostas ?? null))).digest('hex');
const hashArquivo = async caminho => createHash('sha256').update(await readFile(caminho)).digest('hex');

// portal: { nome, origens, sucesso: RegExp, erro: RegExp }. cv: { caminho, sha256 }.
// antesDoClique({ hashPdf, hashRespostas }): última checagem do chamador (kill switch, consumo da aprovação); devolver { bloquear } impede o clique.
export async function executarDriver({ portal, url, respostas, empresa = null, hoje, cv, dryRun = true, timeoutMs = TEMPO_MAX_MS, navegador, antesDoClique = async () => undefined, abrir = abrirNavegador }) {
  if (!origemPermitida(portal, url)) return bloqueado('origem_nao_permitida', { detalhe: 'só https nas origens do portal, sem credencial na URL' });
  if (cv && (await hashArquivo(cv.caminho)) !== cv.sha256) return bloqueado('pdf_diferente', { detalhe: 'o PDF no disco não é o aprovado (hash diferente)' });
  const browser = await abrir(navegador ? { navegador } : {});
  let clicou = false;
  const trabalho = (async () => {
    const p = await browser.novaPagina();
    await p.ir(url);
    const origemAtual = async () => String(await p.avaliar('location.origin'));
    if (!portal.origens.includes(await origemAtual())) return bloqueado('origem_inesperada', { detalhe: 'a página abriu fora das origens do portal' });
    const textoDaPagina = async () => String(await p.avaliar('document.body ? document.body.innerText : ""'));
    const extracao = normalizarExtracao(await p.avaliar(SCRIPT_EXTRATOR));
    if (bloqueadaPorHumano(extracao)) return bloqueado(Object.entries(extracao.bloqueios).filter(([, v]) => v).map(([k]) => k).join(','));
    if (!extracao.campos.length) return bloqueado('dom_mudou', { detalhe: 'nenhum campo reconhecido' });
    // Sucesso só vale se aparecer DEPOIS do clique: texto de confirmação já na página do formulário é suspeito.
    if (portal.sucesso.test(await textoDaPagina())) return bloqueado('dom_suspeito', { detalhe: 'a página já mostra texto de sucesso antes do envio' });
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
    if (!portal.origens.includes(await origemAtual())) return bloqueado('origem_inesperada', { detalhe: 'a página saiu das origens do portal antes do clique' });
    // Reconfere o PDF na hora do clique (o navegador lê o arquivo ao enviar) e deixa o chamador fazer a última checagem.
    const hashPdf = cv ? await hashArquivo(cv.caminho) : null;
    if (cv && hashPdf !== cv.sha256) return bloqueado('pdf_diferente', { detalhe: 'o PDF mudou depois de aprovado' });
    const pre = await antesDoClique({ hashPdf, hashRespostas: hashRespostas(respostas) });
    if (pre?.bloquear) return bloqueado(pre.bloquear, pre.detalhe ? { detalhe: pre.detalhe } : {});
    clicou = true;
    const clique = await p.avaliar(scriptDeEnvio('driver'));
    if (clique?.erro) return { estado: 'incerta', motivo: clique.erro };
    // Página de sucesso ou de erro: espera a navegação ou a mensagem aparecer.
    for (let i = 0; i < 40; i++) {
      await espera(250);
      let texto = '';
      try { texto = await textoDaPagina(); } catch { continue; }
      if (portal.erro.test(texto)) return { estado: 'falhou', motivo: 'o portal recusou o envio', detalhe: texto.match(portal.erro)[0] };
      const m = portal.sucesso.exec(texto);
      if (m) {
        const origem = await origemAtual();
        if (!portal.origens.includes(origem)) return { estado: 'incerta', motivo: 'depois do clique a página foi para fora do portal; confirme pelo e-mail' };
        return { estado: 'enviada', comprovante: { texto: m[0], url: origem, data: new Date().toISOString(), ...(cv ? { pdf_sha256: cv.sha256 } : {}) }, preenchidos };
      }
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
