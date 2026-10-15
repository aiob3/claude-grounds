import { expect, test } from 'claude-code/testing'

import { classe, efetividade, indicadoresDeEfetividade, tarefas, vigentes } from './placar'

const med = (t: number, reais = 0, inst = 'mod 0.8.4') => `2026-10-15 | tarefa | v1.2 | mutantes: 5/5/0 | reais: ${reais} | PROVADO | ${t} | instrumento: ${inst} | medição`
const cal = (inst = 'mod 0.8.4') => `2026-10-15 | tarefa | v1.2 | mutantes: 5/4/1 | reais: 1 | FRACO | 30 | instrumento: ${inst} | calibração: defeito`

test('classe lê instrumento e tipo das linhas v1.2; v1.1 fica sem classe', () => {
  expect(classe(med(10))).toEqual({ instrumento: 'mod 0.8.4', tipo: 'medição' })
  expect(classe(cal())?.tipo).toBe('calibração')
  expect(classe('2026-10-14 | antiga | v1.1 | 5/5/0 | 0 | PROVADO | 20')).toBeUndefined()
})

test('a CORREÇÃO tira a última linha classificada antes dela, não a anterior sem classe', () => {
  const v = vigentes([med(10), '2026-10-14 | sem classe', '2026-10-15 | CORREÇÃO da linha anterior | v1.2 | mutantes: 5/5/0 | reais: 0 | PROVADO | 10 | instrumento: mod 0.8.4 | calibração: x'])
  expect(v.length).toBe(2)
  expect(v[0]).toBe('2026-10-14 | sem classe')
})

const linha = (nome: string, a: number, m: number, estado: string, t: number | string, tipo = 'medição') =>
  `2026-10-15 | ${nome}: detalhe | v1.2 | mutantes: ${a}/${m}/${a - m} | reais: ${a - m} | ${estado} | ${t} | instrumento: mod 0.9.1 | ${tipo}`

test('tarefas: rodadas do mesmo nome até o PROVADO, mesmo intercaladas com outra sessão; a 1ª lista é a da primeira rodada', () => {
  const log = [
    '# cabeçalho',
    linha('contexto-bar 0.12.0', 15, 14, 'FRACO', 85, 'calibração: x'),
    linha('legibility', 12, 7, 'FRACO', 477),
    linha('contexto-bar 0.12.0', 20, 18, 'FRACO', 112.6),
    linha('legibility', 12, 12, 'PROVADO', 346),
    linha('contexto-bar 0.12.0', 20, 20, 'PROVADO', 74.6),
    linha('contexto-bar 0.12.0', 23, 19, 'FRACO', 145.8),
    '2026-10-14 | antiga | v1.1 | 5/5/0 | 0 | PROVADO | 20',
    linha('contexto-bar 0.12.0', 23, 22, 'PROVADO', '—'),
  ].join('\n')
  expect(tarefas(log)).toEqual([
    { nome: 'contexto-bar 0.12.0', rodadas: 3, aplicados1: 15, mortos1: 14, tempo: 85 + 112.6 + 74.6, provada: true },
    { nome: 'legibility', rodadas: 2, aplicados1: 12, mortos1: 7, tempo: 823, provada: true },
    { nome: 'contexto-bar 0.12.0', rodadas: 2, aplicados1: 23, mortos1: 19, tempo: 145.8, provada: true },
  ])
  // A CORREÇÃO tira a linha anterior e não vira rodada.
  const corr = [linha('a', 10, 5, 'FRACO', 10), `2026-10-15 | CORREÇÃO da linha anterior | v1.2 | mutantes: 10/5/5 | reais: 5 | FRACO | 10 | instrumento: mod 0.9.1 | medição`, linha('a', 10, 10, 'PROVADO', 5)].join('\n')
  expect(tarefas(corr)).toEqual([{ nome: 'a', rodadas: 1, aplicados1: 10, mortos1: 10, tempo: 5, provada: true }])
})

test('efetividade: últimas 5 provadas contra as 5 anteriores; a aberta não conta; sem anteriores, sem comparação', () => {
  const t = (n: number, m: number, tempo: number) => [linha(`t${n}`, 10, m, 'FRACO', tempo), linha(`t${n}`, 10, 10, 'PROVADO', tempo)].join('\n')
  const antigas = [1, 2, 3, 4, 5].map(n => t(n, 5, 100))
  const novas = [6, 7, 8, 9, 10].map(n => t(n, 8, 50))
  const aberta = linha('t11', 10, 0, 'FRACO', 999)
  const e = efetividade([...antigas, ...novas, aberta].join('\n'))
  expect(e).toEqual({ n: 5, primeira: 0.8, primeiraAntes: 0.5, tempo: 100, tempoAntes: 200, rodadas: 2, rodadasAntes: 2 })
  const so = efetividade(novas.slice(0, 3).join('\n'))
  expect(so).toMatchObject({ n: 3, primeira: 0.8, primeiraAntes: null, tempoAntes: null })
  expect(efetividade('# vazio\n')).toEqual({ n: 0, primeira: null, primeiraAntes: null, tempo: null, tempoAntes: null, rodadas: null, rodadasAntes: null })
  // Uma tarefa só já conta (sobrevivente #1 da 0.10.0).
  expect(efetividade(t(1, 7, 30))).toMatchObject({ n: 1, primeira: 0.7, tempo: 60, rodadas: 2 })
  // 1ª lista sem nenhum mutante aplicado: sem fração, nunca NaN (sobrevivente #2).
  expect(efetividade([linha('z', 0, 0, 'PROVADO', 5)].join('\n')).primeira).toBeNull()
  // Linha classificada sem contagem de mutantes (reclassificação) não derruba nem vira rodada (sobrevivente #11).
  const recl = '2026-10-14 | t1: RECLASSIFICAÇÃO | v1.2 | — | — | — | — | instrumento: manual v1.1 | medição'
  expect(tarefas([recl, t(1, 7, 30)].join('\n'))).toEqual([{ nome: 't1', rodadas: 2, aplicados1: 10, mortos1: 7, tempo: 60, provada: true }])
})

test('indicadores: 1ª passada e até provar no contrato do contexto-bar; estado pela comparação com as anteriores', () => {
  const e = { n: 5, primeira: 0.83, primeiraAntes: 0.9, tempo: 291, tempoAntes: 160, rodadas: 2, rodadasAntes: 1.6 }
  const j = JSON.parse(indicadoresDeEfetividade(e))
  expect(j.versao).toBe(1)
  expect(j.fonte).toBe('prova-de-teste')
  expect(j.itens[0]).toEqual({
    id: 'primeira-passada', rotulo: '1ª passada', valor: 83, meta: 100, unidade: '%', texto: '83%', estado: 'atencao',
    detalhe: 'mutantes que os testes já matam na 1ª lista às cegas, últimas 5 tarefas: 83% (antes 90%) · rodadas até provar 2,0 (antes 1,6)',
  })
  expect(j.itens[1]).toEqual({
    id: 'ate-provar', rotulo: 'até provar', valor: 291, meta: 160, unidade: 's', texto: '4,8 min', estado: 'atencao',
    detalhe: 'tempo das rodadas até o PROVADO, média das últimas 5 tarefas: 4,8 min (antes 2,7 min, +82%)',
  })
  // Melhorou: ok; empate na 1ª passada também é ok; tempo igual é ok.
  const melhor = JSON.parse(indicadoresDeEfetividade({ ...e, primeira: 0.9, tempo: 160 }))
  expect(melhor.itens.map((i: { estado: string }) => i.estado)).toEqual(['ok', 'ok'])
  expect(melhor.itens[1].detalhe).toContain('(antes 2,7 min, 0%)')
  const caiu = JSON.parse(indicadoresDeEfetividade({ ...e, tempo: 120 }))
  expect(caiu.itens[1].detalhe).toContain('-25%')
  // Sem anteriores: sem meta no tempo e sem comparação; sem dados: nenhum item.
  const so = JSON.parse(indicadoresDeEfetividade({ ...e, primeiraAntes: null, tempoAntes: null, rodadasAntes: null }))
  expect(so.itens[1]).not.toHaveProperty('meta')
  expect(so.itens.map((i: { estado: string }) => i.estado)).toEqual(['ok', 'ok'])
  expect(so.itens[0].detalhe).not.toContain('(antes')
  expect(JSON.parse(indicadoresDeEfetividade({ n: 0, primeira: null, primeiraAntes: null, tempo: null, tempoAntes: null, rodadas: null, rodadasAntes: null })).itens).toEqual([])
})
