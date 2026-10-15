import type { Categoria, Mutante } from '../types'

export const VERSAO = '1.2'
/** O protocolo viaja com o instrumento: PROTOCOLO.md na pasta do mod. */
export const protocoloEm = (pastaDoMod: string) => `${pastaDoMod}/PROTOCOLO.md`
/** O log: PROVA_DE_TESTE_LOG, ou este caminho padrão (que pode ser um link para onde o log já vive). */
export const LOG_ENV = 'PROVA_DE_TESTE_LOG'
export const logPadrao = (home: string) => `${home}/.claude/prova-de-teste/EXP-001-log.md`
export const CABECALHO_LOG =
  '# EXP-001 — log\n\n' +
  `v${VERSAO}: \`<data> | <tarefa> | versão do protocolo | mutantes: aplicados/mortos/sobreviventes | reais: <n> | estado | tempo (s) | instrumento: <mod x.y.z | manual> | <medição | calibração: defeito> [| custo: base, por mutante, repositório, diff]\`\n\n`

export const CATEGORIAS: Exclude<Categoria, 'livre'>[] = ['borda/vazio', 'empate/ordem', 'null/inválido', 'condição invertida']

// Arquivos de teste pelas convenções comuns de JS/TS, Python, Go e Rust.
const TESTE = [
  /(^|\/)(tests?|__tests__|spec|specs)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.(py|go|rs)$/,
]

// Dentro da pasta de teste, helpers/support/utils são código que os testes usam (e podem ser a correção da tarefa);
// o nome de teste (.test., test_*.py...) ainda vale. Fixtures ficam como teste: trazem os valores esperados.
const HELPER = /(^|\/)(tests?|__tests__|spec|specs)\/(.+\/)?(helpers?|support|utils?)\//

export function ehArquivoDeTeste(caminho: string): boolean {
  const [pasta, ...nome] = TESTE
  if (nome.some(r => r.test(caminho))) return true
  return pasta!.test(caminho) && !HELPER.test(caminho)
}

// O que não é código não vai ao escolhedor: documentação, dotfiles de ferramenta, lockfiles, imagens.
const NAO_CODIGO = [
  /\.(md|mdx|markdown|txt|rst|adoc|lock|png|jpe?g|gif|webp|ico|svg|pdf)$/i,
  /(^|\/)\.(gitignore|gitattributes|editorconfig|npmrc|nvmrc|prettierrc|prettierignore|eslintignore|dockerignore)$/,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|LICENSE|CHANGELOG)$/,
  // Bytecode e cache do Python: os .pyc apagados do índice entravam no envio como código (rodada no publico, 0.8.2).
  /(^|\/)__pycache__\//,
  /\.py[co]$/,
]
export const ehNaoCodigo = (caminho: string) => NAO_CODIGO.some(r => r.test(caminho))

/** Bloco binário do git diff: não tem linha de texto que o escolhedor possa mutar. */
const ehBinario = (texto: string) => /^(Binary files .* differ|GIT binary patch)$/m.test(texto)

/** Aviso quando a maior parte do envio é de arquivos fora do git: pode ser código antigo nunca commitado, não a tarefa. */
export function avisoNovos(enviados: string[], novos: string[]): string {
  const fora = enviados.filter(f => novos.includes(f))
  if (fora.length * 2 <= enviados.length) return ''
  return `⚠ ${fora.length} de ${enviados.length} arquivos enviados estão fora do git (${fora.join(', ')}). Se forem código anterior à tarefa, commite-os ou rode com novos: false.`
}

/** Argumentos do /prova: o que parece caminho é a pasta do repositório; o resto é a base do diff. Repetido, vale o último. */
export function lerArgs(args: string, home: string): { base?: string; cwd?: string } {
  const r: { base?: string; cwd?: string } = {}
  for (const t of args.trim().split(/\s+/).filter(Boolean)) {
    // Sem HOME conhecido, o ~ fica como veio: melhor um erro claro do git que uma pasta trocada em silêncio.
    if (t === '~' || t.startsWith('~/')) r.cwd = home ? home + t.slice(1) : t
    else if (t.startsWith('/') || t.startsWith('./') || t.startsWith('../')) r.cwd = t
    else r.base = t
  }
  return r
}

export type BlocoDiff = { arquivo: string; texto: string }

/** Separa um `git diff` em blocos por arquivo. */
export function blocos(diff: string): BlocoDiff[] {
  const partes = diff.split(/^(?=diff --git )/m).filter(p => p.startsWith('diff --git '))
  return partes.map(texto => {
    // Prefere o caminho novo (+++ b/x); em arquivo apagado, o antigo.
    const novo = /^\+\+\+ b\/(.+)$/m.exec(texto)?.[1]
    const antigo = /^--- a\/(.+)$/m.exec(texto)?.[1]
    const cabecalho = /^diff --git a\/(.+?) b\/(.+)$/m.exec(texto)
    return { arquivo: novo ?? antigo ?? cabecalho?.[2] ?? '?', texto }
  })
}

/** O diff que vai ao modelo: só código-fonte; os testes e o que não é código saem e são listados à parte. */
export function separar(diff: string): { fonte: BlocoDiff[]; excluidos: string[]; naoCodigo: string[] } {
  const todos = blocos(diff)
  const testes = todos.filter(b => ehArquivoDeTeste(b.arquivo))
  const naoCodigo = todos.filter(b => !ehArquivoDeTeste(b.arquivo) && (ehNaoCodigo(b.arquivo) || ehBinario(b.texto)))
  return {
    fonte: todos.filter(b => !testes.includes(b) && !naoCodigo.includes(b)),
    excluidos: testes.map(b => b.arquivo),
    naoCodigo: naoCodigo.map(b => b.arquivo),
  }
}

export const SISTEMA = `Você escolhe mutantes para um teste de mutação manual (protocolo EXP-001 v${VERSAO}).
Você recebe SÓ o diff do código-fonte de uma tarefa. Você NÃO vê os testes, de propósito: escolha os bugs plausíveis que um teste precisaria pegar, não os que você imagina que ele pega.

Regras:
- Pelo menos 1 mutante por categoria que se aplique ao código alterado: ${CATEGORIAS.join(', ')}.
  - borda/vazio: lista vazia, tudo filtrado, limite < → <=, off-by-one.
  - empate/ordem: remover o desempate, inverter a ordem, ordenação não estável.
  - null/inválido: null ou undefined não cai no padrão; valor fora do domínio aceito.
  - condição invertida: if (x) → if (!x), filtro invertido.
- Pode somar mutantes da categoria "livre" (remover uma chamada, trocar uma string por ""), mas eles não substituem as categorias.
- Use o caminho COMPLETO do arquivo, exatamente como no cabeçalho \`+++ b/<caminho>\` do diff.
- Mute só linhas adicionadas ou alteradas no diff (linhas com +). Use o número da linha no arquivo NOVO, contado pelo cabeçalho @@ do hunk.
- Cada mutação descreve a troca exata: \`trecho original\` → \`trecho mutado\`.

Responda SÓ com linhas neste formato, uma por mutante, sem texto antes ou depois:
arquivo:linha | categoria | mutação
Para cada categoria que não se aplica, uma linha:
n/a | categoria | motivo`

export function montarPrompt(fonte: BlocoDiff[]): string {
  return `Diff do código-fonte (${fonte.length} arquivo(s)):\n\n${fonte.map(b => b.texto).join('\n')}`
}

const ehCategoria = (c: string): c is Categoria => (CATEGORIAS as string[]).includes(c) || c === 'livre'

/** Lê a resposta do modelo; linhas fora do formato são devolvidas à parte, para ninguém as perder de vista. */
export function lerResposta(texto: string): { mutantes: Mutante[]; naoAplicaveis: string[]; ignoradas: string[] } {
  const mutantes: Mutante[] = []
  const naoAplicaveis: string[] = []
  const ignoradas: string[] = []
  for (const bruta of texto.split('\n')) {
    const linha = bruta.trim().replace(/^[-*]\s+/, '')
    if (!linha) continue
    // Só os dois primeiros | separam campos: a mutação pode conter | (como em `||`).
    const [onde, cat, ...cauda] = linha.split('|')
    const resto = cauda.join('|').trim()
    const categoria = (cat ?? '').trim().toLowerCase()
    if (onde?.trim() === 'n/a' && ehCategoria(categoria) && resto) {
      naoAplicaveis.push(`${categoria}: ${resto}`)
      continue
    }
    const m = /^(.+):(\d+)$/.exec((onde ?? '').trim())
    if (!m || !ehCategoria(categoria) || !resto) {
      ignoradas.push(linha)
      continue
    }
    mutantes.push({ arquivo: m[1]!, linha: Number(m[2]), categoria, mutacao: resto })
  }
  return { mutantes, naoAplicaveis, ignoradas }
}

/** Categorias aplicáveis que ficaram sem mutante e sem justificativa. */
export function lacunas(mutantes: Mutante[], naoAplicaveis: string[]): string[] {
  return CATEGORIAS.filter(c => !mutantes.some(m => m.categoria === c) && !naoAplicaveis.some(n => n.startsWith(`${c}:`)))
}

export function tabela(mutantes: Mutante[]): string {
  return mutantes.map((m, i) => `  ${i + 1} | ${m.arquivo}:${m.linha} | ${m.categoria} | ${m.mutacao}`).join('\n')
}

export type Registro = {
  tarefa: string
  aplicados: number
  mortos: number
  sobreviventes: number
  reais: number
  estado: 'PROVADO' | 'PROVADO-PARCIAL' | 'FRACO' | 'NÃO VERIFICADO'
  tempo: number
  /** v1.2: o que executou a prova (`mod x.y.z` ou `manual v1.2`). */
  instrumento?: string
  /** v1.2: defeitos do instrumento nesta rodada; algum faz dela calibração, nenhum faz dela medição. */
  defeitos?: string[]
  /** Sobreviventes alegados como equivalentes, com o motivo: vão à linha do log, para quem audita. */
  equivalentes?: { n: number; motivo: string }[]
  /** 0.7.0: o custo medido pelo mod na execução (nunca informado pelo agente). */
  custo?: string
}

/**
 * v1.2: por que esta rodada calibra o instrumento em vez de medir o método. Vazio = medição.
 * O defeito informado pelo agente, o diff que mexe no próprio mod, e a versão que mudou entre executar e registrar.
 */
export function defeitosDoInstrumento(d: { informado?: string; alteraInstrumento?: boolean; versaoNaExecucao?: string; versaoAgora?: string }): string[] {
  const r: string[] = []
  if (d.informado?.trim()) r.push(d.informado.trim())
  if (d.alteraInstrumento) r.push('o diff altera o próprio instrumento')
  if (d.versaoNaExecucao && d.versaoAgora && d.versaoNaExecucao !== d.versaoAgora) r.push(`instrumento alterado na rodada: ${d.versaoNaExecucao}→${d.versaoAgora}`)
  return r
}

export const ESTADOS: Registro['estado'][] = ['PROVADO', 'PROVADO-PARCIAL', 'FRACO', 'NÃO VERIFICADO']

/** A versão em plugin.json; ilegível ou ausente, '?'. */
export function versaoDe(pluginJson: string): string {
  try {
    return String((JSON.parse(pluginJson) as { version?: unknown }).version ?? '?')
  } catch {
    return '?'
  }
}

/** O instrumento da linha: o mod na versão que executou; sem execução do mod, a rota manual (undefined). */
export const instrumentoDe = (feita: { versao?: string } | null | undefined) => (feita ? `mod ${feita.versao ?? '?'}` : undefined)

/** O nome no plugin.json; ilegível, nada. */
export function nomeDe(pluginJson: string): string | undefined {
  try {
    const nome = (JSON.parse(pluginJson) as { name?: unknown }).name
    return typeof nome === 'string' && nome ? nome : undefined
  } catch {
    return undefined
  }
}

/**
 * O diff mexe no próprio mod: arquivos sob a pasta dele, numa fronteira de pasta, ou sob um plugin com o nome dele,
 * onde quer que esteja (um clone do repositório dos mods em /tmp entrava como medição, 0.8.3).
 */
export const tocaOInstrumento = (raiz: string, enviados: string[], pastaDoMod: string, pluginsTocados: string[] = [], nomeDoMod = 'prova-de-teste') =>
  enviados.some(f => `${raiz}/${f}`.startsWith(`${pastaDoMod}/`)) || pluginsTocados.includes(nomeDoMod)

/** Valida o registro; devolve o erro ou a linha no formato v1.2 do log. */
export function linhaLog(r: Partial<Registro>, data: string): { linha?: string; erro?: string } {
  if (!r.tarefa?.trim()) return { erro: 'falta tarefa.' }
  const n = ['aplicados', 'mortos', 'sobreviventes', 'reais', 'tempo'] as const
  for (const k of n) {
    const v = r[k]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return { erro: `${k} precisa ser um número ≥ 0.` }
  }
  if (r.mortos! + r.sobreviventes! !== r.aplicados) return { erro: 'mortos + sobreviventes precisa dar aplicados.' }
  if (!ESTADOS.includes(r.estado as Registro['estado'])) return { erro: `estado precisa ser um de: ${ESTADOS.join(', ')}.` }
  const t = r.tarefa.trim().replace(/\s*\|\s*/g, ' / ')
  return {
    linha:
      `${data} | ${t} | v${VERSAO} | mutantes: ${r.aplicados}/${r.mortos}/${r.sobreviventes} | reais: ${r.reais} | ${r.estado} | ${r.tempo}` +
      ` | instrumento: ${r.instrumento ?? `manual v${VERSAO}`} | ${r.defeitos?.length ? `calibração: ${r.defeitos.join('; ').replace(/\s*\|\s*/g, ' / ')}` : 'medição'}` +
      (r.equivalentes?.length ? ` | equivalentes: ${r.equivalentes.map(q => `#${q.n} ${q.motivo.trim()}`).join('; ').replace(/\s*\|\s*/g, ' / ')}` : '') +
      (r.custo ? ` | custo: ${r.custo.replace(/\s*\|\s*/g, ' / ')}` : ''),
  }
}

/** Teto de tokens da resposta do escolhedor. Com 4000, a resposta era cortada antes da segunda categoria (0.8.4). */
export const LIMITE_ESCOLHA = 16000

/**
 * Resposta que bateu no teto: a última linha pode estar pela metade e sai (não vira mutante malformado),
 * e o aviso diz que pode faltar categoria.
 */
export function cortarResposta(texto: string, saida: number, limite: number): { texto: string; aviso?: string } {
  if (saida < limite) return { texto }
  const linhas = texto.replace(/\s+$/, '').split('\n')
  linhas.pop()
  return {
    texto: linhas.join('\n'),
    aviso: `⚠ Resposta do escolhedor cortada no teto de ${limite} tokens: a última linha saiu (podia estar pela metade) e pode faltar categoria. Acrescente mutantes nas categorias que faltarem.`,
  }
}
