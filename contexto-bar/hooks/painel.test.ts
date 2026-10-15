import { expect, test } from 'claude-code/testing'

import { centralizar, centroIndicador, encurtar, nomeFerramenta, nomeModelo, textoAtividade, validarIndicadores } from './painel'

test('centralizar: largura exata, sobra à direita quando ímpar, corte com reticências', () => {
  expect(centralizar('ab', 6)).toBe('  ab  ')
  expect(centralizar('abc', 6)).toBe(' abc  ')
  expect(centralizar('pendências', 11)).toBe('pendências ')
  expect(centralizar('uma etiqueta longa', 11)).toBe('uma etique…')
  expect(centralizar('x', 11).length).toBe(11)
  // Na largura exata, inteiro (sobrevivente #4 da 0.13.0).
  expect(centralizar('abcdef', 6)).toBe('abcdef')
})

test('nome do modelo: id completo vira nome curto; data, contexto longo e alias ficam de fora ou como vieram', () => {
  expect(nomeModelo('claude-opus-5-5')).toBe('Opus 5.5')
  expect(nomeModelo('claude-fable-5-1')).toBe('Fable 5.1')
  expect(nomeModelo('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(nomeModelo('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
  expect(nomeModelo('claude-opus-4')).toBe('Opus 4')
  // Data logo depois da versão, sem a menor (sobrevivente #13 da 0.13.0).
  expect(nomeModelo('claude-opus-4-20250514')).toBe('Opus 4')
  expect(nomeModelo('opus')).toBe('opus')
  expect(nomeModelo('gpt-5-codex')).toBe('gpt-5-codex')
})

test('encurtar: cabe inteiro sem reticências; o corte guarda o resto para o hover e junta os espaços', () => {
  expect(encurtar('abc', 3)).toEqual({ curto: 'abc', resto: '' })
  expect(encurtar('abcdef', 4)).toEqual({ curto: 'abc…', resto: 'def' })
  expect(encurtar('  a   b\n c ', 10)).toEqual({ curto: 'a b c', resto: '' })
  const { curto, resto } = encurtar('x'.repeat(50), 20)
  expect(curto.length).toBe(20)
  expect(curto.slice(0, -1) + resto).toBe('x'.repeat(50))
})

test('atividade: vocabulário do herdr, ferramenta só quando trabalhando, MCP legível', () => {
  expect(textoAtividade(null)).toBe('ocioso')
  expect(textoAtividade({ estado: 'trabalhando', ferramenta: 'Bash', desde: 0 })).toBe('trabalhando · Bash')
  expect(textoAtividade({ estado: 'trabalhando', desde: 0 })).toBe('trabalhando')
  expect(textoAtividade({ estado: 'concluido', ferramenta: 'Bash', desde: 0 })).toBe('concluído')
  expect(textoAtividade({ estado: 'bloqueado', desde: 0 })).toBe('esperando você')
  expect(nomeFerramenta('mcp__prova-de-teste__executar')).toBe('prova-de-teste·executar')
  expect(nomeFerramenta('Read')).toBe('Read')
})

test('indicadores: só o que segue o contrato entra; um item ruim não derruba os outros', () => {
  expect(validarIndicadores(null)).toEqual([])
  // Outra versão do contrato fica de fora mesmo com itens válidos (sobrevivente M2 da 0.11.0).
  expect(validarIndicadores({ versao: 2, fonte: 'x', itens: [{ id: 'a', rotulo: 'A', valor: 1 }] })).toEqual([])
  expect(validarIndicadores({ versao: 1, itens: [] })).toEqual([])
  expect(validarIndicadores({ versao: 1, fonte: 'x', itens: 'não' })).toEqual([])
  const r = validarIndicadores({
    versao: 1,
    fonte: 'prova-de-teste',
    itens: [
      { id: 'exp-001', rotulo: 'EXP-001', valor: 28, meta: 10, unidade: 'medições', estado: 'ok', detalhe: 'promoção: 3/3' },
      { id: '', rotulo: 'sem id', valor: 1 },
      { id: 'a', rotulo: 'A', valor: 'três' },
      { id: 'b', rotulo: 'B', valor: Infinity },
      { id: 'c', rotulo: 'C', valor: 2, meta: 0, estado: 'péssimo' },
      null,
    ],
  })
  expect(r).toEqual([
    { fonte: 'prova-de-teste', id: 'exp-001', rotulo: 'EXP-001', valor: 28, meta: 10, unidade: 'medições', estado: 'ok', detalhe: 'promoção: 3/3' },
    { fonte: 'prova-de-teste', id: 'c', rotulo: 'C', valor: 2 },
  ])
})

test('indicador com texto: vai ao centro do gauge; sem ele, valor/meta ou o valor; texto vazio é ignorado', () => {
  const [i] = validarIndicadores({ versao: 1, fonte: 'p', itens: [{ id: 'a', rotulo: 'até provar', valor: 291, meta: 160, texto: ' 4,8 min ' }] })
  expect(i!.texto).toBe('4,8 min')
  expect(centroIndicador(i!)).toBe('4,8 min')
  expect(centroIndicador({ fonte: 'f', id: 'i', rotulo: 'r', valor: 28, meta: 10 })).toBe('28/10')
  expect(centroIndicador({ fonte: 'f', id: 'i', rotulo: 'r', valor: 3 })).toBe('3')
  const [v] = validarIndicadores({ versao: 1, fonte: 'p', itens: [{ id: 'a', rotulo: 'r', valor: 1, texto: '   ' }] })
  expect(v).not.toHaveProperty('texto')
})
