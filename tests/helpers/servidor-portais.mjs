// Servidor local com formulários públicos sintéticos (Greenhouse, Lever, Ashby) para os testes dos drivers da F7.
// Registra cada envio recebido (portal, se veio o PDF) para provar que houve (ou não) envio. Empresas fictícias.
import { createServer } from 'node:http';

const pagina = (titulo, corpo) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${titulo}</title></head><body>${corpo}</body></html>`;
const campo = (id, label, extra = '') => `<div><label for="${id}">${label}</label><input id="${id}" name="${id}" ${extra}></div>`;

const FORMS = {
  greenhouse: ({ extra = '', botao = '<button type="submit">Submit Application</button>' } = {}) => pagina('Job Application for Product Manager at Empresa 01', `
    <h1>Product Manager</h1><form method="post" action="/enviar/greenhouse" enctype="multipart/form-data">
    ${campo('first_name', 'First Name *', 'required')}${campo('last_name', 'Last Name *', 'required')}${campo('email', 'Email *', 'type="email" required')}
    <div><label for="resume">Resume/CV *</label><input id="resume" name="resume" type="file" required></div>
    ${campo('linkedin', 'LinkedIn Profile')}
    <div><label for="auth">Are you legally authorized to work in Brazil? *</label><select id="auth" name="auth" required><option value="">--</option><option value="1">Yes</option><option value="0">No</option></select></div>
    ${extra}${botao}</form>`),
  lever: () => pagina('Empresa 02 - Engineering Manager', `
    <form method="post" action="/enviar/lever" enctype="multipart/form-data"><ul>
    <li><div>Resume/CV ✱</div><input type="file" name="resume" required></li>
    <li><div>Full name ✱</div><input type="text" name="name" required></li>
    <li><div>Email ✱</div><input type="email" name="email" required></li>
    <li><div>LinkedIn URL</div><input type="text" name="urls[LinkedIn]"></li>
    <li><div>Additional information</div><textarea name="comments"></textarea></li></ul>
    <button type="submit">Submit application</button></form>`),
  ashby: () => pagina('Application - Empresa 03', `
    <form method="post" action="/enviar/ashby" enctype="multipart/form-data">
    <label id="l-name">Name</label><input aria-labelledby="l-name" aria-required="true" name="name">
    <label id="l-email">Email</label><input type="email" aria-labelledby="l-email" aria-required="true" name="email">
    <label id="l-resume">Resume</label><input type="file" aria-labelledby="l-resume" name="resume" aria-required="true">
    <button type="submit">Submit Application</button></form>`),
};

const ROTAS = {
  '/greenhouse': () => FORMS.greenhouse(),
  '/greenhouse-eeo': () => FORMS.greenhouse({ extra: '<fieldset><legend>Are you a protected veteran? *</legend><label><input type="radio" name="vet" value="1" required> Yes</label><label><input type="radio" name="vet" value="0"> No</label></fieldset>' }),
  '/greenhouse-novo': () => FORMS.greenhouse({ extra: campo('referral', 'Who referred you? *', 'required') }),
  '/greenhouse-sem-botao': () => FORMS.greenhouse({ botao: '' }),
  '/greenhouse-erro': () => FORMS.greenhouse().replace('/enviar/greenhouse', '/enviar/greenhouse?erro=1'),
  '/lever': () => FORMS.lever(),
  '/ashby': () => FORMS.ashby(),
  '/greenhouse-sucesso-falso': () => FORMS.greenhouse({ extra: '<p>Thank you for applying to other roles at Empresa 01!</p>' }),
  '/greenhouse-sucesso-falso': () => FORMS.greenhouse({ extra: '<p>Thank you for applying to other roles at Empresa 01!</p>' }),
  '/captcha': () => FORMS.greenhouse({ extra: '<div class="g-recaptcha" data-sitekey="chave-ficticia"></div>' }),
  '/login': () => pagina('Sign in', '<h1>Log in to apply</h1><form><label for="u">Email</label><input id="u" type="email"><label for="p">Password</label><input id="p" type="password"><button>Sign in</button></form>'),
};

const SUCESSO = { greenhouse: 'Thank you for applying to Empresa 01!', lever: 'Application submitted. Thanks for applying!', ashby: 'Your application was submitted.' };

export async function servidorPortais(t) {
  const recebidos = [];
  const servidor = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname.startsWith('/enviar/')) {
      const partes = [];
      for await (const parte of req) partes.push(parte);
      const corpo = Buffer.concat(partes).toString('latin1');
      const portal = url.pathname.split('/')[2];
      recebidos.push({ portal, pdf: /filename="cv-ats\.pdf"/.test(corpo), sensivel: /R\$ 10\.000/.test(corpo) });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(url.searchParams.get('erro') ? pagina('Error', '<p class="error">There was an error submitting your application.</p>') : pagina('Obrigado', `<h1>${SUCESSO[portal]}</h1>`));
    }
    if (url.pathname === '/redirecionar') { res.writeHead(302, { Location: url.searchParams.get('para') }); return res.end(); }
    if (url.pathname === '/redirecionar') { res.writeHead(302, { Location: url.searchParams.get('para') }); return res.end(); }
    const rota = ROTAS[url.pathname];
    res.writeHead(rota ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(rota ? rota() : 'não encontrado');
  });
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => servidor.close(resolve)));
  const origin = `http://127.0.0.1:${servidor.address().port}`;
  return { origin, url: caminho => `http://127.0.0.1:${servidor.address().port}${caminho}`, recebidos };
}
