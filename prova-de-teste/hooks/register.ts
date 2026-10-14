import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Escolha, ExecucaoFeita } from '../types'
import { aplicarTrecho, comandosPara, contarTestes, planoIncremental, somarTestes, linhasDoDiff, resumoCusto, tamanhoDoRepo, conferirEstado, erroDeCarga, estadoSeEquivalentes, invalido, conferir, contar, detectarComando, estadoDe, quemMatou, relatorio, resolverArquivo } from './execucao'
import type { Comando, Execucao, Resultado } from './execucao'
import { avisoNovos, defeitosDoInstrumento, instrumentoDe, CABECALHO_LOG, lacunas, lerArgs, LOG_ENV, logPadrao, lerResposta, linhaLog, montarPrompt, protocoloEm, separar, SISTEMA, tabela, tocaOInstrumento, versaoDe, ehArquivoDeTeste } from './prova'
import type { Registro } from './prova'
import { cabeNoMapa, ehEntradaDeTeste, ehMapeavel, grafo, SUFIXO_FORA, testesQueAlcancam } from './alcance'

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
  const r = await $.model.complete({ model: modelo, system: SISTEMA, prompt: montarPrompt(fonte), maxTokens: 4000 })
  if (!r.isAnswered) return { texto: `Erro: o modelo não respondeu (${r.reason}).`, erro: true }
  const lido = lerResposta(r.text)
  const escolha: Escolha = {
    raiz,
    base,
    modelo,
    enviados: fonte.map(b => b.arquivo),
    excluidos,
    naoCodigo,
    avisoNovos: avisoNovos(fonte.map(b => b.arquivo), novos),
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

async function caminhoDoLog($: EngineInterface): Promise<string | undefined> {
  const doEnv = await $.env.get('PROVA_DE_TESTE_LOG').catch(() => undefined)
  if (doEnv) return doEnv
  const home = await $.env.get('HOME').catch(() => undefined)
  return home ? logPadrao(home) : undefined
}

/** A versão do mod em plugin.json; ilegível, '?'. */
async function versaoDoMod($: EngineInterface): Promise<string> {
  return versaoDe(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).catch(() => ''))
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
  const divergente = feita && (conferir(feita, r) ?? conferirEstado(feita, r.estado!, r.equivalentes ?? []))
  if (divergente) return { texto: `Erro: ${divergente}`, erro: true }
  const caminho = await caminhoDoLog($)
  if (!caminho) return { texto: `Erro: sem ${LOG_ENV} nem HOME, não sei onde fica o log.`, erro: true }
  // Num link, a linha vai ao arquivo real e o commit roda na pasta dele.
  const log = (await $.fs.stat(caminho, { resolve: true }).catch(() => undefined))?.realPath ?? caminho
  const atual = (await $.fs.exists(log)) ? await $.fs.read(log) : CABECALHO_LOG
  await $.fs.write(log, `${atual.endsWith('\n') ? atual : `${atual}\n`}${linha}\n`)
  const dir = log.slice(0, log.lastIndexOf('/'))
  await git($, ['add', log], dir)
  const c = await git($, ['commit', '-q', '-m', `EXP-001 log: ${r.tarefa!.trim().slice(0, 60)}`, '--', log], dir)
  // Uma execução vale para um registro só.
  if (feita) await update($, execucao, () => null)
  return { texto: `Gravado em ${caminho}${log !== caminho ? ` (→ ${log})` : ''}:\n${linha}${c.exitCode === 0 ? '\n(commit no git do harness)' : `\n(sem commit: ${c.stderr.trim() || c.stdout.trim()})`}`, erro: false }
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

async function executar(
  $: EngineInterface,
  a: { tarefa?: string; cwd?: string; base?: string; modelo?: string; novos?: boolean; comando?: string[]; timeoutSegundos?: number; repetir?: boolean; incremental?: boolean },
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
  const tmp = await $.process.run(['mktemp', '-d', '-t', `${PREFIXO_TMP}XXXXXX`])
  const pasta = tmp.stdout.trim()
  if (tmp.exitCode !== 0 || !pasta.includes(PREFIXO_TMP)) return { texto: `Erro: não criei a pasta temporária (${tmp.stderr.trim()}).`, erro: true }
  const copia = `${pasta}/repo`
  try {
    const cp = await $.process.run(['cp', '-a', '--reflink=auto', `${raiz}/.`, copia], { timeoutMs: 600_000 })
    if (cp.exitCode !== 0) return { texto: `Erro: a cópia falhou (${cp.stderr.trim()}).`, erro: true }
    const naCopia = comandos.map(c => ({ ...c, argv: c.argv.map(x => x.replaceAll('{COPIA}', copia)) }))
    /** Os arquivos JS/TS/Python do repositório e quem importa quem; grande demais ou ilegível, nada. */
    const mapear = async () => {
      const ls = await git($, ['ls-files', '--cached', '--others', '--exclude-standard'], copia)
      if (ls.exitCode !== 0) return undefined
      const arquivos = [...new Set(ls.stdout.split('\n').filter(ehMapeavel))]
      if (!cabeNoMapa(arquivos.length)) return undefined
      const fontes = new Map<string, string>()
      for (const f of arquivos) {
        const t = await $.fs.read(`${copia}/${f}`).catch(() => undefined)
        if (typeof t === 'string') fontes.set(f, t)
      }
      return { g: grafo(fontes), testes: [...fontes.keys()].filter(ehEntradaDeTeste) }
    }
    const rodarUm = async (argv: string[]) =>
      $.process.run(argv, { cwd: copia, timeoutMs }).catch(err => ({
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

    const base = await rodar(naCopia)
    const lsTree = await git($, ['ls-tree', '-r', '-l', 'HEAD'], raiz)

    // O mapa da execução incremental: lido da cópia uma vez; sem ele, cada mutante roda a suíte inteira.
    const mapa = a.incremental === false || base.exitCode !== 0 ? undefined : await mapear()
    const escondidos = new Set<string>()
    /** Esconde na cópia os arquivos de teste fora de `quero`, renomeando; mexe só no que mudou desde a última vez. */
    const ajustar = async (quero: Set<string>) => {
      const mv = async (fs: string[], de: string, para: string) => {
        if (!fs.length) return
        const r = await $.process.run(['sh', '-c', `for f; do mv -- "$f${de}" "$f${para}"; done`, 'sh', ...fs], { cwd: copia })
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
    const exec: Execucao = {
      tarefa: a.tarefa.trim(),
      modelo: e.modelo,
      comando: naCopia.map(c => c.argv.join(' ').replaceAll(copia, '<cópia>')),
      enviados: e.enviados,
      excluidos: e.excluidos,
      naoCodigo: e.naoCodigo,
      avisoNovos: e.avisoNovos,
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
    }
    if (exec.linhaDeBase.passou) {
      let n = 0
      for (const m of e.mutantes) {
        n++
        const r: Resultado = { ...m, n, situacao: 'NÃO APLICADO', segundos: 0 }
        exec.resultados.push(r)
        const alvo = resolverArquivo(m.arquivo, e.enviados)
        if ('erro' in alvo) {
          r.motivo = alvo.erro
          continue
        }
        r.arquivo = alvo.arquivo
        // Sem comando que cubra o arquivo, "sobreviver" não diria nada: nem roda.
        const cobrem = comandosPara(alvo.arquivo, naCopia)
        if (!cobrem.length) {
          r.motivo = 'nenhum comando de teste cobre este arquivo'
          continue
        }
        const caminho = `${copia}/${alvo.arquivo}`
        const original = await $.fs.read(caminho)
        const ap = aplicarTrecho(original, m.linha, m.mutacao)
        if ('erro' in ap) {
          r.motivo = ap.erro
          continue
        }
        r.linhaReal = ap.linhaReal
        r.ocorrencias = ap.ocorrencias
        await $.fs.write(caminho, ap.texto)
        try {
          const plano = planoIncremental(alvo.arquivo, mapa, cobrem)
          r.escopo = plano.escopo
          let t: Awaited<ReturnType<typeof rodar>>
          if (plano.alcancam) {
            await ajustar(new Set(plano.alcancam))
            const inc = await rodar(plano.comandos)
            const saidaInc = inc.stdout + '\n' + inc.stderr
            // Morte só vale com um teste nomeado; sobrevivente, carga quebrada ou falha sem nome: a suíte inteira decide.
            const morteNomeada = inc.exitCode !== 0 && !invalido(saidaInc) && !/^código de saída/.test(quemMatou(saidaInc, inc.exitCode))
            if (morteNomeada) t = inc
            else {
              await todos()
              const cheia = await rodar(cobrem)
              r.escopo = `${plano.escopo}, ${inc.exitCode === 0 ? 'sobrevivente confirmado' : 'falha sem nome refeita'} na suíte inteira`
              t = { ...cheia, segundos: inc.segundos + cheia.segundos, testes: somarTestes(inc.testes, cheia.testes) }
            }
          } else {
            await todos()
            t = await rodar(cobrem)
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
    }
    // Os testes escondidos voltam antes de conferir a cópia; se um mv falhar, ajustar lança e a rodada não sai.
    await todos()
    exec.originalIntocado = (await git($, ['status', '--porcelain'], raiz)).stdout === statusAntes
    exec.segundos = (Date.now() - inicio) / 1000
    const c = contar(exec.resultados)
    const feita: ExecucaoFeita = {
      tarefa: exec.tarefa,
      ...c,
      estado: estadoDe(exec),
      estadoSeEquivalentes: estadoSeEquivalentes(exec),
      sobreviventesN: exec.resultados.filter(x => x.situacao === 'SOBREVIVENTE').map(x => x.n),
      quando: new Date().toISOString(),
      versao: await versaoDoMod($),
      // O diff mexe no próprio mod: a rodada mede o instrumento enquanto ele muda (v1.2: calibração).
      alteraInstrumento: tocaOInstrumento(raiz, e.enviados, $.plugin.root),
      custo: resumoCusto(exec),
    }
    await update($, execucao, () => feita)
    const texto = relatorio(exec, new Date().toISOString().slice(0, 10))
    const saidaBase = exec.linhaDeBase.saida ? `\n\nSaída da linha de base (fim):\n${exec.linhaDeBase.saida}` : ''
    return { texto: `${texto}${saidaBase}\n\nRegistre com ${TOOL_REGISTRAR}: aplicados ${c.aplicados}, mortos ${c.mortos}, sobreviventes ${c.sobreviventes}.`, erro: false }
  } finally {
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
