// Drivers dos formulários públicos (F7.6 a F7.8): mesmo contrato do driver base; cada portal só define como reconhecer
// a página de sucesso e a de erro. Perguntas extras (EEO, legal, patrocínio) sem resposta no answer bank viram "blocked"
// com os campos, para virar pergunta à pessoa: o driver nunca chuta.
import { executarDriver } from './base.mjs';

export const PORTAIS = {
  greenhouse: {
    nome: 'greenhouse',
    origens: ['https://boards.greenhouse.io', 'https://job-boards.greenhouse.io', 'https://boards.eu.greenhouse.io', 'https://job-boards.eu.greenhouse.io'],
    sucesso: /(thank you for applying|application (has been |was )?(submitted|received)|we('ve| have) received your application)/i,
    erro: /(there was an error|please (complete|fix|correct)[^.]*(field|error)|this field is required)/i,
  },
  lever: {
    nome: 'lever',
    origens: ['https://jobs.lever.co', 'https://jobs.eu.lever.co'],
    sucesso: /(application submitted|thanks for applying|thank you for applying|your application has been (submitted|received))/i,
    erro: /(something went wrong|please (fix|correct) the errors|required field)/i,
  },
  ashby: {
    nome: 'ashby',
    origens: ['https://jobs.ashbyhq.com'],
    sucesso: /(application (was |has been )?(submitted|received)|thank you for (applying|your application|your interest))/i,
    erro: /(failed to submit|there (was|were) (an )?errors?|is required)/i,
  },
};

// `args.portal` só complementa o portal (os testes apontam `origens` para um servidor local); o orquestrador nunca o passa.
const com = (base, args) => executarDriver({ ...args, portal: { ...base, ...args.portal } });
export const enviarGreenhouse = args => com(PORTAIS.greenhouse, args);
export const enviarLever = args => com(PORTAIS.lever, args);
export const enviarAshby = args => com(PORTAIS.ashby, args);
