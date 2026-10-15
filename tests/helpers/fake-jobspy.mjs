// Executável falso do JobSpy: imprime resultados sintéticos no formato de registros do JobSpy.
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = nome => { const i = args.indexOf(nome); return i === -1 ? null : args[i + 1]; };
if (flag('--env-out')) writeFileSync(flag('--env-out'), JSON.stringify(process.env));
if (args.includes('--demora')) await new Promise(resolve => setTimeout(resolve, 60000));
if (args.includes('--lixo')) { console.log('nao e json'); process.exit(0); }
if (args.includes('--falhar')) { console.error('falha simulada'); process.exit(4); }
const termo = flag('--termo') ?? 'x';
console.log(JSON.stringify([
  { site: 'indeed', title: `Gerente de ${termo}`, company: 'Empresa Beta', job_url: 'https://jobs.exemplo.test/empresa-beta/101', location: 'Belo Horizonte, MG, BR',
    date_posted: '2026-10-13', description: 'Texto sintético da vaga.', min_amount: 12000, max_amount: 15000, job_type: 'fulltime', is_remote: false },
  { site: 'indeed', title: `Líder de ${termo}`, company: 'Empresa Gama', job_url: 'https://jobs.exemplo.test/empresa-gama/202', location: 'Brasil',
    date_posted: null, description: null, is_remote: true },
  { site: 'indeed', title: '', company: 'Empresa Delta', job_url: 'https://jobs.exemplo.test/empresa-delta/303' },
]));
