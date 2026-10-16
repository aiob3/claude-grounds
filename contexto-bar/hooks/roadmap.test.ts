import { expect, test } from 'claude-code/testing'

import { destinoRoadmap, doHorizonte, faixaRoadmap, lembreteRoadmap, lerRoadmap, linha, novoItem, propostas, resumoRoadmap } from './roadmap'

const EM = '2026-10-16T01:02:03.456Z'

test('item: texto limpo, id pela hora, frente e origem só quando existem; texto vazio não vira item', () => {
  expect(novoItem('  terceiro   mod do herdr ', 'proximo', EM, 'ab', 'claude', ' herdr ', '#16')).toEqual({ v: 1, ev: 'item', id: 'r-20261016010203-ab', em: EM, autor: 'claude', texto: 'terceiro mod do herdr', horizonte: 'proximo', frente: 'herdr', de: '#16' })
  const sem = novoItem('abas', 'agora', EM, 'x', 'operador', '  ')!
  expect(sem).not.toHaveProperty('frente')
  expect(sem).not.toHaveProperty('de')
  expect(novoItem('   ', 'agora', EM, 'x', 'claude')).toBeNull()
})

test('ler: R pela ordem de entrada; mover, promover e descartar valem só para item aberto; lixo e versão nova não quebram', () => {
  const a = novoItem('um', 'agora', EM, 'a', 'claude', 'herdr')!
  const b = novoItem('dois', 'proximo', EM, 'b', 'claude')!
  const c = novoItem('três', 'depois', EM, 'c', 'claude')!
  const texto = [
    linha(a),
    '{ quebrado',
    linha(b),
    JSON.stringify({ v: 1, ev: 'item', id: a.id, texto: 'duplicado', horizonte: 'agora' }),
    linha(c),
    JSON.stringify({ v: 1, ev: 'mover', id: b.id, em: EM, horizonte: 'agora' }),
    JSON.stringify({ v: 1, ev: 'mover', id: c.id, em: EM, horizonte: 'amanha' }),
    JSON.stringify({ v: 1, ev: 'promover', id: a.id, em: EM, pendencia: 7 }),
    // Depois de promovido, nada mais muda o item.
    JSON.stringify({ v: 1, ev: 'descartar', id: a.id, em: EM, motivo: 'tarde demais' }),
    JSON.stringify({ v: 1, ev: 'descartar', id: c.id, em: EM, motivo: '  ' }),
    JSON.stringify({ v: 1, ev: 'promover', id: c.id, em: EM, pendencia: 'x' }),
    JSON.stringify({ v: 2, ev: 'item', id: 'r-novo', texto: 'de uma versão nova', horizonte: 'trimestre' }),
    JSON.stringify({ v: 0, ev: 'item', id: 'r-zero', texto: 'inválido', horizonte: 'agora' }),
    JSON.stringify({ v: 1, ev: 'item', id: 'r-vazio', texto: '  ', horizonte: 'agora' }),
    JSON.stringify({ v: 1, ev: 'nota', id: 'n-1', texto: 'do caderno' }),
    JSON.stringify({ v: 1, ev: 'mover', id: 'r-inexistente', horizonte: 'agora' }),
    '',
  ].join('\n')
  const itens = lerRoadmap(texto)
  expect(itens.map(i => [i.n, i.texto, i.horizonte, i.estado])).toEqual([
    [1, 'um', 'agora', 'promovido'],
    [2, 'dois', 'agora', 'aberto'],
    [3, 'três', 'depois', 'aberto'],
    [4, 'de uma versão nova', 'depois', 'aberto'],
  ])
  expect(itens[0]).toMatchObject({ pendencia: 7, frente: 'herdr' })
  expect(itens[0]).not.toHaveProperty('motivo')
  const d = lerRoadmap(linha(c) + JSON.stringify({ v: 1, ev: 'descartar', id: c.id, em: EM, motivo: 'fora do escopo' }))
  expect(d[0]).toMatchObject({ estado: 'descartado', motivo: 'fora do escopo' })
  expect(doHorizonte(itens, 'agora').map(i => i.n)).toEqual([2])
})

test('resumo: abertos por horizonte na ordem agora, próximo, depois; promovidos e descartados numa linha', () => {
  expect(resumoRoadmap([])).toBe('Roadmap vazio.')
  const evs = [
    novoItem('depois primeiro', 'depois', EM, 'a', 'claude')!,
    novoItem('agora', 'agora', EM, 'b', 'claude', 'herdr', '#3')!,
    novoItem('próximo', 'proximo', EM, 'c', 'claude')!,
    novoItem('vai', 'agora', EM, 'd', 'claude')!,
    novoItem('sai', 'agora', EM, 'e', 'claude')!,
  ]
  const texto = evs.map(linha).join('') + JSON.stringify({ v: 1, ev: 'promover', id: evs[3]!.id, em: EM, pendencia: 9 }) + '\n' + JSON.stringify({ v: 1, ev: 'descartar', id: evs[4]!.id, em: EM, motivo: 'm' })
  expect(resumoRoadmap(lerRoadmap(texto))).toBe(
    // O que veio do objetivo (de #3) nasce aprovado; o resto que o Claude escreveu é proposta (R18).
    ['Roadmap · 3 abertos', 'agora:', '  R2 [herdr] agora (de #3)', 'próximo:', '  R3 (proposta) próximo', 'depois:', '  R1 (proposta) depois primeiro', 'promovidos: R4→#9 · descartados: R5'].join('\n'),
  )
  // Sem nada saído, não há a última linha.
  expect(resumoRoadmap(lerRoadmap(linha(evs[2]!)))).toBe('Roadmap · 1 abertos\npróximo:\n  R1 (proposta) próximo')
})

test('lembrete na linha do pedido: só sem pendência a fazer; o aprovado em agora manda seguir, a proposta manda perguntar (R18)', () => {
  const ev = (texto: string, h: 'agora' | 'proximo', suf: string, autor: 'claude' | 'operador') => novoItem(texto, h, EM, suf, autor)!
  const itens = lerRoadmap([ev('a', 'agora', 'a', 'operador'), ev('b', 'proximo', 'b', 'operador'), ev('c', 'agora', 'c', 'operador')].map(linha).join(''))
  expect(lembreteRoadmap(itens, true)).toBe(' · roadmap em agora: R1, R3 (já aprovado: promova com a ferramenta roadmap, acao "promover", e siga neste turno, sem pedir licença)')
  expect(lembreteRoadmap(itens, false)).toBe('')
  expect(lembreteRoadmap(lerRoadmap(linha(ev('b', 'proximo', 'b', 'operador'))), true)).toBe('')
  // Proposta do Claude em agora: não é "já aprovado".
  const mistos = [ev('a', 'agora', 'a', 'operador'), ev('p', 'agora', 'p', 'claude')]
  expect(lembreteRoadmap(lerRoadmap(mistos.map(linha).join('')), true)).toBe(
    ' · roadmap em agora: R1 (já aprovado: promova com a ferramenta roadmap, acao "promover", e siga neste turno, sem pedir licença) · propostas em agora esperando o operador: R2 (não promova: pergunte pela AskUserQuestion)',
  )
  expect(lembreteRoadmap(lerRoadmap(linha(ev('p', 'agora', 'p', 'claude'))), true)).toBe(' · propostas em agora esperando o operador: R1 (não promova: pergunte pela AskUserQuestion)')
  // A proposta aprovada depois vira "já aprovado".
  const aprovada = linha(ev('p', 'agora', 'p', 'claude')) + JSON.stringify({ v: 1, ev: 'aprovar', id: ev('p', 'agora', 'p', 'claude').id, em: EM, por: 'operador' }) + '\n'
  expect(lembreteRoadmap(lerRoadmap(aprovada), true)).toContain('roadmap em agora: R1 (já aprovado')
})

test('aprovação ao ler (R18): autor operador ou vindo do objetivo nasce aprovado; aprovar vale só para o item aberto', () => {
  const p = novoItem('proposta', 'agora', EM, 'p', 'claude')!
  const op = novoItem('do operador', 'agora', EM, 'o', 'operador')!
  const obj = novoItem('do objetivo', 'agora', EM, 'j', 'claude', undefined, '#4')!
  const nota = novoItem('da nota', 'agora', EM, 'n', 'claude', undefined, 'n-123')!
  const [a, b, c, d] = lerRoadmap([p, op, obj, nota].map(linha).join(''))
  expect([a!.aprovado, b!.aprovado, c!.aprovado, d!.aprovado]).toEqual([false, true, true, false])
  expect([a!.autor, b!.autor]).toEqual(['claude', 'operador'])
  // Aprovar depois de descartar não reabre nem aprova.
  const t = linha(p) + JSON.stringify({ v: 1, ev: 'descartar', id: p.id, em: EM, motivo: 'm' }) + '\n' + JSON.stringify({ v: 1, ev: 'aprovar', id: p.id, em: EM, por: 'operador' }) + '\n'
  expect(lerRoadmap(t)[0]).toMatchObject({ estado: 'descartado', aprovado: false })
  expect(propostas(lerRoadmap([p, op].map(linha).join(''))).map(i => i.n)).toEqual([1])
  // Linha sem autor (ou com um que não se conhece) é do Claude e é proposta: nada passa por aprovado sem dizer.
  const semAutor = JSON.stringify({ v: 1, ev: 'item', id: 'r-1', em: EM, texto: 'velho', horizonte: 'agora' }) + '\n'
  const estranho = JSON.stringify({ v: 1, ev: 'item', id: 'r-2', em: EM, autor: 'sistema', texto: 'x', horizonte: 'agora' }) + '\n'
  expect(lerRoadmap(semAutor + estranho).map(i => [i.autor, i.aprovado])).toEqual([
    ['claude', false],
    ['claude', false],
  ])
})

test('destino da triagem: roadmap com ou sem horizonte; outro destino não é roadmap', () => {
  expect(destinoRoadmap('roadmap')).toBe('depois')
  expect(destinoRoadmap('Roadmap:agora')).toBe('agora')
  expect(destinoRoadmap('roadmap próximo')).toBe('proximo')
  expect(destinoRoadmap('roadmap/proximo')).toBe('proximo')
  expect(destinoRoadmap('roadmap trimestre')).toBe('depois')
  expect(destinoRoadmap('#12')).toBeNull()
  expect(destinoRoadmap('ver o roadmap')).toBeNull()
  expect(destinoRoadmap('roadmaps')).toBeNull()
  expect(destinoRoadmap(undefined)).toBeNull()
})

test('faixa sem objetivo: a próxima do plano é o primeiro item em agora, com as contagens; vazio diz que não há plano', () => {
  const a = novoItem('Fase 1 do herdr, mod só de leitura', 'agora', EM, 'a', 'claude', 'herdr')!
  const b = novoItem('abas', 'proximo', EM, 'b', 'claude')!
  const c = novoItem('acionamento', 'agora', EM, 'c', 'claude')!
  const itens = lerRoadmap([a, b, c].map(linha).join(''))
  expect(faixaRoadmap(itens, 200)).toBe('◎ sem objetivo ativo · roadmap: agora 2 · próximo 1 · depois 0 · próxima: R1 [herdr] Fase 1 do herdr, mod só de leitura')
  // Sem nada em agora, a próxima sai do próximo.
  const soProximo = lerRoadmap(linha(b))
  expect(faixaRoadmap(soProximo, 200)).toBe('◎ sem objetivo ativo · roadmap: agora 0 · próximo 1 · depois 0 · próxima: R1 abas')
  // Estreito: o texto da próxima é encurtado com reticências e a linha cabe na largura.
  const curta = faixaRoadmap(itens, 90)
  expect(curta.length).toBeLessThanOrEqual(90)
  expect(curta).toEndWith('…')
  expect(curta).toContain('próxima: R1')
  // Promovido e descartado não contam.
  const promovido = lerRoadmap([a, c].map(linha).join('') + JSON.stringify({ v: 1, ev: 'promover', id: a.id, em: EM, pendencia: 2 }) + '\n')
  expect(faixaRoadmap(promovido, 200)).toContain('agora 1 ·')
  expect(faixaRoadmap(promovido, 200)).toContain('próxima: R2 acionamento')
  // No limite: a próxima que cabe exata não é cortada; um caractere a menos corta com a reticência na última coluna.
  const exata = faixaRoadmap(itens, 200).length
  expect(faixaRoadmap(itens, exata)).toBe(faixaRoadmap(itens, 200))
  expect(faixaRoadmap(itens, exata - 1).length).toBe(exata - 1)
  expect(faixaRoadmap(itens, exata - 1)).toEndWith('leitu…')
  // Largura menor que o começo da linha: sobra ao menos a reticência.
  expect(faixaRoadmap(itens, 10)).toEndWith('R1 …')
  // Descartado não é a próxima nem conta.
  const descartado = lerRoadmap([a, c].map(linha).join('') + JSON.stringify({ v: 1, ev: 'descartar', id: a.id, em: EM, motivo: 'x' }) + '\n')
  expect(faixaRoadmap(descartado, 200)).toContain('agora 1 · próximo 0 · depois 0 · próxima: R2 acionamento')
  const soDescartado = lerRoadmap(linha(a) + JSON.stringify({ v: 1, ev: 'descartar', id: a.id, em: EM, motivo: 'x' }) + '\n')
  expect(faixaRoadmap(soDescartado, 200)).toContain('roadmap vazio')
  expect(faixaRoadmap([], 200)).toBe('◎ sem objetivo ativo · roadmap vazio: /objetivo texto :: passo que conclui')
})
