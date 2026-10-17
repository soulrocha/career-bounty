// Subcomandos de candidatura (F6.7 a F6.11), usados pela skill aplicar e pelo comando /aplicar.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadSettings } from '../config.mjs';
import { runnerDasOpcoes } from './llm.mjs';
import { planejarAplicacao } from '../apply/plan.mjs';
import { proporLote } from '../apply/approval.mjs';
import { SCRIPT_EXTRATOR } from '../apply/extrator.mjs';
import { scriptDeClique, scriptDeEnvio } from '../apply/sessao.mjs';
import { encerrarCandidatura, iniciarCandidatura, prepararPreenchimento, registrarPreparacao, registrarResumoPreparacao } from '../apply/session.mjs';
import { lerRespostas } from '../apply/answers.mjs';
import { rascunharRespostas } from '../apply/rascunho.mjs';
import { projetarTentativas, chaveTentativa } from '../apply/attempts.mjs';
import { SCRIPT_COMPROVANTE } from '../apply/receipt.mjs';
import { SCRIPT_ETAPA_GUPY, exigirAceiteGupy } from '../apply/gupyFlow.mjs';
import { lerSessao } from '../apply/sessao.mjs';
import { lerBase } from '../kb/base.mjs';
import { carregarFontes } from '../kb/fontes.mjs';
import { loadIdentityValues } from '../privacy/redact.mjs';
import { readEvents } from '../store/events.mjs';
import { projectEvents } from '../store/project.mjs';
import { localDay } from '../store/schema.mjs';
import { registrarTokensNavegador } from '../apply/tokens.mjs';

const NL = String.fromCharCode(10);
const USO = 'Uso: apply plan | lote --vagas a,b | iniciar --vaga <id> --aba <tabId> | preparar --vaga <id> --extracao <arquivo.json> [--live|--replay <pasta>] | clique --texto "<botão>" | envio --vaga <id> | desfecho --vaga <id> --aba <tabId> --estado <estado> [--comprovante <arquivo.json>]';

async function vagaDaProjecao(dataRoot, id) {
  const vaga = (projectEvents((await readEvents(dataRoot)).eventos).vagas ?? []).find(v => v.id === id);
  if (!vaga) throw new Error(`Vaga não encontrada na projeção: ${id}`);
  return vaga;
}

async function lerJson(caminho) {
  try { return JSON.parse(await readFile(path.resolve(caminho), 'utf8')); } catch (e) { throw new Error(`Não foi possível ler ${caminho}: ${e.message}`); }
}

export const aplicarCommands = {
  async apply(rest, { parseFlags }) {
    const [sub, ...flags] = rest;
    if (sub === 'plan') {
      const values = parseFlags(flags, { allowed: ['--aderencia'], withValue: ['--aderencia'] });
      const aderencias = values['--aderencia'] ? values['--aderencia'].split(',').map(a => a.trim()) : undefined;
      if (aderencias?.some(a => !['alta', 'media'].includes(a))) throw new Error('--aderencia aceita alta, media ou alta,media.');
      const settings = await loadSettings();
      const plano = await planejarAplicacao({ dataRoot: settings.dataRoot, settings, aderencias });
      const linhas = [`ação padrão: ${plano.acao}; ${plano.fila.length} vaga(s) na fila, ${plano.excluidas.length} fora`,
        ...plano.fila.map(f => `  [${f.rota}] ${f.vaga_id}: ${f.empresa} — ${f.cargo} (${f.aderencia})`)];
      return { result: plano, text: linhas.join(NL) };
    }
    const settings = await loadSettings();
    const dataRoot = settings.dataRoot;
    if (sub === 'tokens') {
      const values = parseFlags(flags, { allowed: ['--vaga', '--tentativa', '--uso'], withValue: ['--vaga', '--tentativa', '--uso'] });
      if (!values['--vaga'] || !values['--tentativa'] || !values['--uso']) throw new Error('Uso: apply tokens --vaga <id> --tentativa <id> --uso <arquivo.json>');
      return { result: await registrarTokensNavegador(dataRoot, { vagaId: values['--vaga'], tentativaId: values['--tentativa'], uso: await lerJson(values['--uso']) }) };
    }
    if (sub === 'lote') {
      const values = parseFlags(flags, { allowed: ['--vagas'], withValue: ['--vagas'] });
      const ids = String(values['--vagas'] ?? '').split(',').map(s => s.trim()).filter(Boolean);
      if (!ids.length) throw new Error(USO);
      if (new Set(ids).size !== ids.length) throw new Error('Lote contém vaga duplicada.');
      const { fila } = await planejarAplicacao({ dataRoot, settings, paraLote: true });
      const fora = ids.filter(id => !fila.some(f => f.vaga_id === id));
      if (fora.length) throw new Error(`Fora da fila elegível (veja apply plan): ${fora.join(', ')}`);
      const { rotaDe } = await import('../apply/route.mjs');
      const vagas = await Promise.all(ids.map(async id => { const v = await vagaDaProjecao(dataRoot, id); return { vaga_id: id, chave: chaveTentativa(v), empresa: v.empresa, cargo: v.cargo, rota: rotaDe(v).rota }; }));
      if (vagas.some(v => v.rota === 'gupy')) exigirAceiteGupy(settings);
      if (new Set(vagas.map(v => v.chave)).size !== vagas.length) throw new Error('Lote contém duas aparições da mesma requisição.');
      const lote = await proporLote(dataRoot, { vagas });
      return { result: lote, text: `Para aprovar o envio, a pessoa digita no chat exatamente:${NL}${lote.frase}${NL}(o lote vence em 1 hora; cada aprovação vale 2 horas e uma vez)` };
    }
    if (sub === 'iniciar') {
      const values = parseFlags(flags, { allowed: ['--vaga', '--aba'], withValue: ['--vaga', '--aba'] });
      if (!values['--vaga'] || !values['--aba']) throw new Error(USO);
      const vaga = await vagaDaProjecao(dataRoot, values['--vaga']);
      const r = await iniciarCandidatura(dataRoot, { vaga, tabId: values['--aba'] });
      return { result: { ...r, extrator: SCRIPT_EXTRATOR, cv_ats: r.cv ? path.join(dataRoot, r.cv.ats) : null } };
    }
    if (sub === 'preparar') {
      const values = parseFlags(flags, { allowed: ['--vaga', '--extracao', '--live', '--replay', '--gravar'], withValue: ['--vaga', '--extracao', '--replay'] });
      if (!values['--vaga'] || !values['--extracao']) throw new Error(USO);
      const vaga = await vagaDaProjecao(dataRoot, values['--vaga']);
      // Gupy: só a etapa de perguntas da vaga recebe preenchimento; o resto para (pós-inscrição nunca é iniciada).
      if ((await import('../apply/route.mjs')).rotaDe(vaga).rota === 'gupy') {
        exigirAceiteGupy(settings);
        // A etapa vale só se foi observada pelo hook (script de etapa rodado na aba, chamada individual), nunca por arquivo.
        const aba = (await lerSessao(dataRoot)).abas.find(a => a.vaga_id === vaga.id && Date.parse(a.expira_em) > Date.now());
        if (!aba?.etapa) throw new Error('Na Gupy, rode o script de "apply etapa-gupy" na aba desta vaga (chamada individual de javascript_tool) antes de preparar.');
        if (aba.etapa.etapa !== 'perguntas') return { result: { bloqueada: true, etapa: aba.etapa.etapa, motivo: aba.etapa.motivo }, text: `parada: ${aba.etapa.motivo}` };
      }
      const runner = values['--live'] || values['--replay'] ? await runnerDasOpcoes(values, settings) : null;
      const tentativa = projetarTentativas((await readEvents(dataRoot)).eventos).get(chaveTentativa(vaga));
      if (tentativa?.estado !== 'em_andamento' || tentativa.vaga_id !== vaga.id) throw new Error('Rode apply iniciar para esta vaga antes de preparar.');
      const { portal } = (await import('../apply/route.mjs')).rotaDe(vaga);
      const meta = { vaga_id: vaga.id, tentativa_id: tentativa.tentativa_id, origem: 'runner' };
      const ts = new Date().toISOString();
      const preparo = await prepararPreenchimento({ extracao: await lerJson(values['--extracao']), respostas: await lerRespostas(dataRoot), vaga, portal, hoje: localDay(new Date()), runner, identity: await loadIdentityValues(), meta,
        aoPreparar: resumo => registrarResumoPreparacao(dataRoot, { vaga, tentativa_id: tentativa.tentativa_id, resumo, ts }) });
      let sugestoes = {};
      if (runner && preparo.rascunhos?.length) sugestoes = await rascunharRespostas({ runner, campos: preparo.rascunhos, vaga, afirmacoes: (await lerBase((await carregarFontes({ dataRoot, settings })).fontes)).claims, meta });
      const { perguntas } = await registrarPreparacao(dataRoot, { vaga, preparo, portal, tentativa_id: tentativa.tentativa_id, rascunhosSugeridos: sugestoes, ts });
      const atual = tentativa.cv;
      const resultado = { ...preparo, perguntas_criadas: perguntas, cv_ats: preparo.anexar_cv && atual ? path.join(dataRoot, atual.ats) : null };
      const texto = preparo.bloqueada ? `bloqueada: ${preparo.motivo}`
        : `${preparo.pronta ? 'pronta para revisar e enviar' : `${perguntas} pergunta(s) criada(s) na aba Perguntas`}; ${preparo.preencha_voce.length} campo(s) sensível(is) para a pessoa digitar`;
      return { result: resultado, text: texto };
    }
    if (sub === 'clique') {
      const values = parseFlags(flags, { allowed: ['--texto'], withValue: ['--texto'] });
      if (!values['--texto']) throw new Error(USO);
      return { result: { script: scriptDeClique(values['--texto']) }, text: scriptDeClique(values['--texto']) };
    }
    if (sub === 'etapa-gupy') {
      parseFlags(flags, { allowed: [] });
      return { result: { script: SCRIPT_ETAPA_GUPY }, text: SCRIPT_ETAPA_GUPY };
    }
    if (sub === 'comprovante') {
      parseFlags(flags, { allowed: [] });
      return { result: { script: SCRIPT_COMPROVANTE }, text: SCRIPT_COMPROVANTE };
    }
    if (sub === 'envio') {
      const values = parseFlags(flags, { allowed: ['--vaga'], withValue: ['--vaga'] });
      if (!values['--vaga']) throw new Error(USO);
      const vagaEnvio = await vagaDaProjecao(dataRoot, values['--vaga']);
      const script = scriptDeEnvio(vagaEnvio.id, (await import('../apply/route.mjs')).rotaDe(vagaEnvio).rota);
      return { result: { script }, text: script };
    }
    if (sub === 'desfecho') {
      const values = parseFlags(flags, { allowed: ['--vaga', '--aba', '--estado', '--comprovante', '--motivo'], withValue: ['--vaga', '--aba', '--estado', '--comprovante', '--motivo'] });
      if (!values['--vaga'] || !values['--aba'] || !values['--estado']) throw new Error(USO);
      const vaga = await vagaDaProjecao(dataRoot, values['--vaga']);
      const tentativa = projetarTentativas((await readEvents(dataRoot)).eventos).get(chaveTentativa(vaga));
      if (!tentativa || tentativa.estado !== 'em_andamento') throw new Error('Nenhuma tentativa em andamento para esta vaga.');
      const bruto = values['--comprovante'] ? await lerJson(values['--comprovante']) : null;
      const { estado, comprovante } = await encerrarCandidatura(dataRoot, { tentativa: { tentativa_id: tentativa.tentativa_id, chave: tentativa.chave }, vaga, tabId: values['--aba'], estado: values['--estado'], bruto, motivo: values['--motivo'] ?? null });
      return { result: { estado, comprovante }, text: `desfecho: ${estado}${estado === 'enviada_sem_comprovante' ? ' (confira e marque no painel)' : ''}` };
    }
    throw new Error(USO);
  },
};
