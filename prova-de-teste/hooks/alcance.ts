/**
 * Execução incremental: que arquivos de teste alcançam o arquivo mutado, pelo grafo de imports.
 * O mapa só decide a velocidade, nunca o veredito: quem usa isto confirma sobrevivente na suíte inteira.
 */

const JS = /\.(?:[cm]?[jt]sx?)$/
const PY = /\.py$/
const EXTENSOES_JS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']

/** O arquivo de teste que o executor descobre pelo nome; helpers e fixtures da pasta de teste ficam de fora. */
export function ehEntradaDeTeste(caminho: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(caminho) || /(^|\/)test_[^/]+\.py$/.test(caminho) || /(^|\/)[^/]+_test\.py$/.test(caminho)
}

export const ehMapeavel = (caminho: string) => JS.test(caminho) || PY.test(caminho)

const pasta = (p: string) => p.slice(0, p.lastIndexOf('/') + 1)

/** `a/b/../c/./d` → `a/c/d`; subir acima da raiz devolve nada. */
export function normalizar(p: string): string | undefined {
  const r: string[] = []
  for (const s of p.split('/')) {
    if (s === '' || s === '.') continue
    if (s === '..') {
      if (!r.length) return undefined
      r.pop()
    } else r.push(s)
  }
  return r.join('/')
}

/** Os especificadores de um arquivo JS/TS: import, export from, require e import(). Pacotes entram e não resolvem. */
export function especificadoresJs(fonte: string): string[] {
  const r = new Set<string>()
  const padroes = [
    /\b(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const p of padroes) for (const m of fonte.matchAll(p)) r.add(m[1]!)
  return [...r]
}

/**
 * Um alias de import, válido para os arquivos sob `escopo` (a pasta do tsconfig ou do vite.config; '' = a raiz).
 * Com `curinga` (`@/*`), `de` é prefixo e o resto do especificador vai depois de `para`; sem, só vale o nome exato.
 */
export type Alias = { escopo: string; de: string; para: string; curinga: boolean }

/** Os aliases dos `paths` de um tsconfig, relativos ao baseUrl (ou à pasta dele). Lidos por regex: tsconfig aceita comentário. */
export function aliasesDeTsconfig(caminho: string, texto: string): Alias[] {
  const dir = pasta(caminho)
  const bloco = /"paths"\s*:\s*\{([^}]*)\}/.exec(texto)?.[1]
  if (!bloco) return []
  const baseUrl = /"baseUrl"\s*:\s*"([^"]*)"/.exec(texto)?.[1] ?? '.'
  const raiz = normalizar(dir + baseUrl)
  if (raiz === undefined) return []
  const r: Alias[] = []
  for (const m of bloco.matchAll(/"([^"]+)"\s*:\s*\[\s*"([^"]+)"/g)) {
    const [chave, alvo] = [m[1]!, m[2]!]
    const curinga = chave.endsWith('*') && alvo.endsWith('*')
    const prefixo = curinga ? alvo.slice(0, -1) : alvo
    const para = normalizar(`${raiz}/${prefixo}`)
    if (para === undefined) continue
    // `src/*` e `*` substituem uma pasta (a barra volta depois de normalizar); `lib*` é prefixo de nome, sem barra.
    const pasta_ = curinga && (prefixo === '' || prefixo.endsWith('/'))
    r.push({ escopo: dir, de: curinga ? chave.slice(0, -1) : chave, para: pasta_ && para ? `${para}/` : para, curinga })
  }
  return r
}

/** Os aliases de um vite.config/vitest.config na forma `'@': path.resolve(__dirname, 'src')`. */
export function aliasesDeVite(caminho: string, texto: string): Alias[] {
  const dir = pasta(caminho)
  const r: Alias[] = []
  for (const m of texto.matchAll(/['"]([^'"]+)['"]\s*:\s*path\.resolve\(\s*__dirname\s*,\s*['"]([^'"]+)['"]\s*\)/g)) {
    const para = normalizar(dir + m[2]!)
    if (para === undefined) continue
    // `@` vale como `@` exato e como prefixo `@/`.
    r.push({ escopo: dir, de: m[1]!, para, curinga: false }, { escopo: dir, de: `${m[1]!}/`, para: para ? `${para}/` : '', curinga: true })
  }
  return r
}

export const ehConfigDeAlias = (caminho: string) => /(^|\/)(tsconfig[^/]*\.json|vite(st)?\.config\.[cm]?[jt]s)$/.test(caminho)

/** Os aliases de um arquivo de configuração, pelo nome. */
export const aliasesDe = (caminho: string, texto: string) => (caminho.endsWith('.json') ? aliasesDeTsconfig(caminho, texto) : aliasesDeVite(caminho, texto))

/** Onde um especificador com alias aponta, pelos aliases que valem para `de`: o escopo mais fundo vence. */
function porAlias(de: string, spec: string, aliases: Alias[]): string[] {
  const valem = aliases.filter(a => de.startsWith(a.escopo) && (a.curinga ? spec.startsWith(a.de) : spec === a.de))
  if (!valem.length) return []
  const fundo = Math.max(...valem.map(a => a.escopo.length))
  return valem.filter(a => a.escopo.length === fundo).map(a => a.para + spec.slice(a.de.length))
}

/** O arquivo do repositório que um especificador nomeia (relativo ou por alias); `./x.js` também acha `x.ts` (ESM com TypeScript). */
export function resolverJs(de: string, spec: string, arquivos: Set<string>, aliases: Alias[] = []): string | undefined {
  if (!spec.startsWith('.')) {
    for (const alvo of porAlias(de, spec, aliases)) {
      const achado = resolverJs('', `./${alvo}`, arquivos)
      if (achado) return achado
    }
    return undefined
  }
  const base = normalizar(pasta(de) + spec)
  if (base === undefined) return undefined
  const semJs = base.replace(/\.[cm]?jsx?$/, '')
  const candidatos = [base, ...EXTENSOES_JS.map(x => semJs + x), ...EXTENSOES_JS.map(x => `${base}/index${x}`)]
  return candidatos.find(c => arquivos.has(c))
}

/** Os módulos que um arquivo Python importa, como caminhos candidatos (relativos e absolutos). */
export function importsPy(de: string, fonte: string, arquivos: Set<string>): string[] {
  const r = new Set<string>()
  const modulo = (pontos: string, nome: string): string[] => {
    const partes = nome ? nome.split('.') : []
    if (pontos) {
      // `from .. import x`: um ponto é a pasta do arquivo; cada ponto a mais sobe uma.
      let dir = pasta(de).replace(/\/$/, '')
      for (let i = 1; i < pontos.length; i++) dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''
      return [[dir, ...partes].filter(Boolean).join('/')]
    }
    // Absoluto: a partir da raiz, de src/ e da pasta do arquivo.
    return ['', 'src/', pasta(de)].map(p => p + partes.join('/'))
  }
  const achar = (m: string) => [`${m}.py`, `${m}/__init__.py`].find(c => arquivos.has(c))
  for (const l of fonte.split('\n')) {
    const de_ = /^\s*from\s+(\.*)([\w.]*)\s+import\s+\(?([\w\s,*]+)/.exec(l)
    if (de_) {
      for (const m of modulo(de_[1]!, de_[2]!)) {
        const a = achar(m)
        if (a) r.add(a)
        // `from pacote import modulo`: o nome importado pode ser um submódulo.
        for (const nome of de_[3]!.split(',').map(s => s.trim().split(/\s+/)[0]!).filter(n => n && n !== '*')) {
          const sub = achar(m ? `${m}/${nome}` : nome)
          if (sub) r.add(sub)
        }
      }
      continue
    }
    const imp = /^\s*import\s+([\w.,\s]+)/.exec(l)
    if (imp)
      for (const nome of imp[1]!.split(',').map(s => s.trim().split(/\s+/)[0]!).filter(Boolean)) {
        // `import a.b.c` carrega a, a.b e a.b.c.
        const partes = nome.split('.')
        for (let i = 1; i <= partes.length; i++)
          for (const m of modulo('', partes.slice(0, i).join('.'))) {
            const a = achar(m)
            if (a) r.add(a)
          }
      }
  }
  return [...r]
}

/** O que cada arquivo importa, dentro do repositório. */
export function grafo(fontes: Map<string, string>, aliases: Alias[] = []): Map<string, string[]> {
  const arquivos = new Set(fontes.keys())
  const g = new Map<string, string[]>()
  for (const [arq, fonte] of fontes) {
    if (JS.test(arq)) g.set(arq, especificadoresJs(fonte).flatMap(s => resolverJs(arq, s, arquivos, aliases) ?? []))
    else if (PY.test(arq)) g.set(arq, importsPy(arq, fonte, arquivos))
  }
  return g
}

/** Os arquivos de teste que chegam ao alvo seguindo imports, em qualquer profundidade; o próprio alvo, se for teste. */
export function testesQueAlcancam(alvo: string, g: Map<string, string[]>): string[] {
  // Grafo reverso: quem importa cada arquivo.
  const quem = new Map<string, string[]>()
  for (const [de, para] of g) for (const p of para) quem.set(p, [...(quem.get(p) ?? []), de])
  const vistos = new Set([alvo])
  const fila = [alvo]
  while (fila.length) for (const q of quem.get(fila.shift()!) ?? []) if (!vistos.has(q)) (vistos.add(q), fila.push(q))
  return [...vistos].filter(ehEntradaDeTeste).sort()
}

export const SUFIXO_FORA = '.prova-fora'

/** Acima disso, ler cada arquivo para o mapa custaria mais do que poupa. */
export const LIMITE_MAPA = 20_000
export const cabeNoMapa = (arquivos: number) => arquivos <= LIMITE_MAPA
