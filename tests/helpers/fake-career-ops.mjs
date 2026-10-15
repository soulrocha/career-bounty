// Executável falso do career-ops: imprime a saída gravada (dados sintéticos).
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = nome => { const i = args.indexOf(nome); return i === -1 ? null : args[i + 1]; };
if (flag('--env-out')) writeFileSync(flag('--env-out'), JSON.stringify(process.env));
if (args.includes('--version')) { console.log(`career-ops ${flag('--versao') ?? 'v1.36.0'}`); process.exit(0); }
if (args.includes('--falhar')) { console.error('erro simulado do scan'); process.exit(3); }
if (args.includes('--lixo')) { console.log('isto não é JSON'); process.exit(0); }
console.log(readFileSync(new URL('../replay/careerops/scan.json', import.meta.url), 'utf8'));
