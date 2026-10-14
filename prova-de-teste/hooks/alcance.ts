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

/** Os especificadores relativos de um arquivo JS/TS: import, export from, require e import(). */
export function especificadoresJs(fonte: string): string[] {
  const r = new Set<string>()
  const padroes = [
    /\b(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const p of padroes) for (const m of fonte.matchAll(p)) if (m[1]!.startsWith('.')) r.add(m[1]!)
  return [...r]
}

/** O arquivo do repositório que um especificador relativo nomeia; `./x.js` também acha `x.ts` (ESM com TypeScript). */
export function resolverJs(de: string, spec: string, arquivos: Set<string>): string | undefined {
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
export function grafo(fontes: Map<string, string>): Map<string, string[]> {
  const arquivos = new Set(fontes.keys())
  const g = new Map<string, string[]>()
  for (const [arq, fonte] of fontes) {
    if (JS.test(arq)) g.set(arq, especificadoresJs(fonte).flatMap(s => resolverJs(arq, s, arquivos) ?? []))
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
