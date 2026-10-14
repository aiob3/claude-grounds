import type { Categoria, Mutante } from '../types'
import { CATEGORIAS, ehArquivoDeTeste } from './prova'

/** Uma mutação no formato `trecho original` → `trecho mutado` (aceita também ``a`` com crases duplas). */
export function lerMutacao(mutacao: string): { de: string; para: string } | null {
  return lerMutacoes(mutacao)[0] ?? null
}

/**
 * Todas as leituras possíveis da mutação: o trecho pode ter crase e seta por dentro, então cada
 * "` → `" é um ponto de corte candidato. Quem aplica fica com o maior original que existe no arquivo.
 */
export function lerMutacoes(mutacao: string): { de: string; para: string }[] {
  const t = mutacao.trim()
  const dupla = /^``\s(.+?)\s``\s*→\s*``\s(.*?)\s``$/.exec(t)
  if (dupla) return [{ de: dupla[1]!, para: dupla[2]! }]
  if (!t.startsWith('`') || !t.endsWith('`')) return []
  const miolo = t.slice(1, -1)
  const leituras: { de: string; para: string }[] = []
  for (const corte of miolo.matchAll(/`\s*→\s*`/g)) {
    const de = miolo.slice(0, corte.index)
    if (de) leituras.push({ de, para: miolo.slice(corte.index! + corte[0].length) })
  }
  return leituras
}

export type Aplicacao = { texto: string; linhaReal: number; ocorrencias: number }

/**
 * Aplica a mutação pelo trecho: o número de linha do escolhedor costuma errar, o trecho não.
 * Com mais de uma ocorrência, vale a mais próxima da linha indicada.
 */
export function aplicarTrecho(fonte: string, linha: number, mutacao: string): Aplicacao | { erro: string } {
  const leituras = lerMutacoes(mutacao)
  if (!leituras.length) return { erro: 'mutação fora do formato `original` → `mutado`' }
  // Um corte cedo demais também acha um prefixo no arquivo: vale o maior original que existe nele.
  const achadas = leituras.filter(l => fonte.includes(l.de)).sort((x, y) => y.de.length - x.de.length)
  const m = achadas[0] ?? leituras[0]!
  // Proteção dupla: buscar "" não termina nunca.
  if (!m.de) return { erro: 'mutação fora do formato `original` → `mutado`' }
  if (m.de === m.para) return { erro: 'mutação não muda nada' }
  const posicoes: number[] = []
  for (let i = fonte.indexOf(m.de); i !== -1; i = fonte.indexOf(m.de, i + 1)) posicoes.push(i)
  if (!posicoes.length) return { erro: 'trecho original não encontrado no arquivo' }
  const linhaDe = (i: number) => fonte.slice(0, i).split('\n').length
  const melhor = posicoes.reduce((a, b) => (Math.abs(linhaDe(b) - linha) < Math.abs(linhaDe(a) - linha) ? b : a))
  return {
    texto: fonte.slice(0, melhor) + m.para + fonte.slice(melhor + m.de.length),
    linhaReal: linhaDe(melhor),
    ocorrencias: posicoes.length,
  }
}

/**
 * O mutante quebrou o carregamento (sintaxe, tipos, import): é inválido, não conta como morto.
 * Só vale o erro na coluna 0, onde o carregador o escreve; o lançado dentro de um teste sai indentado
 * sob o nome do teste e é morte (um JSON.parse que falha não é arquivo que não carregou).
 */
export function invalido(saida: string): boolean {
  return erroDeCarga(saida) !== undefined
}

/** A primeira linha do erro de carga, para o relatório dizer por que o mutante não carregou. */
export function erroDeCarga(saida: string): string | undefined {
  const linhas = saida.split('\n')
  // Na coluna 0, como o claude plugin test escreve; o mesmo texto citado no código de um teste que falhou não vale.
  const i = linhas.findIndex(l => /^\(fail\) the file did not load/.test(l))
  if (i >= 0) return linhas.slice(i + 1).find(l => l.trim())?.trim() ?? 'the file did not load'
  return linhas.find(l => /^(?:SyntaxError|error TS\d{4}|Error: Cannot find module|ParseError)/.test(l))
}

/** O nome do teste que falhou, pelos formatos comuns; sem nenhum, o código de saída. */
export function quemMatou(saida: string, codigo: number): string {
  const padroes = [
    /^\s*\(fail\)\s+(.+?)(?:\s+\[[\d.]+m?s\])?\s*$/m, // claude plugin test, bun test
    /^\s*[✕×]\s+(.+?)(?:\s+\(\d+\s*m?s\))?\s*$/m, // jest, vitest
    /^\s*✖\s+(?!failing tests:)(.+?)(?:\s+\([\d.]+m?s\))?\s*$/m, // node --test (spec)
    /^\s*not ok \d+ - (.+?)\s*(?:#.*)?$/m, // node --test (tap)
    /^FAILED\s+(\S+)/m, // pytest
    /^\s*FAIL\s+(\S.*)$/m, // jest/vitest por arquivo
  ]
  for (const p of padroes) {
    const m = p.exec(saida)
    if (m) return m[1]!.trim()
  }
  return `código de saída ${codigo}`
}

export type ArquivosDoRepo = { pacote?: string; temPytest: boolean; pastasDePlugin: string[] }

/** Um comando de teste; `pasta` é o plugin que ele cobre ('' = a raiz; ausente = o repositório todo). */
export type Comando = { pasta?: string; argv: string[] }

/** Comandos de teste do repositório, a partir do que existe nele e do que o diff tocou. */
export function detectarComando(r: ArquivosDoRepo, tocados: string[], raiz: string): Comando[] {
  // Cada plugin do Claude Code tocado pelo diff roda os próprios testes; a pasta '' é o plugin na raiz.
  const plugins = r.pastasDePlugin.filter(p => tocados.some(t => p === '' || t === p || t.startsWith(`${p}/`)))
  if (plugins.length) return plugins.map(p => ({ pasta: p, argv: ['claude', 'plugin', 'test', p ? `${raiz}/${p}` : raiz] }))
  if (r.pacote) {
    try {
      const scripts = (JSON.parse(r.pacote) as { scripts?: Record<string, string> }).scripts
      if (scripts?.test && !/no test specified/.test(scripts.test)) return [{ argv: ['npm', 'test', '--silent'] }]
    } catch {
      // package.json inválido: segue para os outros.
    }
  }
  if (r.temPytest) return [{ argv: ['python3', '-m', 'pytest', '-q'] }]
  return []
}

/** Os comandos que valem para um arquivo: os do plugin onde ele está e os do repositório todo. */
export function comandosPara(arquivo: string, cs: Comando[]): Comando[] {
  return cs.filter(c => c.pasta === undefined || c.pasta === '' || arquivo.startsWith(`${c.pasta}/`))
}

export type Resultado = Mutante & {
  n: number
  linhaReal?: number
  ocorrencias?: number
  situacao: 'MORTO' | 'SOBREVIVENTE' | 'NÃO APLICADO'
  motivo?: string
  segundos: number
}

export type Execucao = {
  tarefa: string
  modelo: string
  comando: string[]
  enviados: string[]
  excluidos: string[]
  naoCodigo?: string[]
  avisoNovos?: string
  naoAplicaveis: string[]
  linhaDeBase: { passou: boolean; segundos: number; saida?: string }
  resultados: Resultado[]
  restauracao: 'cmp na cópia: idêntico' | 'cmp na cópia: DIFERENTE'
  originalIntocado: boolean
  segundos: number
}

export type Contagem = { aplicados: number; mortos: number; sobreviventes: number }

export function contar(rs: Resultado[]): Contagem {
  const aplicados = rs.filter(r => r.situacao !== 'NÃO APLICADO')
  return {
    aplicados: aplicados.length,
    mortos: aplicados.filter(r => r.situacao === 'MORTO').length,
    sobreviventes: aplicados.filter(r => r.situacao === 'SOBREVIVENTE').length,
  }
}

/** Categorias aplicáveis sem nenhum mutante aplicado (os não aplicados não contam). */
export function categoriasDescobertas(rs: Resultado[], naoAplicaveis: string[]): Exclude<Categoria, 'livre'>[] {
  return CATEGORIAS.filter(
    c => !rs.some(r => r.categoria === c && r.situacao !== 'NÃO APLICADO') && !naoAplicaveis.some(n => n.startsWith(`${c}:`)),
  )
}

export function concentracao(rs: Resultado[]): { maior: number; total: number; teste?: string; alerta: boolean } {
  const porTeste = new Map<string, number>()
  for (const r of rs) if (r.situacao === 'MORTO' && r.motivo) porTeste.set(r.motivo, (porTeste.get(r.motivo) ?? 0) + 1)
  const total = contar(rs).aplicados
  let maior = 0
  let teste: string | undefined
  for (const [t, n] of porTeste) if (n > maior) [maior, teste] = [n, t]
  return { maior, total, teste, alerta: total > 0 && maior * 2 > total }
}

export function estadoDe(e: Execucao): 'PROVADO' | 'FRACO' | 'NÃO VERIFICADO' {
  if (!e.linhaDeBase.passou || !e.originalIntocado || e.restauracao !== 'cmp na cópia: idêntico') return 'NÃO VERIFICADO'
  const c = contar(e.resultados)
  if (c.aplicados === 0) return 'NÃO VERIFICADO'
  if (c.sobreviventes > 0 || categoriasDescobertas(e.resultados, e.naoAplicaveis).length) return 'FRACO'
  return 'PROVADO'
}

const marca = (ok: boolean) => (ok ? '✔' : '✘')

/** O relatório no formato do protocolo v1.1, escrito pelo mod a partir do que ele executou. */
export function relatorio(e: Execucao, data: string): string {
  const c = contar(e.resultados)
  const conc = concentracao(e.resultados)
  const desc = categoriasDescobertas(e.resultados, e.naoAplicaveis)
  const est = estadoDe(e)
  const linhas = e.resultados.map(r => {
    const onde = `${r.arquivo}:${r.linha}${r.linhaReal && r.linhaReal !== r.linha ? ` (aplicado na ${r.linhaReal})` : ''}`
    const sit =
      r.situacao === 'MORTO'
        ? `MORTO por "${r.motivo}"`
        : r.situacao === 'SOBREVIVENTE'
          ? 'SOBREVIVENTE → reforçar ou justificar como equivalente'
          : `NÃO APLICADO: ${r.motivo}`
    return `  ${r.n} | ${onde} | ${r.categoria} | ${r.mutacao} | ${sit}`
  })
  return [
    `PROVA DE TESTE — ${e.tarefa} — ${data}  (executada pelo mod prova-de-teste)`,
    `Red first:  a cargo do agente (o mod não sabe qual é a linha central)`,
    `Escolha:    R2.1 às cegas por ${e.modelo} via $.model.complete; enviados: ${e.enviados.join(', ')}; testes retirados: ${e.excluidos.join(', ') || 'nenhum'}${e.naoCodigo?.length ? `; não-código fora do envio: ${e.naoCodigo.join(', ')}` : ''}`,
    e.avisoNovos ?? '',
    `Comando:    ${e.comando.join(' ; ')} — linha de base ${e.linhaDeBase.passou ? 'passou' : 'FALHOU'} (${e.linhaDeBase.segundos.toFixed(1)} s)`,
    `Mutantes:   ${c.aplicados} aplicados | ${c.mortos} mortos | ${c.sobreviventes} sobreviventes${e.resultados.length > c.aplicados ? ` | ${e.resultados.length - c.aplicados} não aplicados` : ''}`,
    ...linhas,
    `Categorias: ${CATEGORIAS.map(k => `${k} ${desc.includes(k) ? '✘' : e.naoAplicaveis.some(n => n.startsWith(`${k}:`)) ? 'n/a' : '✔'}`).join(' | ')}`,
    e.naoAplicaveis.length ? `n/a:        ${e.naoAplicaveis.join('; ')}` : '',
    `Concentração: ${conc.maior}/${conc.total}${conc.alerta ? ` ⚠ concentração em "${conc.teste}": aplique mais 1 mutante fora dessa área` : ''}`,
    `Restauração: ${e.restauracao}; original ${marca(e.originalIntocado)} ${e.originalIntocado ? 'intocado (git status igual antes e depois)' : 'ALTERADO'}`,
    `Tempo:      ${e.segundos.toFixed(1)} s`,
    `Estado:     ${est}${est === 'FRACO' ? ' (sobrevivente sem tratamento ou categoria descoberta: a tarefa não é Done)' : ''}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * O arquivo do diff a que o mutante se refere. O modelo às vezes devolve o caminho curto (`execucao.ts`):
 * vale se for sufixo de exatamente um arquivo enviado, numa fronteira de pasta.
 */
export function resolverArquivo(arquivo: string, enviados: string[]): { arquivo: string } | { erro: string } {
  if (!arquivo) return { erro: 'arquivo fora do diff enviado' }
  // `execucao.ts:hooks/execucao.ts`: o caminho veio repetido com dois-pontos; vale se os pedaços resolvem a um arquivo só.
  if (arquivo.includes(':') && !enviados.includes(arquivo)) {
    const achados = new Set(arquivo.split(':').map(p => resolverArquivo(p, enviados)).flatMap(r => ('arquivo' in r ? [r.arquivo] : [])))
    if (achados.size === 1) return { arquivo: [...achados][0]! }
    return { erro: achados.size ? `caminho ambíguo: ${[...achados].join(', ')}` : 'arquivo fora do diff enviado' }
  }
  if (enviados.includes(arquivo)) return { arquivo }
  // Curto (`execucao.ts`) ou com a pasta repetida na frente (`mod/mod/hooks/x.ts`), numa fronteira de pasta.
  const candidatos = enviados.filter(e => e.endsWith(`/${arquivo}`) || arquivo.endsWith(`/${e}`))
  if (candidatos.length === 1) return { arquivo: candidatos[0]! }
  if (candidatos.length > 1) return { erro: `caminho ambíguo: ${candidatos.join(', ')}` }
  return { erro: 'arquivo fora do diff enviado' }
}

/** Um caminho de arquivo tocado pelo diff que é teste não pode ser mutado: o mutante é sempre no código-fonte. */
export const mutavel = (arquivo: string) => !ehArquivoDeTeste(arquivo)

/** Divergência entre o que o agente quer registrar e o que o mod executou; nada quando batem. */
export function conferir(
  feita: { aplicados: number; mortos: number; sobreviventes: number; quando: string },
  r: { aplicados?: number; mortos?: number; sobreviventes?: number },
): string | undefined {
  const iguais = feita.aplicados === r.aplicados && feita.mortos === r.mortos && feita.sobreviventes === r.sobreviventes
  if (iguais) return undefined
  return (
    `os números não batem com a última execução do mod (${feita.aplicados}/${feita.mortos}/${feita.sobreviventes} em ${feita.quando}). ` +
    'Registre os números executados; um reforço exige executar de novo.'
  )
}
