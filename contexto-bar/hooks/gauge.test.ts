import { expect, test } from 'claude-code/testing'

import { estiloDoTerminal, gauge, LARGURA_GAUGE, LINHAS_GAUGE, pedacos } from './gauge'

const cheios = (g: ReturnType<typeof gauge>) => g.flat().filter(c => c.cheio === true).length
const arco = (g: ReturnType<typeof gauge>) => g.flat().filter(c => c.cheio !== null).length
const texto = (g: ReturnType<typeof gauge>) => g.map(l => l.map(c => c.ch).join(''))

test('gauge: 11 por 3 nos dois estilos; vazio em 0, cheio em 1, nunca diminui quando o valor sobe', () => {
  for (const estilo of ['braille', 'caixa'] as const) {
    const g0 = gauge(0, '0%', estilo)
    expect(g0.length).toBe(LINHAS_GAUGE)
    for (const l of g0) expect(l.length).toBe(LARGURA_GAUGE)
    expect(cheios(g0)).toBe(0)
    expect(cheios(gauge(1, '', estilo))).toBe(arco(gauge(1, '', estilo)))
    let antes = 0
    for (let f = 0; f <= 1.0001; f += 0.05) {
      const n = cheios(gauge(f, '', estilo))
      expect(n >= antes).toBe(true)
      antes = n
    }
    // Fora de 0..1, NaN e infinito: borda mais próxima ou vazio.
    expect(cheios(gauge(-2, '', estilo))).toBe(0)
    expect(cheios(gauge(Number.NaN, '', estilo))).toBe(0)
    expect(cheios(gauge(Number.POSITIVE_INFINITY, '', estilo))).toBe(0)
    expect(cheios(gauge(3, '', estilo))).toBe(arco(gauge(1, '', estilo)))
    // Algum progresso sempre acende algo; abaixo do total, algo fica apagado.
    expect(cheios(gauge(0.06, '', estilo)) > 0).toBe(true)
    expect(cheios(gauge(0.94, '', estilo)) < arco(gauge(0.94, '', estilo))).toBe(true)
  }
})

test('gauge caixa: os 11 segmentos no lugar, acesos da esquerda para a direita, número centrado na base', () => {
  expect(texto(gauge(0.5, '47%', 'caixa'))).toEqual(['  ╭─────╮  ', ' ╱       ╲ ', '│   47%   │'])
  const g = gauge(0.5, '47%', 'caixa')
  // round(0,5 × 11) = 6: │ ╱ ╭ ─ ─ ─ acesos; o resto, trilha.
  expect(g[2]![0]!.cheio).toBe(true)
  expect(g[1]![1]!.cheio).toBe(true)
  expect(g[0]!.slice(2, 6).every(c => c.cheio)).toBe(true)
  expect(g[0]![6]!.cheio).toBe(false)
  expect(g[2]![10]!.cheio).toBe(false)
  expect(texto(gauge(0, '5/17', 'caixa'))[2]).toBe('│  5/17   │')
  // Número maior que o meio é cortado com reticências e não invade o arco.
  expect(texto(gauge(0, '1234567890', 'caixa'))[2]).toBe('│ 123456… │')
  // Exatamente 7 colunas cabem inteiras (sobrevivente #3 da 0.13.0).
  expect(texto(gauge(0, '1234567', 'caixa'))[2]).toBe('│ 1234567 │')
})

test('gauge braille: só pontos braille no arco, o meio da base livre para o número, arco simétrico', () => {
  const g = gauge(0, '99%', 'braille')
  for (const c of g.flat()) if (c.cheio !== null) expect(c.ch.charCodeAt(0) >= 0x2801 && c.ch.charCodeAt(0) <= 0x28ff).toBe(true)
  expect(texto(g)[2]!.slice(2, 9)).toBe('  99%  ')
  for (const l of g) for (let c = 0; c < LARGURA_GAUGE; c++) expect(l[c]!.cheio === null).toBe(l[LARGURA_GAUGE - 1 - c]!.cheio === null)
  // Metade acende a metade esquerda do arco.
  const meio = gauge(0.5, '', 'braille')
  expect(meio[2]![0]!.cheio).toBe(true)
  expect(meio[2]![10]!.cheio).toBe(false)
})

test('estilo pelo terminal: Kitty, Ghostty e foot desenham braille; o resto, caixa; a variável força', () => {
  expect(estiloDoTerminal({ kitty: '1', term: 'xterm-256color' })).toBe('braille')
  expect(estiloDoTerminal({ term: 'xterm-kitty' })).toBe('braille')
  expect(estiloDoTerminal({ term: 'foot' })).toBe('braille')
  expect(estiloDoTerminal({ termProgram: 'ghostty' })).toBe('braille')
  expect(estiloDoTerminal({ termProgram: 'WezTerm' })).toBe('braille')
  expect(estiloDoTerminal({ term: 'alacritty' })).toBe('caixa')
  expect(estiloDoTerminal({})).toBe('caixa')
  expect(estiloDoTerminal({ forcado: 'caixa', kitty: '1' })).toBe('caixa')
  expect(estiloDoTerminal({ forcado: 'braille', term: 'alacritty' })).toBe('braille')
  expect(estiloDoTerminal({ forcado: 'outro', term: 'alacritty' })).toBe('caixa')
})

test('pedaços: vizinhos no mesmo estado viram um texto só', () => {
  expect(pedacos([{ ch: 'a', cheio: true }, { ch: 'b', cheio: true }, { ch: ' ', cheio: null }, { ch: 'c', cheio: false }, { ch: 'd', cheio: false }])).toEqual([
    { texto: 'ab', cheio: true },
    { texto: ' ', cheio: null },
    { texto: 'cd', cheio: false },
  ])
  expect(pedacos([])).toEqual([])
})
