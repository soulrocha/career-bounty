// F6.13: contrato semântico sintético; DOM e referência da conta real ainda não verificados.
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validarProposta, LIMITES_PORTAL } from '../cv/perfilPortal.mjs';
import { atomicJson } from '../store/atomicWrite.mjs';
import { withLock } from '../store/lock.mjs';
import { appendEvent } from '../store/events.mjs';

// Duas versões de DOM: gupy-curriculo-v1 (página real "Meu currículo", estrutura observada em 17/10/2026, só leitura) e
// synthetic-v1 (fixture de contrato). A real não tem "Sobre você" (sobre: null) nem id de conta visível: a conta é um hash
// opaco das empresas das experiências. Nada de contato, documento ou diversidade é lido.
export function extrairPerfil(doc, loc) {
  try {
    if (!/^https:\/\/(?:[a-z0-9-]+\.)?gupy\.io$/.test(loc.origin)) throw Error('origem não reconhecida');
    const leitura = { leitura_id: `document-${performance.timeOrigin.toString(16).replace('.', '-')}`, recarregada: performance.getEntriesByType('navigation')[0]?.type === 'reload' };
    if (!doc.querySelector('[data-gupy-profile]')) {
      const titulo = [...doc.querySelectorAll('h1')].filter(h => h.textContent.replace(/\s+/g, ' ').trim() === 'Meu currículo');
      if (titulo.length !== 1 || (loc.pathname !== undefined && loc.pathname !== '/candidates/curriculum')) throw Error('DOM não reconhecido');
      const indices = [...doc.querySelectorAll('input[id^="companyName-"]')].map(e => /^companyName-(\d{1,3})$/.exec(e.id)?.[1]);
      if (!indices.length || indices.some(i => i === undefined) || new Set(indices).size !== indices.length) throw Error('experiências não reconhecidas');
      const unico = id => { const l = doc.querySelectorAll(`#${CSS.escape(id)}`); if (l.length !== 1) throw Error('campo ambíguo'); return l[0]; };
      const experiencias = indices.map(n => {
        const empresa = unico(`companyName-${n}`), cargo = unico(`role-${n}`), descricao = unico(`activitiesPerformed-${n}`);
        if (empresa.tagName !== 'INPUT' || cargo.tagName !== 'INPUT' || descricao.tagName !== 'TEXTAREA') throw Error('campo inesperado');
        return { id: `p${n}`, empresa: empresa.value, cargo: cargo.value, descricao: descricao.value };
      });
      const habilidades = [...doc.querySelectorAll('[data-testid="candidate-skill"]')].map(b => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
      let h = 0x811c9dc5;
      for (const ch of experiencias.map(e => e.empresa.trim().toLowerCase()).join('|')) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
      return { versao: 'gupy-curriculo-v1', origem: loc.origin, perfil_id: `conta-${h.toString(16).padStart(8, '0')}`, ...leitura, sobre: null, experiencias, habilidades };
    }
    const roots = doc.querySelectorAll('[data-gupy-profile]');
    if (roots.length !== 1 || roots[0].getAttribute('data-gupy-profile') !== 'synthetic-v1') throw Error('DOM não reconhecido');
    const root = roots[0], id = root.getAttribute('data-profile-id');
    if (!/^[A-Za-z0-9_-]{3,100}$/.test(id || '')) throw Error('conta não reconhecida');
    const sections = [...root.querySelectorAll('[data-profile-section]')], seen = new Set();
    const out = { versao: 'synthetic-v1', origem: loc.origin, perfil_id: id, ...leitura, sobre: '', experiencias: [], habilidades: [] };
    for (const s of sections) {
      const field = s.getAttribute('data-profile-section'), values = s.querySelectorAll('[data-profile-value]');
      if (seen.has(field) || values.length !== 1) throw Error('seção ambígua');
      seen.add(field);
      const v = values[0].value;
      if (typeof v !== 'string') throw Error('valor não reconhecido');
      if (field === 'sobre') out.sobre = v;
      else if (field === 'habilidades') out.habilidades = JSON.parse(v);
      else {
        const exp = s.getAttribute('data-experience-id');
        const companies = s.querySelectorAll('[data-company]'), roles = s.querySelectorAll('[data-role]');
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(exp || '') || field !== `experiencia:${exp}` || companies.length !== 1 || roles.length !== 1) throw Error('experiência não reconhecida');
        out.experiencias.push({ id: exp, empresa: companies[0].textContent, cargo: roles[0].textContent, descricao: v });
      }
    }
    if (!seen.has('sobre') || !seen.has('habilidades')) throw Error('seções ausentes');
    return out;
  } catch { return { erro: 'perfil/conta/DOM não reconhecido ou ambíguo; ação humana necessária' }; }
}

export const SCRIPT_PERFIL = `(${extrairPerfil.toString()})(document,location)`;
export const hashPerfil = valor => createHash('sha256').update(JSON.stringify(valor)).digest('hex');
const opaco = v => typeof v === 'string' && /^[A-Za-z0-9_-]{3,100}$/.test(v);
const somente = (v, keys) => { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) throw Error('Campo fora do contrato de perfil.'); };
const texto = (s, max) => { if (typeof s !== 'string' || s.length > max) throw Error('Texto de perfil inválido.'); return s; };

export function normalizarPerfil(v) {
  somente(v, ['versao', 'origem', 'perfil_id', 'leitura_id', 'recarregada', 'sobre', 'experiencias', 'habilidades']);
  if (!VERSOES.includes(v.versao) || !/^https:\/\/(?:[a-z0-9-]+\.)?gupy\.io$/.test(v.origem) || !opaco(v.perfil_id) || !opaco(v.leitura_id)) throw Error('Conta, origem ou leitura não reconhecida.');
  if (v.sobre === null && v.versao !== 'gupy-curriculo-v1') throw Error('Seção Sobre ausente.');
  if (!Array.isArray(v.experiencias) || v.experiencias.length > 100 || !Array.isArray(v.habilidades) || v.habilidades.length > 100) throw Error('Seções profissionais inválidas.');
  const ids = new Set();
  const experiencias = v.experiencias.map(e => {
    somente(e, ['id', 'empresa', 'cargo', 'descricao']);
    if (typeof e.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(e.id) || ids.has(e.id)) throw Error('ID de experiência ausente ou repetido.');
    ids.add(e.id);
    return { id: e.id, empresa: texto(e.empresa, 300), cargo: texto(e.cargo, 300), descricao: texto(e.descricao, 10000) };
  });
  return { versao: v.versao, origem: v.origem, perfil_id: v.perfil_id, leitura_id: v.leitura_id, recarregada: v.recarregada === true, sobre: v.sobre === null ? null : texto(v.sobre, 10000), experiencias, habilidades: v.habilidades.map(h => texto(h, 200)) };
}

export const VERSOES = ['synthetic-v1', 'gupy-curriculo-v1'];
// Na página real, habilidades usam autocomplete e chips: o diff mostra o que mudar e a pessoa faz à mão.
const manualNaVersao = (versao, secao) => versao === 'gupy-curriculo-v1' && secao === 'habilidades';

// Abre o acordeão "Experiência" da página real, se estiver fechado. Não altera nem salva nada.
export const SCRIPT_ABRIR_EXPERIENCIA = '(()=>{const N=s=>(s||"").replace(/\\s+/g," ").trim(),b=[...document.querySelectorAll("button,[role=\\"button\\"]")].filter(e=>N(e.textContent)==="Experiência");if(b.length!==1)return{erro:"botão Experiência não encontrado ou ambíguo"};const t=document.querySelector("textarea[id^=\\"activitiesPerformed-\\"]");if(t&&t.getClientRects().length>0)return{aberta:true};b[0].click();return{aberta:"clicada"}})()';

const valor = (p, s) => s === 'sobre' ? p.sobre : s === 'habilidades' ? p.habilidades : p.experiencias.find(e => `experiencia:${e.id}` === s)?.descricao;
export function diffPerfil({ extracao, proposta, afirmacoes }) {
  const perfil = normalizarPerfil(extracao);
  if (proposta?.tipo !== 'proposta' || proposta.portal !== 'gupy' || !Array.isArray(proposta.secoes)) throw Error('Proposta F5.6 inválida.');
  const todas = proposta.secoes.map(s => {
    somente(s, ['campo', 'atual', 'proposto', 'afirmacoes']);
    return { campo: s.campo, proposto: s.proposto, afirmacoes: s.afirmacoes };
  });
  // Página sem "Sobre você": a seção sai do diff, com o motivo, em vez de virar edição impossível.
  const ignoradas = perfil.sobre === null ? todas.filter(s => s.campo === 'sobre').map(s => ({ secao: s.campo, motivo: 'a página de currículo da Gupy não tem campo Sobre você' })) : [];
  const secoes = todas.filter(s => !(perfil.sobre === null && s.campo === 'sobre'));
  validarProposta({ secoes }, { limites: LIMITES_PORTAL.gupy, porId: new Map(afirmacoes.map(a => [a.id, a])), atual: { ...perfil, sobre: perfil.sobre ?? '' }, afirmacoes });
  const itens = secoes.map(s => ({ secao: s.campo, atual: valor(perfil, s.campo), proposto: s.proposto, hash: hashPerfil(s.proposto), antes_hash: hashPerfil(valor(perfil, s.campo)),
    ...(manualNaVersao(perfil.versao, s.campo) ? { manual: true } : {}) })).filter(s => s.antes_hash !== s.hash);
  return { perfil, proposta_hash: hashPerfil(secoes), itens, ignoradas };
}

const arquivo = root => path.join(root, 'state', 'perfil-gupy.json');
export async function lerPerfil(root) {
  try {
    const v = JSON.parse(await readFile(arquivo(root), 'utf8'));
    if (v.versao !== 1 || !Array.isArray(v.abas)) throw Error();
    return v;
  } catch (e) { if (e.code === 'ENOENT') return { versao: 1, abas: [] }; throw Error('Estado de perfil ilegível.'); }
}
const alterar = (root, fn) => withLock(path.join(root, 'state', 'perfil-gupy.lock'), {}, async () => {
  const s = await lerPerfil(root), result = await fn(s);
  await atomicJson(arquivo(root), s);
  return result;
});
const abaDe = (s, { tabId, sessionId }) => {
  const a = s.abas.find(a => a.tab_id === String(tabId));
  if (!a || !a.session_id || (sessionId !== undefined && a.session_id !== sessionId)) throw Error('Aba/sessão de perfil não vinculada.');
  return a;
};
const negar = motivo => ({ decisao: 'negar', motivo });
const avancar = s => (s.sequencia = (s.sequencia ?? 0) + 1);
const instante = ts => { if (!Number.isFinite(Date.parse(ts))) throw Error('Instante inválido.'); return Date.parse(ts); };
const revalidar = (a, afirmacoes) => diffPerfil({ extracao: a.perfil, proposta: a.proposta, afirmacoes });

export const VALIDADE_ABA_PERFIL_H = 24;
const pendente = a => a.itens.some(i => ['incerta', 'humano'].includes(i.estado));
const expiraEm = ts => new Date(Date.parse(ts) + VALIDADE_ABA_PERFIL_H * 3600000).toISOString();

export async function iniciarPerfil(root, { tabId, ts = new Date().toISOString() }) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(tabId ?? ''))) throw Error('Aba explícita obrigatória.');
  return alterar(root, s => {
    const i = s.abas.findIndex(a => a.tab_id === String(tabId));
    const existente = s.abas[i];
    const vencida = existente?.expira_em && Date.parse(existente.expira_em) <= Date.parse(ts);
    if (existente && !vencida) {
      // Recomeçar na mesma aba descarta a proposta antiga (conta ou experiências podem ter mudado), salvo item incerto.
      if (!pendente(existente)) Object.assign(existente, { perfil: null, proposta: null, proposta_hash: null, observacao: null, itens: [] });
      existente.expira_em = expiraEm(ts);
      return { protegida: true, script: SCRIPT_PERFIL, recomecada: !pendente(existente) };
    }
    if (vencida) s.abas.splice(i, 1);
    s.abas.push({ tab_id: String(tabId), session_id: null, perfil: null, proposta: null, itens: [], expira_em: expiraEm(ts) });
    return { protegida: true, script: SCRIPT_PERFIL };
  });
}

// Libera a aba: o navegador volta a ser decidido só pelas outras regras. Item incerto exige reconciliar antes.
export async function encerrarPerfil(root, { tabId, forcar = false }) {
  return alterar(root, s => {
    const a = s.abas.find(x => x.tab_id === String(tabId));
    if (!a) return { encerrada: false };
    if (pendente(a) && !forcar) throw Error('Há item incerto nesta aba: releia e confirme antes de encerrar (ou use --forcar depois de conferir na Gupy).');
    // Encerrar à força com item incerto: o documento aberto pode ter texto não confirmado; a próxima proposta nesta aba
    // só vale com leitura de documento recarregado.
    if (pendente(a)) s.exige_recarga = [...new Set([...(s.exige_recarga ?? []), String(tabId)])];
    s.abas = s.abas.filter(x => x !== a);
    return { encerrada: true };
  });
}

// A identidade da sessão vem do envelope real do hook, nunca da CLI/modelo.
export async function vincularSessaoExtracao(root, { tabId, sessionId, script, toolUseId }) {
  return alterar(root, s => {
    const a = s.abas.find(a => a.tab_id === String(tabId));
    if (!a || typeof sessionId !== 'string' || !opaco(sessionId) || !opaco(toolUseId) || script !== SCRIPT_PERFIL || (a.session_id && a.session_id !== sessionId) || a.chamadas?.includes(toolUseId)) return negar('Extrator/aba/sessão/chamada não vinculados.');
    a.session_id = sessionId;
    a.chamadas = [...(a.chamadas ?? []), toolUseId];
    a.pending_read = { tool_use_id: toolUseId, session_id: sessionId, tab_id: String(tabId), sequencia: avancar(s) };
    return { decisao: 'permitir', motivo: 'Sessão real vinculada ao extrator oficial do perfil.' };
  });
}

// PostToolUse aceita formas explícitas; nunca procura JSON dentro de prosa arbitrária.
export async function observarExtracaoPerfil(root, entrada) {
  const tabId = entrada?.tool_input?.tabId ?? entrada?.tool_input?.tab_id;
  if (!/^mcp__(?:remote-devices__)?(?:claude-in-chrome|Claude_Browser)__javascript_tool$/.test(entrada?.tool_name ?? '') || entrada?.tool_input?.text !== SCRIPT_PERFIL) return false;
  return alterar(root, s => {
    const a = s.abas.find(a => a.tab_id === String(tabId)), pending = a?.pending_read;
    if (!pending || a.session_id !== entrada.session_id || pending.session_id !== entrada.session_id || pending.tab_id !== String(tabId) || pending.tool_use_id !== entrada.tool_use_id) return false;
    a.pending_read = null;
    a.observacao = null;
    try {
      let resposta = entrada.tool_response;
      if (resposta?.isError) return false;
      if (Array.isArray(resposta?.content)) {
        if (resposta.content.length !== 1 || resposta.content[0]?.type !== 'text' || typeof resposta.content[0]?.text !== 'string') return false;
        resposta = JSON.parse(resposta.content[0].text);
      }
      const p = normalizarPerfil(resposta);
      a.observacao = { tool_use_id: entrada.tool_use_id, session_id: entrada.session_id, tab_id: String(tabId), perfil_hash: hashPerfil(p), leitura_id: p.leitura_id, recarregada: p.recarregada, iniciada_seq: pending.sequencia, sequencia: avancar(s), observada_em: new Date().toISOString(), usada: false };
      return true;
    } catch { return false; }
  });
}

export async function proporPerfil(root, args) {
  return alterar(root, s => {
    const a = abaDe(s, args);
    if (a.itens.some(i => ['incerta', 'humano'].includes(i.estado))) throw Error('Perfil incerto: reler e reconciliar antes de nova proposta.');
    const d = diffPerfil(args);
    if (!a.observacao || a.observacao.perfil_hash !== hashPerfil(d.perfil)) throw Error('Proposta exige extração observada pelo PostToolUse oficial.');
    if ((s.exige_recarga ?? []).includes(a.tab_id)) {
      if (!a.observacao.recarregada) throw Error('Esta aba foi encerrada à força com item incerto: recarregue a página e leia de novo antes de propor.');
      s.exige_recarga = s.exige_recarga.filter(t => t !== a.tab_id);
    }
    if (a.perfil && (a.perfil.perfil_id !== d.perfil.perfil_id || a.perfil.origem !== d.perfil.origem)) {
      // Na página real, a conta é o hash das empresas: experiência nova ou renomeada muda o id. Sem item pendente, a nova
      // leitura simplesmente substitui a proposta anterior; com item incerto, é preciso reconciliar antes.
      if (pendente(a) || a.itens.some(i => i.token && !i.token.usada_em)) throw Error('Conta do perfil mudou com item pendente ou aprovado: reconcilie antes.');
    }
    a.perfil = d.perfil;
    a.proposta = args.proposta;
    a.proposta_hash = d.proposta_hash;
    a.criada_em = args.ts ?? new Date().toISOString();
    instante(a.criada_em);
    a.itens = d.itens.map(i => ({ ...i, estado: 'editavel', token: null, script: null }));
    return d;
  });
}

// Código fechado por item: nenhum seletor ou texto da página é interpolado como código.
async function aplicarItem(extrair, vinculo) {
  const fail = () => ({ erro: 'perfil/alvo/hash/formulário mudou; ação humana necessária' });
  try {
    const p = extrair(document, location), v = vinculo;
    if (p.erro || p.perfil_id !== v.perfil_id || p.origem !== v.origem || p.leitura_id !== v.documento_id) return fail();
    if (v.experiencia) {
      const e = p.experiencias.find(e => `experiencia:${e.id}` === v.secao);
      if (!e || e.empresa !== v.experiencia.empresa || e.cargo !== v.experiencia.cargo) return fail();
    }
    const atual = v.secao === 'sobre' ? p.sobre : v.secao === 'habilidades' ? p.habilidades : p.experiencias.find(e => `experiencia:${e.id}` === v.secao)?.descricao;
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(atual)));
    const hash = [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== v.antes_hash) return fail();
    const q = extrair(document, location);
    if (JSON.stringify(p) !== JSON.stringify(q)) return fail();
    if (v.versao === 'gupy-curriculo-v1') {
      // Página real (observada em 17/10/2026): a descrição é editada no próprio campo, com o acordeão "Experiência" aberto
      // (cabeçalho div[role=button]); não há <form>; o "Salvar" da seção fica escondido e aparece depois da alteração.
      // Sem exatamente um "Salvar" visível depois da alteração, o texto original é restaurado e nada é salvo.
      const n = /^experiencia:p(\d{1,3})$/.exec(v.secao)?.[1];
      if (n === undefined) return fail();
      const N = t => (t || '').replace(/\s+/g, ' ').trim();
      // Visível de verdade: sem hidden/inert/aria-hidden, display/visibility/opacity nos ancestrais, tamanho > 0 e sem
      // ancestral com overflow escondido e tamanho zero.
      const vis = e => {
        if (!e || !e.isConnected || e.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
        const r = e.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return false;
        for (let x = e; x && x.nodeType === 1; x = x.parentElement) {
          const c = getComputedStyle(x);
          if (c.display === 'none' || ['hidden', 'collapse'].includes(c.visibility) || Number(c.opacity) === 0) return false;
          if (x !== e && c.overflow !== 'visible') { const q = x.getBoundingClientRect(); if (!(q.width > 0 && q.height > 0)) return false; }
        }
        return true;
      };
      const espera = ms => new Promise(r => setTimeout(r, ms));
      const pegar = () => document.getElementById(`activitiesPerformed-${n}`);
      let campo = pegar();
      if (campo && !vis(campo)) {
        const abrir = [...document.querySelectorAll('button,[role="button"]')].filter(b => N(b.textContent) === 'Experiência');
        if (abrir.length !== 1) return fail();
        abrir[0].click();
        await espera(600);
        campo = pegar();
      }
      const campoOk = () => vis(campo) && campo.tagName === 'TEXTAREA' && document.querySelectorAll(`#activitiesPerformed-${n}`).length === 1 && !campo.disabled && !campo.readOnly;
      if (!campoOk()) return fail();
      // Só conta "Salvar" que pode salvar: desde 26/10/2026 a seção Habilidades mostra o seu "Salvar" desabilitado sem alteração.
      const salvarVisiveis = () => [...document.querySelectorAll('button')].filter(b => N(b.textContent) === 'Salvar' && vis(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true');
      // "Salvar" habilitado antes de alterar = outra seção com alteração não salva: clicar persistiria o que a pessoa não aprovou.
      if (salvarVisiveis().length) return { erro: 'há alteração não salva na página (um "Salvar" já está visível); salve ou descarte antes; ação humana necessária' };
      // Seção Experiência: o maior ancestral do campo que não contém outras seções (habilidades, dados pessoais).
      const OUTRAS = '#skills-search-autocomplete,[data-testid="candidate-skill"],#identityCardNumber,#linkedinProfileUrl,#addressZipCode';
      let secao = campo;
      while (secao.parentElement && !secao.parentElement.querySelector(OUTRAS)) secao = secao.parentElement;
      // Sem limite reconhecível (a seção subiu até o documento), não há como saber de qual seção é o "Salvar".
      if (secao === document.documentElement || secao === document.body || !secao.parentElement) return fail();
      const valido = b => !!b && secao.contains(b) && ['button', 'submit'].includes(b.type) && !b.form && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
      const escrever = (alvo, valor) => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(alvo, valor);
        alvo.dispatchEvent(new Event('input', { bubbles: true }));
        alvo.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const original = campo.value;
      // Desfazer relê o campo (a página pode ter re-renderizado) e confere a página inteira contra a leitura aprovada.
      const desfazer = async () => {
        try { const atualCampo = pegar(); if (atualCampo && atualCampo.value !== original) escrever(atualCampo, original); } catch { /* conferido abaixo */ }
        await espera(300);
        const relida = extrair(document, location);
        return JSON.stringify(relida) === JSON.stringify(p)
          ? { erro: 'perfil/alvo/hash/formulário mudou; ação humana necessária', restaurado: true }
          : { erro: 'restauração não confirmada: recarregue a página SEM salvar e confira na Gupy; ação humana necessária', restaurado: false };
      };
      escrever(campo, v.proposto);
      await espera(500);
      const esperado = JSON.parse(JSON.stringify(p));
      esperado.experiencias.find(e => `experiencia:${e.id}` === v.secao).descricao = v.proposto;
      const s = salvarVisiveis();
      if (pegar() !== campo || !campoOk() || s.length !== 1 || !valido(s[0]) || JSON.stringify(extrair(document, location)) !== JSON.stringify(esperado)) return desfazer();
      s[0].click();
      return { estado: 'incerta', secao: v.secao };
    }
    const roots = document.querySelectorAll('[data-gupy-profile]');
    const sections = [...roots[0].querySelectorAll('[data-profile-section]')].filter(s => s.getAttribute('data-profile-section') === v.secao);
    if (sections.length !== 1) return fail();
    const s = sections[0], fields = s.querySelectorAll('[data-profile-value]'), saves = s.querySelectorAll('[data-profile-save]');
    if (s.tagName !== 'FORM' || fields.length !== 1 || saves.length !== 1) return fail();
    const field = fields[0], save = saves[0];
    const visivel = e => e.isConnected && !e.closest('[hidden],[inert],[aria-hidden="true"]') && !['hidden', 'collapse'].includes(getComputedStyle(e).visibility) && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
    const alvoValido = () => s.tagName === 'FORM' && !s.querySelectorAll('[data-profile-section]').length && s.elements.length === 2 && [...s.elements].every(e => e === field || e === save)
      && s.querySelectorAll('[data-profile-value]').length === 1 && s.querySelector('[data-profile-value]') === field && s.querySelectorAll('[data-profile-save]').length === 1 && s.querySelector('[data-profile-save]') === save
      && field.tagName === 'TEXTAREA' && !field.disabled && !field.readOnly && field.form === s && save.form === s && save.tagName === 'BUTTON' && save.type === 'button' && !save.disabled && save.getAttribute('aria-disabled') !== 'true'
      && save.textContent.trim() === 'Salvar' && visivel(field) && visivel(save);
    if (!alvoValido()) return fail();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(field, Array.isArray(v.proposto) ? JSON.stringify(v.proposto) : v.proposto);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    const final = extrair(document, location);
    const esperado = JSON.parse(JSON.stringify(p));
    if (v.secao === 'sobre') esperado.sobre = v.proposto;
    else if (v.secao === 'habilidades') esperado.habilidades = v.proposto;
    else esperado.experiencias.find(e => `experiencia:${e.id}` === v.secao).descricao = v.proposto;
    if (JSON.stringify(final) !== JSON.stringify(esperado) || !alvoValido()) return fail();
    // Um único clique; resposta não é prova de persistência.
    save.click();
    return { estado: 'incerta', secao: v.secao };
  } catch { return fail(); }
}
export const SCRIPT_RECARREGAR_PERFIL = '(()=>{location.reload();return {releitura:"necessaria"}})()';
export const scriptDoItem = (a, i) => `(${aplicarItem.toString()})(${extrairPerfil.toString()},${JSON.stringify({ versao: a.perfil.versao, perfil_id: a.perfil.perfil_id, origem: a.perfil.origem, documento_id: a.observacao.leitura_id, secao: i.secao, antes_hash: i.antes_hash, proposto: i.proposto, ...(i.secao.startsWith('experiencia:') ? { experiencia: (({ empresa, cargo }) => ({ empresa, cargo }))(a.perfil.experiencias.find(e => `experiencia:${e.id}` === i.secao)) } : {}) })})`;

export async function editarPerfil(root, args) {
  return alterar(root, s => {
    const a = abaDe(s, args); revalidar(a, args.afirmacoes);
    const i = a.itens.find(i => i.secao === args.secao && i.hash === args.hash);
    if (!i || !['editavel', 'anterior'].includes(i.estado)) throw Error('Item não editável; reler perfil incerto ou conferir hash.');
    if (i.manual) throw Error('Habilidades na Gupy usam busca com autocomplete: altere à mão na página seguindo o diff (atual e proposto).');
    i.script = scriptDoItem(a, i);
    return i.script;
  });
}

export async function aprovarPerfilPorMensagem(root, { mensagem, sessionId, ts = new Date().toISOString() }) {
  const m = /^aprovar perfil ([a-f0-9]{64}) (\[.*\])$/.exec(mensagem);
  if (!m || m[0] !== mensagem) return [];
  let lista;
  try { lista = JSON.parse(m[2]); } catch { return []; }
  if (!Array.isArray(lista) || !lista.length || lista.length > 100) return [];
  try { for (const i of lista) { somente(i, ['secao', 'hash']); if (typeof i.secao !== 'string' || !/^[a-f0-9]{64}$/.test(i.hash)) return []; } } catch { return []; }
  if (new Set(lista.map(i => i.secao)).size !== lista.length) return [];
  return alterar(root, s => {
    const candidatas = s.abas.filter(a => a.session_id === sessionId && a.proposta_hash === m[1]);
    if (candidatas.length !== 1) return [];
    const a = candidatas[0], agora = instante(ts);
    if (!(agora >= instante(a.criada_em) && agora < instante(a.criada_em) + 3600000)) return [];
    const itens = lista.map(l => a.itens.find(i => i.secao === l.secao && i.hash === l.hash));
    if (itens.some(i => !i || !['editavel', 'anterior'].includes(i.estado) || i.token && !i.token.usada_em)) return [];
    for (const i of itens) i.token = { id: randomUUID(), session_id: a.session_id, tab_id: a.tab_id, perfil_id: a.perfil.perfil_id, proposta_hash: a.proposta_hash, secao: i.secao, hash: i.hash, expira_em: new Date(agora + 7200000).toISOString(), usada_em: null };
    return lista;
  });
}

// Chamado somente após a decisão completa do batch, antes da ferramenta; falha após consumo fica incerta.
export async function autorizarPerfil(root, args) {
  return alterar(root, s => {
    try {
      if (!args.sessionId) return negar('Sessão real ausente.');
      const a = abaDe(s, args); revalidar(a, args.afirmacoes);
      const i = a.itens.find(i => i.script === args.script && i.script === scriptDoItem(a, i));
      if (!i || !['editavel', 'anterior'].includes(i.estado)) return negar('Item sem aprovação disponível.');
      // Outro item da aba ainda incerto: o documento pode ter texto não confirmado; o próximo "Salvar" o persistiria.
      if (a.itens.some(x => x !== i && ['incerta', 'humano'].includes(x.estado))) return negar('Outro item desta aba está incerto: recarregue, releia e confirme antes do próximo.');
      const t = i.token;
      if (!t || t.usada_em || !(instante(t.expira_em) > instante(args.ts)) || t.session_id !== args.sessionId || t.tab_id !== String(args.tabId) || t.perfil_id !== a.perfil.perfil_id || t.proposta_hash !== a.proposta_hash || t.secao !== i.secao || t.hash !== i.hash) return negar('Token de perfil ausente, vencido ou vínculo alterado.');
      t.usada_em = args.ts;
      i.consumida_seq = avancar(s);
      i.documento_antes = a.observacao.leitura_id;
      i.estado = 'incerta';
      return { decisao: 'permitir', motivo: 'Item de perfil aprovado; token consumido antes da ação.' };
    } catch { return negar('Perfil/proposta/afirmações inválidos; negado por padrão.'); }
  });
}

export async function confirmarPerfil(root, args) {
  return alterar(root, async s => {
    const a = abaDe(s, args), p = normalizarPerfil(args.extracao), i = a.itens.find(i => i.secao === args.secao);
    if (!i?.token?.usada_em) throw Error('Item sem token consumido.');
    if (p.perfil_id !== a.perfil.perfil_id || p.origem !== a.perfil.origem || !p.recarregada || p.leitura_id === i.documento_antes) throw Error('Reler após reload na mesma conta é obrigatório por item.');
    const perfilHash = hashPerfil(p);
    if (i.estado === 'confirmada' && i.confirmacao_hash === perfilHash) return { estado: i.estado, secao: i.secao, antes_hash: i.antes_hash, depois_hash: i.hash };
    const obs = a.observacao;
    if (!obs || obs.usada || obs.session_id !== a.session_id || obs.tab_id !== a.tab_id || obs.perfil_hash !== perfilHash || !(obs.iniciada_seq > i.consumida_seq)) throw Error('Persistência exige nova extração observada no PostToolUse depois do consumo.');
    const h = hashPerfil(valor(p, i.secao));
    if (h === i.hash) {
      const id = hashPerfil([a.session_id, a.tab_id, a.perfil.perfil_id, a.proposta_hash, i.secao, i.antes_hash, i.hash]);
      await appendEvent(root, { id: `perfil.atualizado:${id}`, ts: args.ts ?? new Date().toISOString(), ator: 'gupy-perfil', tipo: 'perfil.atualizado', entidade: 'perfil', entidade_id: hashPerfil([s.sal ??= randomUUID(), a.perfil.perfil_id]), dados: { antes_hash: i.antes_hash, depois_hash: i.hash, proposta_hash: a.proposta_hash, secao: i.secao } });
      i.estado = 'confirmada';
      i.confirmacao_hash = perfilHash;
    } else {
      if (i.estado === 'confirmada') throw Error('Perfil mudou após confirmação; ação humana necessária.');
      i.estado = h === i.antes_hash ? 'anterior' : 'humano';
    }
    obs.usada = true;
    return { estado: i.estado, secao: i.secao, antes_hash: i.antes_hash, depois_hash: h };
  });
}
