// Script de preenchimento numa chamada só: escreve os valores nos campos marcados pelo extrator (data-cb-ref) e dispara
// input/change para formulários em React. Nunca clica em enviar. Arquivos são anexados à parte (CDP setFileInputFiles).
// sensiveis: false tira as respostas sensíveis do script (fluxo assistido, em que o script passa pelo contexto do modelo);
// elas voltam como "preencha você" para a pessoa digitar na aba.
export function scriptDePreenchimento(preenchimentos, { sensiveis = false } = {}) {
  const itens = preenchimentos.filter(p => p.tipo !== 'file' && (sensiveis || !p.sensivel)).map(p => ({ r: p.ref, t: p.tipo, v: p.valor }));
  const corpo = `const I=${JSON.stringify(itens)},N=s=>(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(),`
    + `S=(e,v)=>{const p=Object.getPrototypeOf(e),d=Object.getOwnPropertyDescriptor(p,'value');d&&d.set?d.set.call(e,v):e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))},`
    + `L=e=>{const l=e.closest('label')||(e.id&&document.querySelector('label[for="'+CSS.escape(e.id)+'"]'));return N(l?l.innerText:e.value)},ok=[],falhou=[];`
    + `for(const i of I){const es=[...document.querySelectorAll('[data-cb-ref="'+i.r+'"]')];if(!es.length){falhou.push(i.r);continue}`
    + `if(i.t==='select'){const e=es[0],o=[...e.options].find(o=>N(o.text)===N(i.v));if(!o){falhou.push(i.r);continue}S(e,o.value)}`
    + `else if(i.t==='radio'||i.t==='checkbox_grupo'){const vs=[].concat(i.v).map(N),m=es.filter(e=>vs.includes(L(e)));if(m.length!==vs.length){falhou.push(i.r);continue}`
    + `for(const e of es){const q=m.includes(e);if(e.checked!==q)e.click()}}`
    + `else if(i.t==='checkbox'){const e=es[0];if(e.checked!==i.v)e.click()}else S(es[0],i.v);ok.push(i.r)}return{preenchidos:ok,falharam:falhou}`;
  return `(()=>{${corpo}})()`;
}

// Campos que a pessoa precisa digitar na aba: obrigatórios sem resposta e, no fluxo assistido, as respostas sensíveis.
export const preenchaVoce = (casamento, { sensiveis = false } = {}) => [
  ...(sensiveis ? [] : casamento.preenchimentos.filter(p => p.sensivel).map(p => ({ ref: p.ref, motivo: 'resposta sensível: digite você na aba' }))),
];
