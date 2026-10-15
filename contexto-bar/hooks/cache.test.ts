import { expect, test } from 'claude-code/testing'

import { CACHE_VAZIO, caminhoTranscript, doTranscript, somar, taxa } from './cache'

const resposta = (id: string, input: number, lidos: number, criados: number, extra: object = {}) =>
  JSON.stringify({
    type: 'assistant',
    ...extra,
    message: { id, usage: { input_tokens: input, cache_read_input_tokens: lidos, cache_creation_input_tokens: criados, output_tokens: 99 } },
  })

const transcript = [
  JSON.stringify({ type: 'user', message: { content: 'oi' } }),
  resposta('m1', 3, 0, 40000),
  resposta('m2', 2, 40000, 2000),
  resposta('m2', 2, 40000, 2000), // mesmo id: outro bloco da mesma resposta
  resposta('s1', 5, 0, 30000, { isSidechain: true }),
  JSON.stringify({ type: 'assistant', message: { id: 'sem-uso' } }),
  '{quebrada',
  resposta('m3', 1, 42000, 1000),
  '',
].join('\n')

test('cache: soma as respostas da conversa principal, uma vez por resposta', () => {
  const acc = doTranscript(transcript)
  expect(acc.n).toBe(3)
  expect(acc.lidos).toBe(82000)
  expect(acc.total).toBe(3 + 40000 + 2 + 40000 + 2000 + 1 + 42000 + 1000)
  expect(taxa(acc)).toBe(66)
})

test('cache: subagente, linha sem uso e linha quebrada não contam', () => {
  const so = (linha: string) => doTranscript(linha)
  expect(so(resposta('s1', 5, 10, 30000, { isSidechain: true }))).toEqual(CACHE_VAZIO)
  expect(so(JSON.stringify({ type: 'assistant', message: { id: 'x' } }))).toEqual(CACHE_VAZIO)
  expect(so(JSON.stringify({ type: 'user', message: { usage: { input_tokens: 5 } } }))).toEqual(CACHE_VAZIO)
  expect(so('{quebrada')).toEqual(CACHE_VAZIO)
  expect(so('null')).toEqual(CACHE_VAZIO)
})

test('cache: sem nada medido não há taxa', () => {
  expect(taxa(null)).toBe(null)
  expect(taxa(CACHE_VAZIO)).toBe(null)
  expect(taxa(somar(CACHE_VAZIO, { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }))).toBe(null)
  expect(somar(CACHE_VAZIO, undefined)).toEqual(CACHE_VAZIO)
  // Resposta com uso todo zero (interrompida) não conta como resposta (sobrevivente #5).
  expect(somar(CACHE_VAZIO, { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toEqual(CACHE_VAZIO)
})

test('cache: entrada sem uso não zera o que já foi somado; número infinito no JSON vale zero (sobreviventes #8 e #11)', () => {
  const acc = doTranscript(transcript)
  expect(somar(acc, undefined)).toEqual(acc)
  expect(somar(acc, null)).toEqual(acc)
  // JSON.parse('1e999') dá Infinity: não pode virar total infinito nem taxa NaN.
  const infinito = '{"type":"assistant","message":{"id":"inf","usage":{"input_tokens":1e999,"cache_read_input_tokens":900,"cache_creation_input_tokens":100}}}'
  const r = doTranscript(infinito)
  expect(r.total).toBe(1000)
  expect(taxa(r)).toBe(90)
})

test('cache: ler aos trechos dá o mesmo que ler tudo, e o uso de cada turno se soma por cima', () => {
  const linhas = transcript.split('\n')
  const inteiro = doTranscript(transcript)
  for (let corte = 0; corte <= linhas.length; corte++) {
    const aos = doTranscript(linhas.slice(corte).join('\n'), doTranscript(linhas.slice(0, corte).join('\n')))
    expect(aos).toEqual(inteiro)
  }
  const depois = somar(inteiro, { input_tokens: 10, cache_read_input_tokens: 90000, cache_creation_input_tokens: 0 })
  expect(depois.n).toBe(4)
  expect(depois.lidos).toBe(172000)
  expect(taxa(depois)).toBe(Math.round((172000 / (inteiro.total + 90010)) * 100))
})

test('cache: o caminho do transcript segue a pasta do projeto', () => {
  expect(caminhoTranscript('/home/u', '/home/u/Work', 'abc')).toBe('/home/u/.claude/projects/-home-u-Work/abc.jsonl')
  expect(caminhoTranscript('/home/u', '/data/a.b_c', 'id')).toBe('/home/u/.claude/projects/-data-a-b-c/id.jsonl')
})
