/**
 * A checagem de tipos da linha de base (0.16.0, R12). O kit de teste do mod roda o TypeScript sem tipar: a 0.19.1 do
 * contexto-bar comparou `e.origin` (um objeto `{ kind }`) com 'person', o teste repetiu a suposição e a prova saiu
 * PROVADO com o Esc quebrado na sessão real. O `tsc` contra os tipos do motor pegava (TS2345). Vale só o erro NOVO:
 * o que o diff trouxe em relação à base; erro antigo do repositório não reprova a mudança de hoje.
 */

export type ErroDeTipo = { arquivo: string; linha?: number; codigo: string; mensagem: string }

/** O resultado da checagem: as pastas checadas, os erros novos e quantos já existiam na base. */
export type Tipos = { pastas: string[]; novos: ErroDeTipo[]; antigos: number; aviso?: string }

/**
 * Acha o compilador: o do repositório ($1), o do cache do npx ($2 = HOME) ou o do PATH. Imprime o caminho; nada se não há.
 * O do npx é o que o `npx tsc` deixou; sem rede, é o único que existe nesta máquina (16/10/2026).
 */
export const ACHAR_TSC =
  'for t in "$1"/node_modules/typescript/bin/tsc "$2"/.npm/_npx/*/node_modules/typescript/bin/tsc; do ' +
  '[ -f "$t" ] && { printf "%s\\n" "$t"; exit 0; }; done; command -v tsc || true'

/**
 * Volta a cópia ($PWD) à ref $1: o índice passa a ser o da base, os arquivos saem do índice e o que a base não tinha
 * sai (git clean sem -x: o ignorado, como o kit de tipos e o node_modules, fica). Só numa cópia com .git próprio.
 */
export const VOLTAR_A_BASE = 'git reset -q "$1" -- . && git checkout -q -f -- . && git clean -fdq -- .'

/** As linhas `arquivo(l,c): error TSnnnn: mensagem` do `tsc --pretty false`; `pasta` prefixa o arquivo (relativo à raiz). */
export function errosDeTipo(saida: string, pasta = ''): ErroDeTipo[] {
  const erros: ErroDeTipo[] = []
  for (const l of saida.split('\n')) {
    const m = /^(.*?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(l) ?? /^()error (TS\d+): (.*)$/.exec(l)
    if (!m) continue
    const comArquivo = m.length === 5
    const arquivo = m[1] ? `${pasta ? `${pasta}/` : ''}${m[1]}` : ''
    erros.push({ arquivo, ...(comArquivo ? { linha: Number(m[2]) } : {}), codigo: comArquivo ? m[3]! : m[2]!, mensagem: (comArquivo ? m[4]! : m[3]!).trim() })
  }
  return erros
}

/** A chave do erro sem a linha: o diff desloca as linhas, e o erro antigo continua sendo o mesmo. */
const chave = (e: ErroDeTipo) => `${e.arquivo}\0${e.codigo}\0${e.mensagem}`

/** Os erros de `agora` que a base não tinha, contando repetições (dois iguais onde havia um: um é novo). */
export function errosNovos(base: ErroDeTipo[], agora: ErroDeTipo[]): ErroDeTipo[] {
  const restam = new Map<string, number>()
  for (const e of base) restam.set(chave(e), (restam.get(chave(e)) ?? 0) + 1)
  return agora.filter(e => {
    const n = restam.get(chave(e)) ?? 0
    if (n > 0) restam.set(chave(e), n - 1)
    return n === 0
  })
}

/** As pastas a checar: as dos comandos (o plugin; '' = raiz) que têm tsconfig.json e algum .ts/.tsx tocado. */
export function pastasParaTipos(pastas: string[], comTsconfig: (pasta: string) => boolean, tocados: string[]): string[] {
  const ts = tocados.filter(t => /\.(c|m)?tsx?$/.test(t))
  return [...new Set(pastas)].filter(p => comTsconfig(p) && ts.some(t => p === '' || t.startsWith(`${p}/`)))
}

/** As linhas do relatório; nada quando não houve pasta a checar. */
export function linhaTipos(t: Tipos | undefined): string {
  if (!t) return ''
  const onde = t.pastas.map(p => p || '.').join(', ')
  const antigos = t.antigos ? `; ${t.antigos} já existia${t.antigos > 1 ? 'm' : ''} na base (não reprova)` : ''
  const n = t.novos.length
  const linhas =
    t.aviso && !n
      ? []
      : n
        ? [
            `Tipos:      tsc em ${onde}: ${n} erro${n > 1 ? 's' : ''} novo${n > 1 ? 's' : ''} → a linha de base reprova${antigos}`,
            ...t.novos.slice(0, 10).map(e => `  ${e.arquivo || '(projeto)'}${e.linha ? `:${e.linha}` : ''} ${e.codigo}: ${e.mensagem}`),
            ...(n > 10 ? [`  … e mais ${n - 10}`] : []),
          ]
        : [`Tipos:      tsc em ${onde}: nenhum erro novo${antigos}`]
  return [...linhas, ...(t.aviso ? [`${n ? '  ' : 'Tipos:      '}⚠ ${t.aviso}`] : [])].join('\n')
}
