import { expect, test } from 'claude-code/testing'

import { errosDeTipo, errosNovos, linhaTipos, pastasParaTipos } from './tipos'

const SAIDA = [
  "hooks/register.tsx(1011,29): error TS2345: Argument of type '{ readonly kind: \"person\"; }' is not assignable to parameter of type 'string'.",
  "  Types of property 'origin' are incompatible.",
  "hooks/register.tsx(780,12): error TS2339: Property 'agentId' does not exist on type 'Ctx'.",
  'error TS5083: Cannot read file tsconfig.base.json.',
  'Found 3 errors.',
].join('\n')

test('errosDeTipo lê arquivo, linha, código e mensagem; a continuação e o resumo ficam de fora; a pasta prefixa o arquivo', () => {
  expect(errosDeTipo(SAIDA, 'contexto-bar')).toEqual([
    { arquivo: 'contexto-bar/hooks/register.tsx', linha: 1011, codigo: 'TS2345', mensagem: "Argument of type '{ readonly kind: \"person\"; }' is not assignable to parameter of type 'string'." },
    { arquivo: 'contexto-bar/hooks/register.tsx', linha: 780, codigo: 'TS2339', mensagem: "Property 'agentId' does not exist on type 'Ctx'." },
    { arquivo: '', codigo: 'TS5083', mensagem: 'Cannot read file tsconfig.base.json.' },
  ])
  expect(errosDeTipo(SAIDA)[0]!.arquivo).toBe('hooks/register.tsx')
  expect(errosDeTipo('')).toEqual([])
})

test('errosNovos ignora a linha (o diff desloca) e conta repetições: dois iguais onde havia um, um é novo', () => {
  const e = (linha: number, codigo = 'TS2339') => ({ arquivo: 'a.ts', linha, codigo, mensagem: 'x' })
  expect(errosNovos([e(3)], [e(9)])).toEqual([])
  expect(errosNovos([e(3)], [e(3), e(4)])).toEqual([e(4)])
  expect(errosNovos([], [e(1)])).toEqual([e(1)])
  expect(errosNovos([e(1, 'TS2345')], [e(1)])).toEqual([e(1)])
  expect(errosNovos([{ ...e(1), arquivo: 'b.ts' }], [e(1)])).toEqual([e(1)])
  expect(errosNovos([e(1), e(1)], [e(1)])).toEqual([])
  // Sem nada na base, os dois iguais são novos; o mesmo código com outra mensagem é outro erro.
  expect(errosNovos([], [e(1), e(1)])).toEqual([e(1), e(1)])
  expect(errosNovos([e(1)], [{ ...e(1), mensagem: 'y' }])).toEqual([{ ...e(1), mensagem: 'y' }])
})

test('pastasParaTipos: só a pasta com tsconfig e com .ts/.tsx tocado dentro dela; a raiz vale para todo .ts', () => {
  const com = (p: string) => p !== 'sem'
  expect(pastasParaTipos(['cb', 'pdt', 'sem'], com, ['cb/hooks/r.tsx', 'pdt/README.md', 'sem/x.ts'])).toEqual(['cb'])
  expect(pastasParaTipos(['', ''], com, ['src/a.mts'])).toEqual([''])
  expect(pastasParaTipos([''], com, ['src/a.py'])).toEqual([])
  expect(pastasParaTipos(['cb'], com, ['cbx/a.ts'])).toEqual([])
  expect(pastasParaTipos(['cb'], () => false, ['cb/a.ts'])).toEqual([])
})

test('linhaTipos: nada sem checagem; aviso sozinho sem erro; erro novo lista e reprova; mais de 10 resume', () => {
  expect(linhaTipos(undefined)).toBe('')
  expect(linhaTipos({ pastas: [''], novos: [], antigos: 0, aviso: 'tsc não encontrado' })).toBe('Tipos:      ⚠ tsc não encontrado')
  expect(linhaTipos({ pastas: ['cb', ''], novos: [], antigos: 2 })).toBe('Tipos:      tsc em cb, .: nenhum erro novo; 2 já existiam na base (não reprova)')
  const novo = { arquivo: 'a.ts', linha: 2, codigo: 'TS1', mensagem: 'm' }
  expect(linhaTipos({ pastas: ['cb'], novos: [novo], antigos: 1, aviso: 'sem base' })).toBe(
    'Tipos:      tsc em cb: 1 erro novo → a linha de base reprova; 1 já existia na base (não reprova)\n  a.ts:2 TS1: m\n  ⚠ sem base',
  )
  const muitos = linhaTipos({ pastas: ['cb'], novos: Array.from({ length: 12 }, () => ({ arquivo: '', codigo: 'TS2', mensagem: 'p' })), antigos: 0 })
  expect(muitos.split('\n')).toHaveLength(12)
  expect(muitos).toContain('12 erros novos')
  expect(muitos).toContain('  (projeto) TS2: p')
  expect(muitos).toContain('  … e mais 2')
  // Exatamente 10: todos listados, sem a linha do resumo.
  const dez = linhaTipos({ pastas: ['cb'], novos: Array.from({ length: 10 }, () => ({ arquivo: '', codigo: 'TS2', mensagem: 'p' })), antigos: 0 })
  expect(dez.split('\n')).toHaveLength(11)
  expect(dez).not.toContain('e mais')
})
