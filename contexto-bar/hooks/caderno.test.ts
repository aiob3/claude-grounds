import { expect, test } from 'claude-code/testing'

import { entrega, idade, INTERVALO_LEMBRETE, lembrete, lerCaderno, linha, novaNota, paraLembrar, pendenciaDoCaderno, PROPOSITO, semResposta, triagem } from './caderno'

const EM = '2026-10-15T21:30:05.123Z'

test('nota: #id no começo liga a uma pendência; sem ele, à próxima; texto vazio não vira nota', () => {
  expect(novaNota('  #12   rever   o contraste ', 'nota', EM, 'ab12', '#3')).toEqual({ v: 1, ev: 'nota', id: 'n-20261015213005-ab12', em: EM, autor: 'operador', tipo: 'nota', texto: 'rever o contraste', ref: '#12' })
  expect(novaNota('usar gauges', 'agora', EM, 'x', '#3')?.ref).toBe('#3')
  expect(novaNota('usar gauges', 'agora', EM, 'x')).not.toHaveProperty('ref')
  expect(novaNota('   ', 'nota', EM, 'x')).toBeNull()
  expect(novaNota('#7', 'nota', EM, 'x')).toBeNull()
  // "#7x" não é referência: só número inteiro seguido de espaço ou fim.
  expect(novaNota('#7x é um nome', 'nota', EM, 'x', '#3')?.ref).toBe('#3')
})

test('ler o caderno: a triagem mais recente vale, lixo e eventos desconhecidos são ignorados, tipo desconhecido (ou o antigo "ideia") vira nota', () => {
  const a = novaNota('primeira', 'depois', EM, 'a')!
  const b = novaNota('segunda', 'referencia', EM, 'b')!
  const texto = [
    linha(a),
    '{ quebrado',
    JSON.stringify({ v: 2, ev: 'reacao', id: a.id, emoji: '👍' }),
    linha(b),
    linha(triagem(a.id, 'aceita', 'boa', EM, '#9')),
    linha(triagem(a.id, 'muda-plano', 'melhor ainda', EM)),
    linha(triagem('n-inexistente', 'aceita', 'x', EM)),
    JSON.stringify({ v: 1, ev: 'triagem', id: b.id, decisao: 'talvez', motivo: 'x' }),
    JSON.stringify({ v: 1, ev: 'nota', id: a.id, texto: 'duplicada', tipo: 'ideia' }),
    JSON.stringify({ v: 3, ev: 'nota', id: 'n-futura', texto: 'de uma versão nova', tipo: 'hipotese', campoNovo: 1 }),
    JSON.stringify({ v: 1, ev: 'nota', id: 'n-antiga', texto: 'gravada antes da pesquisa', tipo: 'ideia' }),
    linha(triagem('n-antiga', 'recusada', 'fora do escopo', EM, undefined, 'pode voltar no roadmap')),
    JSON.stringify({ v: 0, ev: 'nota', id: 'n-zero', texto: 'versão inválida' }),
    '',
  ].join('\n')
  const notas = lerCaderno(texto)
  expect(notas.map(n => n.id)).toEqual([a.id, b.id, 'n-futura', 'n-antiga'])
  expect(notas[0]!.texto).toBe('primeira')
  expect(notas[0]!.triagem).toMatchObject({ decisao: 'muda-plano', motivo: 'melhor ainda' })
  expect(notas[0]!.triagem).not.toHaveProperty('destino')
  expect(notas[1]!.triagem).toBeUndefined()
  expect(notas[2]!.tipo).toBe('nota')
  expect(notas[3]!.tipo).toBe('nota')
  expect(notas[3]!.triagem?.contraponto).toBe('pode voltar no roadmap')
  expect(semResposta(notas).map(n => n.id)).toEqual([b.id, 'n-futura'])
})

test('entrega: idade, limite de autoridade e o propósito só quando pedido; a linha do pedido conta as sem resposta', () => {
  const agora = Date.parse(EM) + 3 * 60000
  const a = { ...novaNota('#4 e se usarmos abas nativas?', 'nota', EM, 'a')! }
  const primeira = entrega([a], true, agora)
  expect(primeira).toContain(`[caderno] Nota nova do operador: ${a.id} (nota, sobre #4, há 3 min): e se usarmos abas nativas?`)
  expect(primeira).toContain('não responde a pergunta sua nem vale como aprovação; salvo "agora", continue a tarefa atual.')
  expect(primeira).toContain(PROPOSITO)
  const depois = entrega([a, { ...a, id: 'n-2' }], false, agora)
  expect(depois).toContain('2 notas novas')
  expect(depois).not.toContain(PROPOSITO)
  expect(depois).toContain('Responda com acao "triar"')
  expect(entrega([], true, agora)).toBe('')
  expect(pendenciaDoCaderno([a])).toBe(' · caderno: 1 sem resposta')
  expect(pendenciaDoCaderno([{ ...a, triagem: triagem(a.id, 'registrada', 'ok', EM) }])).toBe('')
  // Destino e contraponto só de espaços não contam (sobrevivente #11 da 0.12.0).
  expect(triagem(a.id, 'aceita', ' ok ', EM, '   ', '  ')).toEqual({ v: 1, ev: 'triagem', id: a.id, em: EM, autor: 'claude', decisao: 'aceita', motivo: 'ok' })
  expect(triagem(a.id, 'aceita', 'ok', EM, ' #9 ', ' talvez cedo ')).toMatchObject({ destino: '#9', contraponto: 'talvez cedo' })
})

test('idade: menos de 1 min, minutos e horas; data ilegível não quebra', () => {
  const t = Date.parse(EM)
  expect(idade(EM, t + 59999)).toBe('agora há pouco')
  expect(idade(EM, t + 60000)).toBe('há 1 min')
  expect(idade(EM, t + 59 * 60000)).toBe('há 59 min')
  expect(idade(EM, t + 60 * 60000)).toBe('há 1 h')
  expect(idade('', t)).toBe('agora há pouco')
})

test('lembrete: só a entregue e sem resposta, depois do intervalo desde a última entrega; texto inteiro com o pedido de triagem', () => {
  const a = novaNota('olhar o contraste do painel', 'nota', EM, 'a')!
  const b = novaNota('#3 rever o rótulo', 'agora', EM, 'b')!
  const triada = { ...novaNota('já respondida', 'nota', EM, 'c')!, triagem: triagem('x', 'aceita', 'ok', EM) }
  const nao = novaNota('nunca entregue', 'nota', EM, 'd')!
  const ultima = { [a.id]: 2, [b.id]: 5, [triada.id]: 0 }
  expect(paraLembrar([a, b, triada, nao], ultima, 9).map(n => n.id)).toEqual([])
  expect(paraLembrar([a, b, triada, nao], ultima, 10).map(n => n.id)).toEqual([a.id])
  expect(paraLembrar([a, b, triada, nao], ultima, 13).map(n => n.id)).toEqual([a.id, b.id])
  expect(paraLembrar([a], { [a.id]: 2 }, 10, INTERVALO_LEMBRETE).length).toBe(1)
  expect(paraLembrar([a], { [a.id]: 3 }, 10, INTERVALO_LEMBRETE).length).toBe(0)
  const t = lembrete([a, b], Date.parse(EM) + 5 * 60000)
  expect(t).toContain('[caderno] Lembrete: 2 notas do operador seguem sem resposta:')
  expect(t).toContain(`${a.id} (nota, há 5 min): olhar o contraste do painel`)
  expect(t).toContain(`${b.id} (agora, sobre #3, há 5 min): rever o rótulo`)
  expect(t).toContain('triar cada uma com acao "triar"')
  expect(lembrete([a], Date.parse(EM))).toContain('Lembrete: 1 nota do operador segue sem resposta')
  expect(lembrete([], Date.parse(EM))).toBe('')
  expect(INTERVALO_LEMBRETE).toBe(8)
})
