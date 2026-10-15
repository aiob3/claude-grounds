import { expect, test } from 'claude-code/testing'

import { classe, criterios, indicadorDoPlacar, placar, vigentes } from './placar'

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

test('placar: conta medições, calibrações, reais, tempo médio e estabilidade como o gerador', () => {
  const log = ['# cabeçalho', 'v1.2: `<data> | ...`', med(100, 2), med(50), cal(), med(30, 1, 'mod 0.8.5'), med(60, 0, 'mod 0.8.5'), med(90, 1, 'mod 0.8.5'), ''].join('\n')
  const p = placar(log)
  expect(p).toEqual({ medicoes: 5, calibracoes: 1, comReais: 3, tempoMedio: 66, estavel: true, seguidas: 3, versao: 'mod 0.8.5' })
  expect(criterios(p).atendidos).toBe(3)
  // Calibração depois zera a sequência; duas seguidas não bastam.
  expect(placar([log, cal('mod 0.8.5'), med(10, 0, 'mod 0.8.5'), med(10, 0, 'mod 0.8.5')].join('\n')).estavel).toBe(false)
  // Linha de reclassificação sem tempo não entra na média.
  expect(placar(`2026-10-14 | RECLASSIFICAÇÃO | v1.2 | — | — | — | — | instrumento: manual v1.1 | medição\n${med(40)}`).tempoMedio).toBe(40)
})

test('critérios: tempo de 2 min exatos e só 2 medições com reais não promovem', () => {
  const base = { medicoes: 12, calibracoes: 0, comReais: 3, tempoMedio: 119, estavel: true, seguidas: 3, versao: 'v' }
  expect(criterios(base).atendidos).toBe(3)
  expect(criterios({ ...base, tempoMedio: 120 }).atendidos).toBe(2)
  expect(criterios({ ...base, tempoMedio: null }).atendidos).toBe(2)
  expect(criterios({ ...base, comReais: 2 }).atendidos).toBe(2)
  expect(criterios({ ...base, estavel: false }).atendidos).toBe(2)
})

test('indicador: segue o contrato do contexto-bar; ok só com a meta e os 3 critérios', () => {
  const p = { medicoes: 28, calibracoes: 27, comReais: 19, tempoMedio: 117.5, estavel: true, seguidas: 8, versao: 'mod 0.8.4' }
  const j = JSON.parse(indicadorDoPlacar(p))
  expect(j).toEqual({
    versao: 1,
    fonte: 'prova-de-teste',
    itens: [{ id: 'exp-001', rotulo: 'EXP-001', valor: 28, meta: 10, unidade: 'medições', estado: 'ok', detalhe: 'promoção: 3/3 critérios (reais em 19 medições, tempo médio 118 s, estável em mod 0.8.4) · 27 calibrações' }],
  })
  expect(JSON.parse(indicadorDoPlacar({ ...p, medicoes: 9 })).itens[0].estado).toBe('atencao')
  expect(JSON.parse(indicadorDoPlacar({ ...p, estavel: false, seguidas: 1 })).itens[0].detalhe).toContain('2/3 critérios')
  expect(JSON.parse(indicadorDoPlacar({ ...p, estavel: false, seguidas: 1 })).itens[0].detalhe).toContain('instável (1 de 3 seguidas)')
  expect(JSON.parse(indicadorDoPlacar({ ...p, tempoMedio: null })).itens[0].detalhe).toContain('sem tempo')
})

test('placar: as bordas do gerador (sobreviventes da rodada da 0.9.0)', () => {
  // #3: tempo 0 entra na média, como no float() do gerador; "—" não.
  expect(placar([med(0), med(30)].join('\n')).tempoMedio).toBe(15)
  // #6: sem nenhuma medição com tempo, a média é null (não NaN).
  expect(placar('# só cabeçalho\n').tempoMedio).toBeNull()
  expect(placar(cal()).tempoMedio).toBeNull()
  // #12: linha de medição sem o campo reais não conta como achado.
  expect(placar('2026-10-14 | RECLASSIFICAÇÃO | v1.2 | — | — | — | — | instrumento: manual v1.1 | medição').comReais).toBe(0)
  // #13: linha sem classe (v1.1) no meio não quebra a sequência da mesma versão.
  expect(placar([med(1), '2026-10-14 | antiga | v1.1 | 5/5/0 | 0 | PROVADO | 20', med(1), med(1)].join('\n')).estavel).toBe(true)
})

test('vigentes: com duas classificadas antes, a CORREÇÃO tira a mais recente (sobrevivente #7 da rodada da 0.9.0)', () => {
  const v = vigentes([med(1), med(2), '2026-10-15 | CORREÇÃO da linha anterior | v1.2 | mutantes: 5/5/0 | reais: 0 | PROVADO | 3 | instrumento: mod 0.8.4 | calibração: x'])
  expect(v.map(l => l.split('|')[6]!.trim())).toEqual(['1', '3'])
})

test('indicador: a meta exata já é ok (sobrevivente #5 da rodada da 0.9.0)', () => {
  const p = { medicoes: 10, calibracoes: 0, comReais: 3, tempoMedio: 60, estavel: true, seguidas: 3, versao: 'v' }
  expect(JSON.parse(indicadorDoPlacar(p)).itens[0].estado).toBe('ok')
})
