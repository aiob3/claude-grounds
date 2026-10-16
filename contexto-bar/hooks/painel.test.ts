import { expect, test } from 'claude-code/testing'

import { centralizar, centroIndicador, encurtar, nomeFerramenta, nomeModelo, textoAtividade, validarIndicadores, validarVizinhos, faixaVizinhos, estadoDoHerdr, validarAoVivo, linhaAoVivo } from './painel'

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

test('vizinhos do herdr: só o que segue o contrato; versão ou fonte errada não entra; agente sem pane fica de fora', () => {
  const ok = { versao: 1, fonte: 'herdr', em: 'x', workspace: 'w1', vizinhos: [
    { workspace: 'w2', rotulo: 'motor', estado: 'blocked', agentes: [{ pane: 'w2:p1', estado: 'blocked', titulo: 'Retomada' }, { estado: 'idle' }] },
    { workspace: 'w3', rotulo: '', estado: 'idle', agentes: [] },
    { workspace: 'w4', rotulo: 'novo', estado: 'outro', agentes: 'não é lista' },
    'lixo',
  ] }
  expect(validarVizinhos(ok)).toEqual([
    { workspace: 'w2', rotulo: 'motor', estado: 'blocked', agentes: [{ pane: 'w2:p1', estado: 'blocked', titulo: 'Retomada' }] },
    { workspace: 'w3', rotulo: 'w3', estado: 'idle', agentes: [] },
    { workspace: 'w4', rotulo: 'novo', estado: 'unknown', agentes: [] },
  ])
  expect(validarVizinhos({ ...ok, versao: 2 })).toEqual([])
  expect(validarVizinhos({ ...ok, fonte: 'outro' })).toEqual([])
  expect(validarVizinhos({ ...ok, vizinhos: {} })).toEqual([])
  expect(validarVizinhos(null)).toEqual([])
  expect(validarVizinhos({ ...ok, vizinhos: [{ rotulo: 'sem id', estado: 'idle', agentes: [] }] })).toEqual([])
  // Id vazio não é workspace; estado de agente fora do vocabulário vira unknown (sobreviventes #3 e #7).
  expect(validarVizinhos({ ...ok, vizinhos: [{ workspace: '', rotulo: 'x', estado: 'idle', agentes: [] }] })).toEqual([])
  expect(validarVizinhos({ ...ok, vizinhos: [{ workspace: 'w2', rotulo: 'x', estado: 'idle', agentes: [{ pane: 'p', estado: 'outro', titulo: 't' }] }] })[0]!.agentes).toEqual([{ pane: 'p', estado: 'unknown', titulo: 't' }])
})

test('vizinhos na faixa: só quem espera o operador ou terminou; o vocabulário do herdr vira o do painel', () => {
  const v = (rotulo: string, estado: string) => ({ workspace: rotulo, rotulo, estado: estado as never, agentes: [] })
  expect(faixaVizinhos([v('a', 'working'), v('b', 'idle')])).toBe('')
  expect(faixaVizinhos([v('motor', 'blocked'), v('site', 'done'), v('c', 'working')])).toBe('◆ motor esperando você · ✔ site terminou')
  expect(estadoDoHerdr('idle')).toBe('ocioso')
  expect(estadoDoHerdr('working')).toBe('trabalhando')
  expect(estadoDoHerdr('blocked')).toBe('bloqueado')
  expect(estadoDoHerdr('done')).toBe('concluido')
  expect(estadoDoHerdr('unknown')).toBe('ocioso')
})

test('ao vivo: só o contrato do prova-de-teste; a linha mostra a fase, a barra dos feitos e o estado no fim', () => {
  const v = { versao: 1, fonte: 'prova-de-teste', tarefa: 't', fase: 'mutantes', total: 10, feitos: 5, mortos: 4, sobreviventes: 1, naoAplicados: 0, inicio: 1000, agora: 31000, copias: 8 }
  expect(validarAoVivo(v)).toEqual({ tarefa: 't', fase: 'mutantes', total: 10, feitos: 5, mortos: 4, sobreviventes: 1, naoAplicados: 0, inicio: 1000, agora: 31000, copias: 8 })
  expect(validarAoVivo({ ...v, versao: 2 })).toBeNull()
  expect(validarAoVivo({ ...v, fonte: 'outro' })).toBeNull()
  expect(validarAoVivo({ ...v, fase: 'outra' })).toBeNull()
  expect(validarAoVivo({ ...v, tarefa: 3 })).toBeNull()
  expect(validarAoVivo({ ...v, feitos: -1 })).toBeNull()
  expect(validarAoVivo({ ...v, total: Number.NaN })).toBeNull()
  expect(validarAoVivo(null)).toBeNull()
  expect(validarAoVivo({ ...v, copias: 'x', estado: '' })).toStrictEqual({ tarefa: 't', fase: 'mutantes', total: 10, feitos: 5, mortos: 4, sobreviventes: 1, naoAplicados: 0, inicio: 1000, agora: 31000 })
  const r = validarAoVivo(v)!
  // Largo: a barra para em 20, metade cheia; mais estreito, ocupa o que sobra do texto.
  expect(linhaAoVivo(r, 100)).toBe('[■■■■■■■■■■··········] 5/10 · 4 mortos · 1 sobreviventes · 8 cópias · 30 s')
  // 1 de 3 em 20 colunas: 6,67 arredonda para 7 (sobrevivente #3).
  expect(linhaAoVivo({ ...r, feitos: 1, total: 3 }, 100).startsWith('[■■■■■■■·')).toBe(true)
  expect(linhaAoVivo(r, 60)).toBe('[■■■···] 5/10 · 4 mortos · 1 sobreviventes · 8 cópias · 30 s')
  expect(linhaAoVivo({ ...r, copias: 1 }, 60)).not.toContain('cópias')
  expect(linhaAoVivo({ ...r, fase: 'base' }, 60)).toBe('linha de base · 10 mutantes na fila · 30 s')
  expect(linhaAoVivo({ ...r, fase: 'fim', estado: 'PROVADO', naoAplicados: 2 }, 60)).toBe('PROVADO · 4 mortos · 1 sobreviventes · 2 não aplicados · 30 s')
  expect(linhaAoVivo({ ...r, fase: 'fim' }, 60)).toBe('fim · 4 mortos · 1 sobreviventes · 30 s')
  // Estreito: a barra não some (4 no mínimo); sem total, vazia.
  expect(linhaAoVivo(r, 10).startsWith('[■■··]')).toBe(true)
  expect(linhaAoVivo({ ...r, total: 0, feitos: 0 }, 60).startsWith('[····')).toBe(true)
  expect(linhaAoVivo({ ...r, agora: 500 }, 60)).toContain(' · 0 s')
})
