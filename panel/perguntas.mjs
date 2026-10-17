// Aba Perguntas (F6.6): lista o que só a pessoa responde e grava a resposta no answer bank, no escopo escolhido.
import { readEvents } from '../core/store/events.mjs';
import { projetarPerguntas } from '../core/apply/perguntas.mjs';

export async function listarPerguntas({ dataRoot }) {
  const { pendentes } = projetarPerguntas((await readEvents(dataRoot)).eventos);
  return { perguntas: pendentes.map(p => ({ id: p.id, label: p.label, tipo: p.tipo, opcoes: p.opcoes, categoria: p.categoria, vagas: p.vagas })) };
}

const ESTILO = `<style>
#perguntas-painel{max-width:1176px;margin:auto;padding:28px;color:var(--ink,#14253b)}
#perguntas-painel .p-item{background:#fff;border:1px solid var(--line,#dce3e9);border-radius:5px;margin:0 0 12px;padding:16px 18px}
#perguntas-painel .p-label{font-size:15px;font-weight:600;margin:0 0 6px}
#perguntas-painel .p-meta{color:var(--muted,#5d6c7e);font-size:12px;margin:0 0 10px}
#perguntas-painel .p-linha{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
#perguntas-painel input[type=text],#perguntas-painel textarea,#perguntas-painel select{font:inherit;padding:7px 9px;border:1px solid var(--line,#c9d3dd);border-radius:4px;min-width:260px}
#perguntas-painel textarea{min-height:70px;width:100%}
#perguntas-painel .p-estado{background:#fff;border:1px solid var(--line,#dce3e9);border-radius:5px;padding:24px;text-align:center;font-size:14px}
#perguntas-painel .p-erro{color:#b42318;font-size:13px}
</style>`;

const PAINEL = '<section id="perguntas-painel" role="tabpanel" aria-labelledby="aba-perguntas" data-aba-painel="perguntas" hidden><div id="perguntas-conteudo" aria-live="polite"></div></section>';

const SCRIPT = `<script id="perguntas-painel-script">(function(){
var conteudo=document.getElementById('perguntas-conteudo');
function el(tag,texto,cls){var n=document.createElement(tag);if(texto!==undefined)n.textContent=texto;if(cls)n.className=cls;return n}
function token(){return (window.PAINEL_API||{}).token||''}
function estado(texto){conteudo.textContent='';conteudo.appendChild(el('div',texto,'p-estado'))}
function campo(p){
 if(p.tipo==='select'||p.tipo==='radio'){var s=el('select');s.appendChild(el('option','Escolha...'));s.options[0].value='';(p.opcoes||[]).forEach(function(o){var x=el('option',o);x.value=o;s.appendChild(x)});return {no:s,valor:function(){return s.value}}}
 if(p.tipo==='checkbox_grupo'){var d=el('div');(p.opcoes||[]).forEach(function(o){var l=el('label');var c=el('input');c.type='checkbox';c.value=o;l.appendChild(c);l.appendChild(document.createTextNode(' '+o+' '));d.appendChild(l)});return {no:d,valor:function(){return Array.prototype.filter.call(d.querySelectorAll('input'),function(c){return c.checked}).map(function(c){return c.value})}}}
 if(p.tipo==='checkbox'){var s2=el('select');[['','Escolha...'],['sim','Sim'],['nao','Não']].forEach(function(o){var x=el('option',o[1]);x.value=o[0];s2.appendChild(x)});return {no:s2,valor:function(){return s2.value===''?'':s2.value==='sim'}}}
 var t=el(p.tipo==='textarea'?'textarea':'input');if(t.tagName==='INPUT')t.type='text';return {no:t,valor:function(){return t.value}}}
function escopos(p){var s=el('select');var o=el('option','Para todas as vagas');o.value='global';s.appendChild(o);
 var vistos={};p.vagas.forEach(function(v){[['empresa',v.empresa,'Só para '],['portal',v.portal,'Só no portal ']].forEach(function(e){if(e[1]&&!vistos[e[0]+e[1]]){vistos[e[0]+e[1]]=1;var x=el('option',e[2]+e[1]);x.value=e[0]+'|'+e[1];s.appendChild(x)}})});return s}
function item(p){
 var box=el('div',undefined,'p-item');box.appendChild(el('p',p.label,'p-label'));
 box.appendChild(el('p',(p.categoria==='sensivel'?'Dado sensível: fica só no seu computador e nunca vai ao modelo. ':'')+'Esperando: '+p.vagas.map(function(v){return (v.empresa||'?')+' ('+(v.cargo||'')+')'}).join('; '),'p-meta'));
 var c=campo(p),esc=escopos(p),b=el('button','Salvar resposta'),erro=el('p','','p-erro'),linha=el('div',undefined,'p-linha');b.type='button';
 linha.appendChild(c.no);linha.appendChild(esc);linha.appendChild(b);box.appendChild(linha);box.appendChild(erro);
 b.addEventListener('click',function(){var v=c.valor();if(v===''||(Array.isArray(v)&&!v.length)){erro.textContent='Preencha a resposta.';return}
  var e=esc.value.split('|'),escopo=e[0]==='global'?{tipo:'global'}:{tipo:e[0],valor:e[1]};b.disabled=true;erro.textContent='';
  fetch('/api/perguntas',{method:'POST',headers:{'Content-Type':'application/json','X-Painel-Token':token()},body:JSON.stringify({id:p.id,resposta:v,escopo:escopo})}).then(function(r){return r.json().then(function(d){
   if(!r.ok){b.disabled=false;erro.textContent=d.erro||'Não foi possível salvar.';return}carregar()})}).catch(function(){b.disabled=false;erro.textContent='Painel local fora do ar.'})});
 return box}
function carregar(){estado('Carregando perguntas...');
 fetch('/api/perguntas',{headers:{'X-Painel-Token':token()},cache:'no-store'}).then(function(r){return r.json().then(function(d){
  if(!r.ok){estado(d.erro||'Não foi possível carregar as perguntas.');return}
  if(!d.perguntas.length){estado('Nenhuma pergunta pendente.');return}
  conteudo.textContent='';d.perguntas.forEach(function(p){conteudo.appendChild(item(p))})})}).catch(function(){estado('Painel local fora do ar.')})}
window.CB_ABAS=window.CB_ABAS||{};window.CB_ABAS.perguntas=carregar;
})();</script>`;

export const ABA_PERGUNTAS = { id: 'perguntas', titulo: 'Perguntas', estilo: ESTILO, html: `${PAINEL}${SCRIPT}` };
