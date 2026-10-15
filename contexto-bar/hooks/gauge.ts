// Gauges em arco para o painel: 11 colunas por 3 linhas, o número no meio da linha de baixo.
// Dois desenhos. Braille (2×4 pontos por célula, ~30 posições no arco) onde o terminal desenha braille por código
// (Kitty, Ghostty, foot); caixa (11 segmentos ╭─╮ ╱╲ │) em qualquer outro, inclusive Alacritty e tmux antigo.
// Cada célula tem uma cor só: a do trecho cheio ou a da trilha. Pesquisa de 15/10/2026 (publico/pesquisas).

export const LARGURA_GAUGE = 11
export const LINHAS_GAUGE = 3
export type EstiloGauge = 'braille' | 'caixa'
/** Uma célula do arco: o caractere e se está no trecho cheio (`true`), na trilha (`false`) ou vazia (`null`). */
export type Celula = { ch: string; cheio: boolean | null }

const MEIO = { de: 2, ate: 8 } // colunas livres na linha de baixo, onde vai o número

/** Braille pelo terminal: Kitty, Ghostty e foot desenham por código; o resto cai na caixa. Variável força. */
export function estiloDoTerminal(env: { forcado?: string; kitty?: string; term?: string; termProgram?: string }): EstiloGauge {
  if (env.forcado === 'braille' || env.forcado === 'caixa') return env.forcado
  if (env.kitty) return 'braille'
  if (/kitty|ghostty|foot/i.test(env.term ?? '') || /ghostty|wezterm/i.test(env.termProgram ?? '')) return 'braille'
  return 'caixa'
}

const BIT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]

/** O arco braille: semicírculo de raio ~10 pontos com centro na base, 2 pontos de espessura. */
function arcoBraille(frac: number): Celula[][] {
  const W = LARGURA_GAUGE * 2
  const H = LINHAS_GAUGE * 4
  const cx = (W - 1) / 2
  const cy = H - 0.5
  const bits: number[][] = Array.from({ length: LINHAS_GAUGE }, () => Array(LARGURA_GAUGE).fill(0))
  const somaT: number[][] = Array.from({ length: LINHAS_GAUGE }, () => Array(LARGURA_GAUGE).fill(0))
  const pontos: number[][] = Array.from({ length: LINHAS_GAUGE }, () => Array(LARGURA_GAUGE).fill(0))
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx
      const dy = cy - y
      const r = Math.hypot(dx, dy)
      if (r < 8.6 || r > 10.6) continue
      const t = 1 - Math.atan2(dy, dx) / Math.PI // 0 na esquerda, 1 na direita, passando pelo topo
      const lin = y >> 2
      const col = x >> 1
      bits[lin]![col]! |= BIT[y % 4]![x % 2]!
      somaT[lin]![col]! += t
      pontos[lin]![col]!++
    }
  }
  return bits.map((linha, l) =>
    linha.map((b, c) => (b ? { ch: String.fromCharCode(0x2800 + b), cheio: frac > 0 && somaT[l]![c]! / pontos[l]![c]! <= frac } : { ch: ' ', cheio: null })),
  )
}

// A caixa: 11 segmentos na ordem do arco, da esquerda para a direita.
const SEGMENTOS: [number, number, string][] = [
  [2, 0, '│'],
  [1, 1, '╱'],
  [0, 2, '╭'],
  [0, 3, '─'],
  [0, 4, '─'],
  [0, 5, '─'],
  [0, 6, '─'],
  [0, 7, '─'],
  [0, 8, '╮'],
  [1, 9, '╲'],
  [2, 10, '│'],
]

function arcoCaixa(frac: number): Celula[][] {
  const grade: Celula[][] = Array.from({ length: LINHAS_GAUGE }, () => Array.from({ length: LARGURA_GAUGE }, () => ({ ch: ' ', cheio: null })))
  const acesos = Math.round(frac * SEGMENTOS.length)
  SEGMENTOS.forEach(([l, c, ch], i) => {
    grade[l]![c] = { ch, cheio: i < acesos }
  })
  return grade
}

/**
 * O gauge inteiro: o arco com o número centrado nas colunas livres da linha de baixo. `frac` vai a 0..1
 * (valores fora, NaN e infinito ficam na borda mais próxima, ou vazios).
 */
export function gauge(frac: number, centro: string, estilo: EstiloGauge): Celula[][] {
  const f = Number.isFinite(frac) ? Math.min(1, Math.max(0, frac)) : 0
  const grade = estilo === 'braille' ? arcoBraille(f) : arcoCaixa(f)
  const espaco = MEIO.ate - MEIO.de + 1
  const txt = centro.length > espaco ? `${centro.slice(0, espaco - 1)}…` : centro
  const inicio = MEIO.de + Math.floor((espaco - txt.length) / 2)
  ;[...txt].forEach((ch, i) => {
    grade[LINHAS_GAUGE - 1]![inicio + i] = { ch, cheio: null }
  })
  return grade
}

/** Junta células vizinhas do mesmo estado em pedaços, para desenhar cada linha com poucas cores. */
export function pedacos(linha: Celula[]): { texto: string; cheio: boolean | null }[] {
  const r: { texto: string; cheio: boolean | null }[] = []
  for (const c of linha) {
    const ult = r[r.length - 1]
    if (ult && ult.cheio === c.cheio) ult.texto += c.ch
    else r.push({ texto: c.ch, cheio: c.cheio })
  }
  return r
}
