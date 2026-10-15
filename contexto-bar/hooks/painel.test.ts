import { expect, test } from 'claude-code/testing'

import { encurtar, medidor, nomeFerramenta, sufixoIndicador, textoAtividade, validarIndicadores } from './painel'

test('medidor: largura exata; progresso acima de zero aparece, abaixo do total não enche', () => {
  for (const l of [1, 5, 20, 33]) {
    for (const [v, t] of [[0, 10], [1, 1000], [5, 10], [999, 1000], [10, 10], [28, 10], [-3, 10], [NaN, 10], [3, 0]] as const) {
      const b = medidor(v, t, l)
      expect(b.cheio.length + b.vazio.length).toBe(l)
    }
  }
  expect(medidor(0, 10, 10).cheio).toBe('')
  expect(medidor(1, 1000, 10).cheio).toBe('█')
  expect(medidor(999, 1000, 10).vazio).toBe('░')
  expect(medidor(10, 10, 10).vazio).toBe('')
  expect(medidor(28, 10, 10).cheio).toBe('█'.repeat(10))
  expect(medidor(5, 10, 10).cheio).toBe('█'.repeat(5))
  expect(medidor(3, 0, 4).cheio).toBe('')
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

test('sufixo do indicador: meta atingida leva ✓, abaixo não; sem meta, valor e unidade', () => {
  expect(sufixoIndicador({ fonte: 'f', id: 'i', rotulo: 'r', valor: 28, meta: 10 })).toBe('28/10 ✓')
  expect(sufixoIndicador({ fonte: 'f', id: 'i', rotulo: 'r', valor: 10, meta: 10 })).toBe('10/10 ✓')
  expect(sufixoIndicador({ fonte: 'f', id: 'i', rotulo: 'r', valor: 9, meta: 10 })).toBe('9/10')
  expect(sufixoIndicador({ fonte: 'f', id: 'i', rotulo: 'r', valor: 3, unidade: 'rodadas' })).toBe('3 rodadas')
  expect(sufixoIndicador({ fonte: 'f', id: 'i', rotulo: 'r', valor: 3 })).toBe('3')
})
