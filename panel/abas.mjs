// Barra de abas do painel, injetada no servidor (vale para o template público, o privado e a página do modo sombra).
// Cada aba traz o seu painel (section com data-aba-painel) e registra em window.CB_ABAS[id] a função chamada ao abrir.
const NAV = abas => `<nav id="abas-painel" aria-label="Abas do painel"><button type="button" role="tab" id="aba-vagas" aria-selected="true" aria-controls="painel-vagas">Vagas</button>${
  abas.map(a => `<button type="button" role="tab" id="aba-${a.id}" aria-selected="false" aria-controls="${a.id}-painel">${a.titulo}</button>`).join('')}</nav>`;

const SCRIPT = `<script id="abas-painel-script">(function(){
var nav=document.getElementById('abas-painel'),botoes=Array.prototype.slice.call(nav.querySelectorAll('button[role=tab]'));
function paineis(){return Array.prototype.slice.call(document.querySelectorAll('[data-aba-painel]'))}
function outros(){return Array.prototype.filter.call(document.body.children,function(n){return n!==nav&&!n.hasAttribute('data-aba-painel')&&n.tagName!=='SCRIPT'&&n.tagName!=='STYLE'})}
function mostrar(id){var vagas=id==='vagas';outros().forEach(function(n){n.hidden=!vagas});
 paineis().forEach(function(p){p.hidden=p.getAttribute('data-aba-painel')!==id});
 botoes.forEach(function(b){b.setAttribute('aria-selected',String(b.id==='aba-'+id))});
 var abrir=(window.CB_ABAS||{})[id];if(!vagas&&abrir)abrir()}
botoes.forEach(function(b){b.addEventListener('click',function(){mostrar(b.id.slice(4))})});
})();</script>`;

// Insere a barra logo depois de <body> e os painéis antes de </body>.
export function injetarAbas(html, abas) {
  const topo = `${[...new Set(abas.map(a => a.estilo).filter(Boolean))].join('')}${NAV(abas)}`;
  const comNav = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, corpo => `${corpo}${topo}`) : `${topo}${html}`;
  const bloco = `${abas.map(a => a.html).join('')}${SCRIPT}`;
  return /<\/body>/i.test(comNav) ? comNav.replace(/<\/body>/i, () => `${bloco}</body>`) : `${comNav}${bloco}`;
}
