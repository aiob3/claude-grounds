import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Escolha, ExecucaoFeita, Mutante } from '../types'
import { progresso, ACHAR_NO_VENV, AMBIENTE_DE_TESTE, chaveDoRecorte, larguraDoParalelo, refazerSozinho, pycachesDe, realocar, SOBRESCREVER, aplicarTrecho, comandosPara, contarTestes, planoIncremental, somarTestes, linhasDoDiff, resumoCusto, tamanhoDoRepo, categoriasDescobertas, conferirEstado, erroDeCarga, estadoSeEquivalentes, invalido, conferir, contar, detectarComando, estadoDe, quemMatou, relatorio, resolverArquivo } from './execucao'
import type { AoVivo, Comando, Execucao, FaseAoVivo, Paralelo, Resultado } from './execucao'
import { efetividade, indicadoresDeEfetividade } from './placar'
import { avisoNovos, cortarResposta, LIMITE_ESCOLHA, logDoProjeto, defeitosDoInstrumento, instrumentoDe, CABECALHO_LOG, lacunas, lerArgs, LOG_ENV, logPadrao, lerResposta, linhaLog, montarPrompt, protocoloEm, separar, SISTEMA, tabela, tocaOInstrumento, versaoDe, nomeDe, ehArquivoDeTeste } from './prova'
import type { Registro } from './prova'
import type { Alias } from './alcance'
import { aliasesDe, cabeNoMapa, ehConfigDeAlias, ehEntradaDeTeste, ehMapeavel, grafo, SUFIXO_FORA, testesQueAlcancam } from './alcance'

const avisadoTurno = atom({ plugin: 'prova-de-teste', key: 'avisadoTurno' } as const, -1)
const ultima = atom({ plugin: 'prova-de-teste', key: 'ultima' } as const, null)
const execucao = atom({ plugin: 'prova-de-teste', key: 'execucao' } as const, null)

export const TOOL_MUTANTES = 'mcp__prova-de-teste__mutantes'
export const TOOL_REGISTRAR = 'mcp__prova-de-teste__registrar'
export const TOOL_EXECUTAR = 'mcp__prova-de-teste__executar'

const SPEC_MUTANTES = {
  name: 'mutantes',
  description:
    'R2.1 do EXP-001 (Prova de Teste): escolhe mutantes às cegas. O mod pega o git diff do repositório, tira os arquivos de teste ' +
    'e manda só o código-fonte a um modelo sem ferramentas nem histórico, que devolve arquivo:linha | categoria | mutação. ' +
    'Aplique TODOS os mutantes da lista (pode acrescentar, não pode remover), um por vez, e restaure. ' +
    'Chame depois de escrever código e testes, antes de relatar a prova.',
  isDeferred: false,
  inputSchema: {
    type: 'object',
    properties: {
      base: { type: 'string', description: 'Ref do git contra a qual comparar (padrão HEAD: mudanças ainda sem commit).' },
      cwd: { type: 'string', description: 'Pasta do repositório (padrão: a da sessão).' },
      novos: { type: 'boolean', description: 'Inclui os arquivos fora do git no diff (padrão true). Use false quando o repositório tem código antigo nunca commitado.' },
      modelo: { type: 'string', description: 'Modelo que escolhe (padrão: o da sessão).' },
    },
  },
} as const

const SPEC_REGISTRAR = {
  name: 'registrar',
  description:
    `Grava a linha da tarefa no log do EXP-001 (${LOG_ENV}, ou ~/.claude/prova-de-teste/EXP-001-log.md) no formato v1.2 (com o instrumento e a classe: medição ou calibração) e faz commit se a pasta do log for um repositório git. ` +
    'Correções entram como linha nova; nunca reescreva a anterior.',
  isDeferred: false,
  inputSchema: {
    type: 'object',
    properties: {
      tarefa: { type: 'string' },
      aplicados: { type: 'integer' },
      mortos: { type: 'integer' },
      sobreviventes: { type: 'integer' },
      reais: { type: 'integer', description: 'Sobreviventes reais encontrados (falhas de teste de verdade, não equivalentes).' },
      estado: { type: 'string', enum: ['PROVADO', 'PROVADO-PARCIAL', 'FRACO', 'NÃO VERIFICADO'] },
      tempo: { type: 'number', description: 'Segundos gastos na prova.' },
      equivalentes: {
        type: 'array',
        description:
          'Sobreviventes que você alega equivalentes (n do relatório + motivo de uma linha). Obrigatório para registrar estado melhor que o executado; vai à linha do log. Fora do escopo não é equivalência.',
        items: { type: 'object', properties: { n: { type: 'integer' }, motivo: { type: 'string' } }, required: ['n', 'motivo'] },
      },
      manuais: {
        type: 'array',
        description:
          'Mutantes que você aplicou à mão, fora da lista, e que morreram (categoria, mutacao, mortoPor = o teste que falhou; arquivo e linha). ' +
          'Para a categoria que o escolhedor só descreve em prosa (mover uma linha). Não entram nos números: vão à linha do log e cobrem a categoria descoberta.',
        items: {
          type: 'object',
          properties: {
            arquivo: { type: 'string' },
            linha: { type: 'integer' },
            categoria: { type: 'string', enum: ['borda/vazio', 'empate/ordem', 'null/inválido', 'condição invertida', 'livre'] },
            mutacao: { type: 'string' },
            mortoPor: { type: 'string' },
          },
          required: ['arquivo', 'categoria', 'mutacao', 'mortoPor'],
        },
      },
      defeitoInstrumento: {
        type: 'string',
        description:
          'v1.2: defeito do próprio instrumento visto nesta rodada (morte ou sobrevivente falso, mutante recusado indevidamente, arquivo mal classificado). Presente, a rodada é calibração e não conta para as 10 medições.',
      },
    },
    required: ['tarefa', 'aplicados', 'mortos', 'sobreviventes', 'reais', 'estado', 'tempo'],
  },
} as const

const EDICAO = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

async function git($: EngineInterface, args: string[], cwd: string) {
  return $.process.run(['git', ...args], { cwd })
}

// O formato que separar() lê, seja qual for a configuração do usuário (mnemonicPrefix, noprefix, cor, diff externo).
const FORMATO = ['--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/']

/** Diff do repositório contra `base`, com os arquivos novos ainda fora do git (a menos que `comNovos` seja false). */
async function diffDoRepo($: EngineInterface, base: string, cwd: string, comNovos = true): Promise<{ diff: string; raiz: string; novos: string[]; erro?: string }> {
  const raiz = await git($, ['rev-parse', '--show-toplevel'], cwd)
  if (raiz.exitCode !== 0) return { diff: '', raiz: '', novos: [], erro: `${cwd} não é um repositório git. Use /prova <pasta do repositório> [base].` }
  const top = raiz.stdout.trim()
  const rastreados = await git($, ['diff', ...FORMATO, base], top)
  if (rastreados.exitCode !== 0) return { diff: '', raiz: top, novos: [], erro: `git diff ${base} falhou: ${rastreados.stderr.trim()}` }
  let diff = rastreados.stdout
  const novos = comNovos ? (await git($, ['ls-files', '--others', '--exclude-standard'], top)).stdout.split('\n').filter(Boolean) : []
  for (const f of novos) {
    // --no-index sai com 1 quando há diferença; é o esperado.
    const d = await git($, ['diff', ...FORMATO, '--no-index', '--', '/dev/null', f], top)
    diff += d.stdout
  }
  return { diff, raiz: top, novos }
}

async function escolher(
  $: EngineInterface,
  a: { base?: string; cwd?: string; modelo?: string; novos?: boolean },
): Promise<{ texto: string; erro: boolean }> {
  const base = a.base?.trim() || 'HEAD'
  const cwd = a.cwd?.trim() || (await $.session.cwd())
  const { diff, raiz, novos, erro } = await diffDoRepo($, base, cwd, a.novos !== false)
  if (erro) return { texto: `Erro: ${erro}`, erro: true }
  const { fonte, excluidos, naoCodigo } = separar(diff)
  if (!fonte.length) {
    return { texto: `Nenhum código-fonte alterado contra ${base}${excluidos.length ? ` (só testes: ${excluidos.join(', ')})` : ''}.`, erro: true }
  }
  const modelo = a.modelo?.trim() || (await $.session.model())
  const r = await $.model.complete({ model: modelo, system: SISTEMA, prompt: montarPrompt(fonte), maxTokens: LIMITE_ESCOLHA })
  if (!r.isAnswered) return { texto: `Erro: o modelo não respondeu (${r.reason}).`, erro: true }
  const corte = cortarResposta(r.text, r.usage?.output_tokens ?? 0, LIMITE_ESCOLHA)
  const lido = lerResposta(corte.texto)
  const escolha: Escolha = {
    raiz,
    base,
    modelo,
    enviados: fonte.map(b => b.arquivo),
    excluidos,
    naoCodigo,
    avisoNovos: avisoNovos(fonte.map(b => b.arquivo), novos),
    ...(corte.aviso ? { avisoCorte: corte.aviso } : {}),
    mutantes: lido.mutantes,
    linhasDoDiff: fonte.reduce((t, b) => t + linhasDoDiff(b.texto), 0),
    naoAplicaveis: lido.naoAplicaveis,
  }
  await update($, ultima, () => escolha)
  const faltam = lacunas(lido.mutantes, lido.naoAplicaveis)
  return {
    texto: [
      `Escolha: R2.1 às cegas por ${modelo} via $.model.complete (sem ferramentas, sem histórico).`,
      `Enviado: diff de ${escolha.enviados.join(', ')} contra ${base}. Testes retirados antes do envio: ${excluidos.join(', ') || 'nenhum'}.${naoCodigo.length ? ` Não-código fora do envio: ${naoCodigo.join(', ')}.` : ''}`,
      escolha.avisoNovos ?? '',
      escolha.avisoCorte ?? '',
      `Mutantes (${lido.mutantes.length}):`,
      tabela(lido.mutantes) || '  nenhum',
      lido.naoAplicaveis.length ? `Não aplicáveis: ${lido.naoAplicaveis.join('; ')}` : '',
      excluidos.length
        ? ''
        : '⚠ Nenhum arquivo de teste no diff: o EXP-001 vale para tarefas que criam ou alteram testes; sem teste, nada mata estes mutantes. Não registre como rodada.',
      faltam.length ? `⚠ Categorias sem mutante nem justificativa: ${faltam.join(', ')}. Acrescente você ao menos um em cada.` : '',
      lido.ignoradas.length ? `Linhas fora do formato (confira): ${lido.ignoradas.join(' / ')}` : '',
      `Aplique todos, um por vez; não remova nenhum. Protocolo: ${protocoloEm($.plugin.root)}. Ao fim, chame ${TOOL_REGISTRAR}.`,
    ]
      .filter(Boolean)
      .join('\n'),
    erro: false,
  }
}

/** O repositório de uma pasta, o mesmo para todas as worktrees dele (o diretório comum do git, sem o /.git). */
async function repositorioDe($: EngineInterface, pasta: string): Promise<string | undefined> {
  const r = await git($, ['rev-parse', '--path-format=absolute', '--git-common-dir'], pasta).catch(() => undefined)
  return r?.exitCode === 0 && r.stdout.trim() ? r.stdout.trim().replace(/\/\.git\/?$/, '') : undefined
}

/**
 * Onde vai a linha. Um log compartilhado que mora num repositório git (que pode ir ao GitHub e ao público) recebe só
 * as rodadas desse mesmo repositório, de qualquer worktree dele; a rodada de outro projeto vai a um log local dele,
 * fora de qualquer git: o que um projeto sensível testa não sai da máquina (15/10/2026: as rodadas do motor iam ao
 * log dos mods). Log compartilhado fora de git é local: vale para todos. PROVA_DE_TESTE_LOG fixa o destino.
 */
async function destinoDoLog($: EngineInterface, raizDaRodada?: string): Promise<{ caminho: string; compartilhado: boolean } | undefined> {
  const doEnv = await $.env.get('PROVA_DE_TESTE_LOG').catch(() => undefined)
  if (doEnv) return { caminho: doEnv, compartilhado: true }
  const home = await $.env.get('HOME').catch(() => undefined)
  if (!home) return undefined
  const padrao = logPadrao(home)
  const real = (await $.fs.stat(padrao, { resolve: true }).catch(() => undefined))?.realPath ?? padrao
  const repoDoLog = await repositorioDe($, real.slice(0, real.lastIndexOf('/')))
  if (!repoDoLog) return { caminho: padrao, compartilhado: true }
  const raiz = raizDaRodada || (await $.session.cwd().catch(() => ''))
  const repoDaRodada = raiz ? await repositorioDe($, raiz) : undefined
  if (repoDaRodada === repoDoLog) return { caminho: padrao, compartilhado: true }
  return { caminho: logDoProjeto(home, repoDaRodada ?? raiz), compartilhado: false }
}

/** A versão do mod em plugin.json; ilegível, '?'. */
async function versaoDoMod($: EngineInterface): Promise<string> {
  return versaoDe(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).catch(() => ''))
}

/**
 * A efetividade do projeto da sessão vai a ~/.claude/indicadores/<raiz da sessão>/prova-de-teste.json, que o painel do
 * contexto-bar daquela raiz mostra. Só o log desse projeto entra: cada sessão vê os números dela, nunca a soma de
 * todos (nota do operador, 15/10/2026: os gauges das duas sessões mostravam a mesma mistura).
 */
async function publicarPlacar($: EngineInterface): Promise<void> {
  const home = await $.env.get('HOME').catch(() => undefined)
  if (!home) return
  const raiz = (await $.session.root().catch(() => '')) || (await $.session.cwd().catch(() => ''))
  if (!raiz) return
  const destino = await destinoDoLog($, raiz)
  if (!destino) return
  const real = (await $.fs.stat(destino.caminho, { resolve: true }).catch(() => undefined))?.realPath ?? destino.caminho
  if (!(await $.fs.exists(real))) return
  const texto = indicadoresDeEfetividade(efetividade(await $.fs.read(real)))
  const arquivo = `${home}/.claude/indicadores/${encodeURIComponent(raiz)}/prova-de-teste.json`
  if ((await $.fs.read(arquivo).catch(() => '')) !== texto) await $.fs.write(arquivo, texto)
}

async function registrar($: EngineInterface, r: Partial<Registro> & { defeitoInstrumento?: string }): Promise<{ texto: string; erro: boolean }> {
  const data = new Date().toISOString().slice(0, 10)
  const feita = await read($, execucao)
  const instrumento = instrumentoDe(feita)
  const defeitos = defeitosDoInstrumento({
    informado: r.defeitoInstrumento,
    alteraInstrumento: feita?.alteraInstrumento,
    versaoNaExecucao: feita?.versao,
    versaoAgora: feita ? await versaoDoMod($) : undefined,
  })
  // O custo vem do que o mod mediu, nunca do agente.
  const { linha, erro } = linhaLog({ ...r, instrumento, defeitos, custo: feita?.custo }, data)
  if (erro || !linha) return { texto: `Erro: ${erro}`, erro: true }
  const divergente = feita && (conferir(feita, r) ?? conferirEstado(feita, r.estado!, r.equivalentes ?? [], r.manuais ?? []))
  if (divergente) return { texto: `Erro: ${divergente}`, erro: true }
  const destino = await destinoDoLog($, feita?.raiz)
  if (!destino) return { texto: `Erro: sem ${LOG_ENV} nem HOME, não sei onde fica o log.`, erro: true }
  const caminho = destino.caminho
  // Num link, a linha vai ao arquivo real e o commit roda na pasta dele.
  const log = (await $.fs.stat(caminho, { resolve: true }).catch(() => undefined))?.realPath ?? caminho
  const atual = (await $.fs.exists(log)) ? await $.fs.read(log) : CABECALHO_LOG
  await $.fs.write(log, `${atual.endsWith('\n') ? atual : `${atual}\n`}${linha}\n`)
  // Uma execução vale para um registro só.
  if (feita) await update($, execucao, () => null)
  if (!destino.compartilhado) {
    await publicarPlacar($).catch(() => undefined)
    return { texto: `Gravado no log local do projeto, fora de qualquer git (o log compartilhado só recebe as rodadas do repositório dele): ${caminho}\n${linha}`, erro: false }
  }
  const dir = log.slice(0, log.lastIndexOf('/'))
  await git($, ['add', log], dir)
  const c = await git($, ['commit', '-q', '-m', `EXP-001 log: ${r.tarefa!.trim().slice(0, 60)}`, '--', log], dir)
  await publicarPlacar($).catch(() => undefined)
  return { texto: `Gravado em ${caminho}${log !== caminho ? ` (→ ${log})` : ''}:\n${linha}${c.exitCode === 0 ? '\n(commit no repositório do log)' : `\n(sem commit: ${c.stderr.trim() || c.stdout.trim()})`}`, erro: false }
}

const SPEC_EXECUTAR = {
  name: 'executar',
  description:
    'F2 do EXP-001: o mod executa a rodada sozinho. Escolhe os mutantes às cegas (como a ferramenta mutantes), copia o repositório ' +
    '(com as mudanças sem commit) para uma pasta temporária, roda a linha de base, aplica cada mutante pelo trecho, roda os testes, ' +
    'restaura e devolve o relatório PROVA DE TESTE v1.1. O original nunca é tocado. O red first (R1) continua a seu cargo. ' +
    'Depois, registre com os números do relatório; um reforço de teste exige executar de novo.',
  isDeferred: false,
  inputSchema: {
    type: 'object',
    properties: {
      tarefa: { type: 'string', description: 'Nome curto da tarefa, para o relatório e o log.' },
      cwd: { type: 'string', description: 'Pasta do repositório (padrão: a da sessão).' },
      novos: { type: 'boolean', description: 'Inclui os arquivos fora do git no diff (padrão true). Use false quando o repositório tem código antigo nunca commitado.' },
      base: { type: 'string', description: 'Ref do git (padrão HEAD).' },
      modelo: { type: 'string', description: 'Modelo que escolhe (padrão: o da sessão).' },
      comando: { type: 'array', items: { type: 'string' }, description: 'Comando de teste, rodado na raiz da cópia. Padrão: detectado (claude plugin test, npm test, pytest).' },
      timeoutSegundos: { type: 'number', description: 'Limite por execução dos testes (padrão 120, máximo 600).' },
      repetir: { type: 'boolean', description: 'Reaplica a última lista escolhida às cegas (para provar um reforço com os mesmos mutantes) em vez de pedir outra.' },
      paralelo: {
        type: 'integer',
        description:
          'Quantas cópias rodam mutantes ao mesmo tempo (padrão: um quarto dos núcleos, até 8; 1 = em fila). A linha de base roda antes em todas juntas; se falhar assim, a rodada vai em fila.',
      },
      incremental: {
        type: 'boolean',
        description:
          'Por mutante, roda só os arquivos de teste que alcançam o arquivo mutado pelos imports (padrão true); sobrevivente é confirmado na suíte inteira. false roda a suíte inteira em todos (para comparar).',
      },
    },
    required: ['tarefa'],
  },
} as const

const PREFIXO_TMP = 'prova-de-teste-'

/** Pastas de plugin do Claude Code (com .claude-plugin/plugin.json) acima de cada arquivo tocado, relativas à raiz. */
async function pastasDePlugin($: EngineInterface, raiz: string, tocados: string[]): Promise<string[]> {
  const achadas = new Set<string>()
  for (const t of tocados) {
    const partes = t.split('/').slice(0, -1)
    for (let i = partes.length; i >= 0; i--) {
      const dir = partes.slice(0, i).join('/')
      if (await $.fs.exists(`${raiz}/${dir ? `${dir}/` : ''}.claude-plugin/plugin.json`)) {
        achadas.add(dir)
        break
      }
    }
  }
  return [...achadas]
}

/** Os nomes dos plugins a que os arquivos tocados pertencem, pelo plugin.json de cada um. */
async function pluginsTocados($: EngineInterface, raiz: string, tocados: string[]): Promise<string[]> {
  const nomes: string[] = []
  for (const p of await pastasDePlugin($, raiz, tocados)) {
    const nome = nomeDe(await $.fs.read(`${raiz}/${p ? `${p}/` : ''}.claude-plugin/plugin.json`).catch(() => ''))
    if (nome) nomes.push(nome)
  }
  return nomes
}

/** O progresso da rodada no arquivo da sessão (contrato em execucao.ts); sem HOME ou sem sessão, nada. */
async function publicarAoVivo($: EngineInterface, p: AoVivo): Promise<void> {
  const [home, id] = await Promise.all([$.env.get('HOME'), $.session.id()])
  if (!home || !id) return
  await $.fs.write(`${home}/.claude/prova-de-teste/ao-vivo/${encodeURIComponent(id)}.json`, `${JSON.stringify(p)}\n`)
}

async function executar(
  $: EngineInterface,
  a: { tarefa?: string; cwd?: string; base?: string; modelo?: string; novos?: boolean; comando?: string[]; timeoutSegundos?: number; repetir?: boolean; incremental?: boolean; paralelo?: number },
): Promise<{ texto: string; erro: boolean }> {
  const inicio = Date.now()
  if (!a.tarefa?.trim()) return { texto: 'Erro: falta tarefa.', erro: true }
  // Repetir prova um reforço contra os mesmos mutantes; sem repetir, a lista é nova e cega.
  const anterior = a.repetir ? await read($, ultima) : null
  if (a.repetir && !anterior) return { texto: 'Erro: não há lista anterior para repetir; rode sem repetir.', erro: true }
  const esc = anterior ? { texto: `Repetindo a lista anterior (${anterior.mutantes.length} mutantes).`, erro: false } : await escolher($, a)
  if (esc.erro) return esc
  const e = await read($, ultima)
  if (!e) return { texto: 'Erro: a escolha não ficou registrada.', erro: true }
  // Ao vivo: o painel acompanha a rodada; uma falha ao escrever nunca derruba a prova.
  const vivo = { tarefa: a.tarefa.trim(), resultados: [] as Resultado[], feitos: 0, total: e.mutantes.length, copias: undefined as number | undefined }
  let fimPublicado = false
  const aoVivo = async (fase: FaseAoVivo, estado?: string) => {
    if (fase === 'fim') fimPublicado = true
    await publicarAoVivo($, progresso(vivo, fase, inicio, Date.now(), estado)).catch(() => undefined)
  }
  const timeoutMs = Math.min(600, Math.max(5, a.timeoutSegundos ?? 120)) * 1000

  const raiz = e.raiz
  let comandos: Comando[] = a.comando?.length ? [{ argv: [...a.comando] }] : []
  if (!comandos.length) {
    const pacote = (await $.fs.exists(`${raiz}/package.json`)) ? await $.fs.read(`${raiz}/package.json`) : undefined
    const temPytest = (await $.fs.exists(`${raiz}/pytest.ini`)) || (await $.fs.exists(`${raiz}/pyproject.toml`))
    // Os comandos são montados para a cópia: a raiz entra depois.
    comandos = detectarComando({ pacote, temPytest, pastasDePlugin: await pastasDePlugin($, raiz, e.enviados) }, e.enviados, '{COPIA}')
  }
  if (!comandos.length) return { texto: `Erro: não achei o comando de teste em ${raiz}; passe "comando".\n\n${esc.texto}`, erro: true }

  const statusAntes = (await git($, ['status', '--porcelain'], raiz)).stdout
  // O que vale é nenhum mutante ter chegado ao original. Outra sessão pode comitar ou editar o repositório durante a
  // rodada (a cópia já foi feita): isso não invalida a prova, só é dito (rodadas perdidas no motor, 15/10).
  const mutados = new Map<string, Set<string>>()
  const tmp = await $.process.run(['mktemp', '-d', '-t', `${PREFIXO_TMP}XXXXXX`])
  const pasta = tmp.stdout.trim()
  if (tmp.exitCode !== 0 || !pasta.includes(PREFIXO_TMP)) return { texto: `Erro: não criei a pasta temporária (${tmp.stderr.trim()}).`, erro: true }
  const copia = `${pasta}/repo`
  try {
    /** Uma cópia pronta para os testes: o repositório inteiro, sem o bytecode ao lado do que muda, com o venv apontando para ela. */
    const preparar = async (destino: string, realocado: string): Promise<string | undefined> => {
      const cp = await $.process.run(['cp', '-a', '--reflink=auto', `${raiz}/.`, destino], { timeoutMs: 600_000 })
      if (cp.exitCode !== 0) return `a cópia falhou (${cp.stderr.trim()})`
      // Os .pyc que vieram na cópia, ao lado do que pode ser mutado, saem antes da base (ver AMBIENTE_DE_TESTE).
      const pycaches = pycachesDe(e.enviados).map(p => `${destino}/${p}`)
      if (pycaches.length) {
        const rm = await $.process.run(['rm', '-rf', '--', ...pycaches])
        if (rm.exitCode !== 0) return `não apaguei o __pycache__ da cópia (${rm.stderr.trim()})`
      }
      // O venv copiado passa a apontar para a cópia (ver ACHAR_NO_VENV).
      const doVenv = await $.process.run(['sh', '-c', ACHAR_NO_VENV, 'sh', raiz], { cwd: destino })
      for (const f of doVenv.stdout.split('\n').filter(Boolean)) {
        // Link fica de fora: escrever nele escreveria no alvo, que pode ser o venv do original.
        const st = await $.fs.stat(`${destino}/${f}`).catch(() => undefined)
        if (!st || st.isLink) continue
        const t = await $.fs.read(`${destino}/${f}`)
        const novo = realocar(t, raiz, destino)
        if (novo === t) continue
        await $.fs.write(realocado, novo)
        const w = await $.process.run(['sh', '-c', SOBRESCREVER, 'sh', realocado, `${destino}/${f}`])
        if (w.exitCode !== 0) return `não apontei o venv da cópia para a cópia (${f}: ${w.stderr.trim()})`
      }
      return undefined
    }
    const erroDaCopia = await preparar(copia, `${pasta}/realocado`)
    if (erroDaCopia) return { texto: `Erro: ${erroDaCopia}.`, erro: true }
    /** Os arquivos JS/TS/Python do repositório e quem importa quem; grande demais ou ilegível, nada. */
    const mapear = async () => {
      const ls = await git($, ['ls-files', '--cached', '--others', '--exclude-standard'], copia)
      if (ls.exitCode !== 0) return undefined
      const listados = [...new Set(ls.stdout.split('\n'))]
      const arquivos = listados.filter(ehMapeavel)
      if (!cabeNoMapa(arquivos.length)) return undefined
      const ler = async (f: string) => {
        const t = await $.fs.read(`${copia}/${f}`).catch(() => undefined)
        return typeof t === 'string' ? t : undefined
      }
      // Os aliases (`@/x`) dos tsconfig e vite.config: sem eles, os imports com alias não entram no mapa.
      const aliases: Alias[] = []
      for (const f of listados.filter(ehConfigDeAlias)) aliases.push(...aliasesDe(f, (await ler(f)) ?? ''))
      const fontes = new Map<string, string>()
      for (const f of arquivos) {
        const t = await ler(f)
        if (t !== undefined) fontes.set(f, t)
      }
      return { g: grafo(fontes, aliases), testes: [...fontes.keys()].filter(ehEntradaDeTeste) }
    }
    let mapa: Awaited<ReturnType<typeof mapear>>

    /** Quem roda os testes numa cópia: os comandos dela, os testes que ela escondeu e como rodar. */
    const trabalhador = (dir: string) => {
      const comandosDaCopia = comandos.map(c => ({ ...c, argv: c.argv.map(x => x.replaceAll('{COPIA}', dir)) }))
      const rodarUm = async (argv: string[]) =>
        $.process.run(argv, { cwd: dir, timeoutMs, env: AMBIENTE_DE_TESTE }).catch(err => ({
          exitCode: -1,
          stdout: '',
          stderr: `não rodou: ${err instanceof Error ? err.message : String(err)}`,
        }))
      /** Roda os comandos em ordem e para no primeiro que falhar; os testes somam os de cada comando que rodou. */
      const rodar = async (cs: Comando[]) => {
        const t = Date.now()
        let ultimo = { exitCode: 0, stdout: '', stderr: '' }
        let testes: number | undefined = 0
        for (const c of cs) {
          ultimo = await rodarUm(c.argv)
          testes = somarTestes(testes, contarTestes(`${ultimo.stdout}\n${ultimo.stderr}`))
          if (ultimo.exitCode !== 0) break
        }
        return { ...ultimo, testes, segundos: (Date.now() - t) / 1000 }
      }
      const escondidos = new Set<string>()
      /** Esconde na cópia os arquivos de teste fora de `quero`, renomeando; mexe só no que mudou desde a última vez. */
      const ajustar = async (quero: Set<string>) => {
        const mv = async (fs: string[], de: string, para: string) => {
          if (!fs.length) return
          const r = await $.process.run(['sh', '-c', `for f; do mv -- "$f${de}" "$f${para}"; done`, 'sh', ...fs], { cwd: dir })
          if (r.exitCode !== 0) throw new Error(`não consegui ${para ? 'esconder' : 'mostrar'} testes na cópia: ${r.stderr.trim()}`)
        }
        const esconder = (mapa?.testes ?? []).filter(t => !quero.has(t) && !escondidos.has(t))
        const mostrar = [...escondidos].filter(t => quero.has(t))
        await mv(esconder, '', SUFIXO_FORA)
        esconder.forEach(t => escondidos.add(t))
        await mv(mostrar, SUFIXO_FORA, '')
        mostrar.forEach(t => escondidos.delete(t))
      }
      const todos = () => ajustar(new Set(mapa?.testes ?? []))
      return { dir, comandos: comandosDaCopia, rodar, ajustar, todos }
    }
    type Trabalhador = ReturnType<typeof trabalhador>
    const primeiro = trabalhador(copia)

    await aoVivo('base')
    const base = await primeiro.rodar(primeiro.comandos)
    const lsTree = await git($, ['ls-tree', '-r', '-l', 'HEAD'], raiz)

    // O mapa da execução incremental: lido da cópia uma vez; sem ele, cada mutante roda a suíte inteira.
    mapa = a.incremental === false || base.exitCode !== 0 ? undefined : await mapear()
    const nproc = await $.process.run(['nproc']).catch(() => undefined)
    const nucleos = nproc?.exitCode === 0 ? Number.parseInt(nproc.stdout.trim(), 10) || undefined : undefined
    const paralelo: Paralelo = { copias: 1, ...(nucleos ? { nucleos } : {}) }
    const exec: Execucao = {
      tarefa: a.tarefa.trim(),
      modelo: e.modelo,
      comando: primeiro.comandos.map(c => c.argv.join(' ').replaceAll(copia, '<cópia>')),
      enviados: e.enviados,
      excluidos: e.excluidos,
      naoCodigo: e.naoCodigo,
      avisoNovos: e.avisoNovos,
      avisoCorte: e.avisoCorte,
      naoAplicaveis: e.naoAplicaveis,
      linhaDeBase: { passou: base.exitCode === 0, segundos: base.segundos, saida: base.exitCode === 0 ? undefined : (base.stdout + base.stderr).slice(-1500) },
      resultados: [],
      restauracao: 'cmp na cópia: idêntico',
      originalIntocado: true,
      segundos: 0,
      custo: {
        repo: lsTree.exitCode === 0 ? tamanhoDoRepo(lsTree.stdout) : undefined,
        diff: { arquivos: e.enviados.length, linhas: e.linhasDoDiff ?? 0 },
        testesNaBase: base.testes,
      },
      paralelo,
    }
    const trabalhadores: Trabalhador[] = [primeiro]
    if (exec.linhaDeBase.passou) {
      // As outras cópias. Antes de dividir os mutantes, a linha de base roda em todas ao mesmo tempo: se falha
      // assim e passou sozinha, as suítes disputam algo (uma porta, um arquivo fora da cópia) e a rodada vai em fila.
      const largura = larguraDoParalelo(a.paralelo, nucleos, e.mutantes.length)
      for (let k = 2; k <= largura; k++) {
        const erro = await preparar(`${pasta}/repo-${k}`, `${pasta}/realocado-${k}`)
        if (erro) {
          paralelo.motivo = `a cópia ${k} não ficou pronta (${erro})`
          break
        }
        trabalhadores.push(trabalhador(`${pasta}/repo-${k}`))
      }
      if (paralelo.motivo) trabalhadores.splice(1)
      if (trabalhadores.length > 1) {
        const bases = await Promise.all(trabalhadores.map(t => t.rodar(t.comandos)))
        if (bases.some(b => b.exitCode !== 0)) {
          paralelo.motivo = `a linha de base falhou com ${trabalhadores.length} cópias ao mesmo tempo e passou sozinha (porta, arquivo ou outro recurso que as suítes disputam)`
          trabalhadores.splice(1)
        }
      }
      paralelo.copias = trabalhadores.length
      vivo.copias = trabalhadores.length

      /** Por recorte: se ele passa sem mutante (ver chaveDoRecorte); a chave não depende da cópia, e cada recorte roda uma vez. */
      const basesDoRecorte = new Map<string, Promise<boolean>>()
      const semCopia = (t: Trabalhador, cs: Comando[]) => cs.map(c => ({ ...c, argv: c.argv.map(x => x.replaceAll(t.dir, '{COPIA}')) }))
      const processar = async (w: Trabalhador, m: Mutante, r: Resultado) => {
        const alvo = resolverArquivo(m.arquivo, e.enviados)
        if ('erro' in alvo) {
          r.motivo = alvo.erro
          return
        }
        r.arquivo = alvo.arquivo
        // Sem comando que cubra o arquivo, "sobreviver" não diria nada: nem roda.
        const cobrem = comandosPara(alvo.arquivo, w.comandos)
        if (!cobrem.length) {
          r.motivo = 'nenhum comando de teste cobre este arquivo'
          return
        }
        const caminho = `${w.dir}/${alvo.arquivo}`
        const original = await $.fs.read(caminho)
        const ap = aplicarTrecho(original, m.linha, m.mutacao)
        if ('erro' in ap) {
          r.motivo = ap.erro
          return
        }
        r.linhaReal = ap.linhaReal
        r.ocorrencias = ap.ocorrencias
        mutados.set(alvo.arquivo, (mutados.get(alvo.arquivo) ?? new Set()).add(ap.texto))
        let plano = planoIncremental(alvo.arquivo, mapa, cobrem)
        if (plano.alcancam) {
          // Ainda sem o mutante: o recorte novo roda uma vez no código original; falhando, a suíte inteira decide.
          const chave = chaveDoRecorte(plano.alcancam, semCopia(w, plano.comandos))
          if (!basesDoRecorte.has(chave)) {
            const alcancam = new Set(plano.alcancam)
            const comandosDoRecorte = plano.comandos
            basesDoRecorte.set(chave, (async () => (await w.ajustar(alcancam), (await w.rodar(comandosDoRecorte)).exitCode === 0))())
          }
          if (!(await basesDoRecorte.get(chave))) plano = { escopo: `suíte inteira (o recorte de ${plano.alcancam.length} arquivos de teste falha sem mutante)`, comandos: cobrem }
        }
        await $.fs.write(caminho, ap.texto)
        try {
          r.escopo = plano.escopo
          let t: Awaited<ReturnType<Trabalhador['rodar']>>
          if (plano.alcancam) {
            await w.ajustar(new Set(plano.alcancam))
            const inc = await w.rodar(plano.comandos)
            const saidaInc = inc.stdout + '\n' + inc.stderr
            // Morte só vale com um teste nomeado; sobrevivente, carga quebrada ou falha sem nome: a suíte inteira decide.
            const morteNomeada = inc.exitCode !== 0 && !invalido(saidaInc) && !/^código de saída/.test(quemMatou(saidaInc, inc.exitCode))
            if (morteNomeada) t = inc
            else {
              await w.todos()
              const cheia = await w.rodar(cobrem)
              r.escopo = `${plano.escopo}, ${inc.exitCode === 0 ? 'sobrevivente confirmado' : 'falha sem nome refeita'} na suíte inteira`
              t = { ...cheia, segundos: inc.segundos + cheia.segundos, testes: somarTestes(inc.testes, cheia.testes) }
            }
          } else {
            await w.todos()
            t = await w.rodar(cobrem)
          }
          r.segundos = t.segundos
          const saida = t.stdout + '\n' + t.stderr
          r.testes = t.testes
          if (t.exitCode !== 0 && invalido(saida)) {
            r.motivo = `mutante inválido: o código mutado não carregou (${erroDeCarga(saida)}); não conta como morto`
          } else {
            r.situacao = t.exitCode === 0 ? 'SOBREVIVENTE' : 'MORTO'
            if (t.exitCode !== 0) r.motivo = quemMatou(saida, t.exitCode)
          }
        } finally {
          await $.fs.write(caminho, original)
          if ((await $.fs.read(caminho)) !== original) exec.restauracao = 'cmp na cópia: DIFERENTE'
        }
      }

      // Os mutantes saem de uma fila só, na ordem da lista; o número de cada um é o da lista, rode em que cópia rodar.
      const fila = e.mutantes.map((m, i) => {
        const r: Resultado = { ...m, n: i + 1, situacao: 'NÃO APLICADO', segundos: 0 }
        exec.resultados.push(r)
        return { m, r }
      })
      vivo.resultados = exec.resultados
      await aoVivo('mutantes')
      let proximo = 0
      // allSettled: se uma cópia lança, as outras terminam antes de a pasta ser apagada; depois o erro sobe.
      const feitos = await Promise.allSettled(
        trabalhadores.map(async t => {
          while (proximo < fila.length) {
            const { m, r } = fila[proximo++]!
            await processar(t, m, r)
            vivo.feitos++
            await aoVivo('mutantes')
          }
        }),
      )
      const falhou = feitos.find((x): x is PromiseRejectedResult => x.status === 'rejected')
      if (falhou) throw falhou.reason
      if (trabalhadores.length > 1) {
        // Morte sem teste nomeado pode ser a disputa por CPU (tempo esgotado): refeita sozinha, na primeira cópia.
        const refazer = fila.filter(({ r }) => refazerSozinho(r))
        for (const { m, r } of refazer) {
          Object.assign(r, { situacao: 'NÃO APLICADO', segundos: 0, testes: undefined, escopo: undefined, motivo: undefined })
          await processar(primeiro, m, r)
          r.escopo = `${r.escopo ?? 'suíte inteira'}, refeito sozinho (morte sem nome em paralelo)`
        }
        paralelo.refeitos = refazer.length
      }
    }
    // Os testes escondidos voltam antes de conferir a cópia; se um mv falhar, ajustar lança e a rodada não sai.
    for (const t of trabalhadores) await t.todos()
    for (const [arquivo, textos] of mutados) {
      const agora = await $.fs.read(`${raiz}/${arquivo}`).catch(() => undefined)
      if (agora !== undefined && textos.has(agora)) exec.originalIntocado = false
    }
    exec.mudouPorFora = (await git($, ['status', '--porcelain'], raiz)).stdout !== statusAntes
    exec.segundos = (Date.now() - inicio) / 1000
    const c = contar(exec.resultados)
    const feita: ExecucaoFeita = {
      tarefa: exec.tarefa,
      raiz,
      ...c,
      estado: estadoDe(exec),
      estadoSeEquivalentes: estadoSeEquivalentes(exec),
      sobreviventesN: exec.resultados.filter(x => x.situacao === 'SOBREVIVENTE').map(x => x.n),
      descobertas: categoriasDescobertas(exec.resultados, exec.naoAplicaveis),
      quando: new Date().toISOString(),
      versao: await versaoDoMod($),
      // O diff mexe no próprio mod: a rodada mede o instrumento enquanto ele muda (v1.2: calibração).
      alteraInstrumento: tocaOInstrumento(
        raiz,
        e.enviados,
        $.plugin.root,
        await pluginsTocados($, raiz, e.enviados),
        nomeDe(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).catch(() => '')),
      ),
      custo: resumoCusto(exec),
    }
    await update($, execucao, () => feita)
    vivo.resultados = exec.resultados
    await aoVivo('fim', feita.estado)
    const texto = relatorio(exec, new Date().toISOString().slice(0, 10))
    const saidaBase = exec.linhaDeBase.saida ? `\n\nSaída da linha de base (fim):\n${exec.linhaDeBase.saida}` : ''
    return { texto: `${texto}${saidaBase}\n\nRegistre com ${TOOL_REGISTRAR}: aplicados ${c.aplicados}, mortos ${c.mortos}, sobreviventes ${c.sobreviventes}.`, erro: false }
  } finally {
    // Rodada que saiu no meio (erro, cópia que falhou): o painel não fica mostrando uma prova que não roda mais.
    if (!fimPublicado && vivo.total) await aoVivo('fim', 'interrompida')
    // Só apaga a pasta que o próprio mod criou.
    if (pasta.includes(PREFIXO_TMP)) await $.process.run(['rm', '-rf', '--', pasta]).catch(() => undefined)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register(SPEC_MUTANTES)
    await $.tool.register(SPEC_REGISTRAR)
    await $.tool.register(SPEC_EXECUTAR)
    await $.command.register({
      name: 'prova',
      description: 'EXP-001: mutantes escolhidos às cegas para o diff de um repositório (pasta padrão: a da sessão; base padrão: HEAD)',
      argumentHint: '[pasta] [base]',
    })
    await publicarPlacar($).catch(() => undefined)
    return next(e)
  })

  on('tool.call', { tool: TOOL_MUTANTES as never }, async ($, e) => {
    const r = await escolher($, e as never).catch(falha)
    return { result: r.texto, ...(r.erro ? { isError: true } : {}) } as never
  })

  on('tool.call', { tool: TOOL_REGISTRAR as never }, async ($, e) => {
    const r = await registrar($, e as never).catch(falha)
    return { result: r.texto, ...(r.erro ? { isError: true } : {}) } as never
  })

  on('tool.call', { tool: TOOL_EXECUTAR as never }, async ($, e) => {
    const r = await executar($, e as never).catch(falha)
    return { result: r.texto, ...(r.erro ? { isError: true } : {}) } as never
  })

  on('command.run', { command: 'prova' }, async ($, e) => {
    const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
    const r = await escolher($, lerArgs(e.args, home)).catch(falha)
    return { text: r.texto }
  })

  // Uma edição de arquivo de teste na conversa principal marca a tarefa como "com teste": um lembrete por turno.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined || result.isError) return result
    // O lembrete é acessório: nenhuma falha aqui pode atrapalhar a edição em si.
    const aviso = await lembrete($, e).catch(() => undefined)
    return aviso ? { ...result, context: [...(result.context ?? []), aviso] } : result
  })
}

async function lembrete(
  $: EngineInterface,
  e: { agentId?: string; tool: unknown },
): Promise<string | undefined> {
  {
    if (e.agentId || !EDICAO.has(e.tool as string)) return undefined
    const caminho = String((e as { file_path?: string }).file_path ?? (e as { notebook_path?: string }).notebook_path ?? '')
    if (!ehArquivoDeTeste(caminho)) return undefined
    const turno = await $.session.turns()
    if ((await read($, avisadoTurno)) === turno) return undefined
    await update($, avisadoTurno, () => turno)
    return (
      `[prova-de-teste] Esta tarefa mexe em teste (${caminho}). Vale o EXP-001 v1.2: leia ${protocoloEm($.plugin.root)}; ` +
      `red first; depois chame ${TOOL_MUTANTES} para os mutantes às cegas (R2.1), aplique todos e registre com ${TOOL_REGISTRAR}.`
    )
  }
}

const falha = (err: unknown) => ({ texto: `Erro: ${err instanceof Error ? err.message : String(err)}`, erro: true })
