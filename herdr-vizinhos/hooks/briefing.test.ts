import { expect, test } from 'claude-code/testing'

import { arquivoBriefing, casa, faltas, foraDoEscopo, lerBriefing, promptDoPane, slug, textoBriefing, textoConferencia, tocadosDe } from './briefing'
import type { Briefing } from './briefing'

const B: Briefing = {
  frente: 'Revisão do painel',
  objetivo: 'Revisar as abas do painel com outro modelo.',
  arquivos: ['contexto-bar/hooks/', 'docs/*.md'],
  feito: 'claude plugin test contexto-bar passa e o Esc fecha todas as abas.',
  naoTocar: ['contexto-bar/.claude-plugin/plugin.json'],
  pendencia: 3,
  harness: 'codex',
}

test('slug: sem acento, minúsculo, só letras, números e hífen; o arquivo fica em .herdr/frentes da pasta', () => {
  expect(slug('  Revisão do Painel (v2)! ')).toBe('revisao-do-painel-v2')
  expect(slug('???')).toBe('')
  expect(arquivoBriefing('/repo/', 'Revisão do painel')).toBe('/repo/.herdr/frentes/revisao-do-painel.md')
})

test('faltas: frente (com nome que vira arquivo), objetivo e feito são obrigatórios; arquivos e naoTocar não', () => {
  expect(faltas(B)).toEqual([])
  expect(faltas({ frente: '!!', objetivo: ' ', feito: '' })).toEqual(['frente', 'objetivo', 'feito'])
  expect(faltas({ frente: 'a', objetivo: 'o', feito: 'f' })).toEqual([])
})

test('o texto do briefing volta inteiro na leitura: seções, listas, pendência e harness', () => {
  const t = textoBriefing(B, '2026-10-16T00:00:00.000Z')
  expect(t.split('\n').slice(0, 2)).toEqual(['# Frente: Revisão do painel', '<!-- herdr-briefing v1 · 2026-10-16T00:00:00.000Z · pendência #3 · harness codex -->'])
  expect(t).toContain('## O que conta como feito\n\nclaude plugin test contexto-bar passa')
  expect(t).toContain('- `contexto-bar/hooks/`\n- `docs/*.md`')
  expect(t).toContain('## Ao terminar')
  expect(lerBriefing(t)).toEqual(B)
})

test('sem listas, o texto diz o padrão em prosa e a leitura devolve listas vazias; sem pendência nem harness, nada a mais', () => {
  const b = { ...B, arquivos: [], naoTocar: [], pendencia: undefined, harness: undefined }
  const t = textoBriefing(b, 'em')
  expect(t).toContain('Qualquer arquivo da pasta')
  expect(t.split('\n')[1]).toBe('<!-- herdr-briefing v1 · em -->')
  const lido = lerBriefing(t)!
  expect(lido.arquivos).toEqual([])
  expect(lido.naoTocar).toEqual([])
  expect('pendencia' in lido || 'harness' in lido).toBe(false)
})

test('lerBriefing: seção repetida no fim (alguém acrescentou ao arquivo) vale pela última', () => {
  const t = `${textoBriefing(B, 'em')}\n## Arquivos\n\n- \`outra/\`\n`
  expect(lerBriefing(t)!.arquivos).toEqual(['outra/'])
})

test('lerBriefing recusa o que não é briefing v1', () => {
  expect(lerBriefing('# Notas\n')).toBeNull()
  expect(lerBriefing('# Frente: x\n<!-- herdr-briefing v2 · em -->\n')).toBeNull()
  expect(lerBriefing('# Frente: x\nqualquer\n')).toBeNull()
  expect(lerBriefing('')).toBeNull()
})

test('casa: igual, pasta com / e o que há nela, nome sem / também cobre a pasta, * num nível, ** em qualquer; vazio não casa', () => {
  expect(casa('a/b.ts', 'a/b.ts')).toBe(true)
  expect(casa('./a/b.ts', 'a/b.ts')).toBe(true)
  expect(casa('a/b.ts', 'a/b.tsx')).toBe(false)
  expect(casa('a/', 'a/x/y.ts')).toBe(true)
  expect(casa('a/', 'ab/x.ts')).toBe(false)
  expect(casa('a', 'a/x.ts')).toBe(true)
  expect(casa('docs/*.md', 'docs/a.md')).toBe(true)
  expect(casa('docs/*.md', 'docs/sub/a.md')).toBe(false)
  expect(casa('docs/**.md', 'docs/sub/a.md')).toBe(true)
  expect(casa('a.b', 'axb')).toBe(false)
  expect(casa('*.m.d', 'x.m.d')).toBe(true)
  expect(casa('*.m.d', 'x.mxd')).toBe(false)
  expect(casa('  ', 'a')).toBe(false)
})

test('foraDoEscopo: o proibido vence a lista de arquivos e não se repete em fora; sem lista de arquivos, só o proibido conta', () => {
  const tocados = ['contexto-bar/hooks/r.tsx', 'contexto-bar/.claude-plugin/plugin.json', 'README.md', 'docs/a.md']
  expect(foraDoEscopo(tocados, { ...B, naoTocar: [...B.naoTocar, 'contexto-bar/hooks/r.tsx'] })).toEqual({
    proibidos: ['contexto-bar/hooks/r.tsx', 'contexto-bar/.claude-plugin/plugin.json'],
    fora: ['README.md'],
  })
  expect(foraDoEscopo(tocados, { arquivos: [], naoTocar: ['README.md'] })).toEqual({ proibidos: ['README.md'], fora: [] })
  expect(foraDoEscopo([], B)).toEqual({ proibidos: [], fora: [] })
})

test('tocadosDe junta o diff e os novos, sem repetir, sem linha vazia e sem a pasta .herdr', () => {
  expect(tocadosDe('a.ts\n b.ts \n\n', 'c.ts\na.ts\n.herdr/frentes/x.md\n.herdr/.gitignore\n')).toEqual(['a.ts', 'b.ts', 'c.ts'])
  expect(tocadosDe('', '')).toEqual([])
})

test('textoConferencia: no escopo lembra o feito; fora lista cada um com o motivo e diz que não está feita', () => {
  expect(textoConferencia(B, ['a'], { proibidos: [], fora: [] })).toBe(`Frente "Revisão do painel": 1 arquivo tocado, todos no escopo. Feito quando: ${B.feito}`)
  expect(textoConferencia(B, ['a', 'b'], { proibidos: ['a'], fora: ['b'] })).toBe(
    [
      'Frente "Revisão do painel": 2 arquivos tocados; FORA DO ESCOPO:',
      '  ✘ a (em "O que não tocar")',
      '  ✘ b (fora de "Arquivos")',
      'A frente não está feita: desfaça ou justifique cada um antes da prova.',
    ].join('\n'),
  )
  // Só uma das listas com algo já é fora do escopo; zero tocados vai no plural.
  expect(textoConferencia(B, ['a'], { proibidos: ['a'], fora: [] })).toContain('FORA DO ESCOPO:\n  ✘ a (em "O que não tocar")')
  expect(textoConferencia(B, ['b'], { proibidos: [], fora: ['b'] })).toContain('FORA DO ESCOPO:\n  ✘ b (fora de "Arquivos")')
  expect(textoConferencia(B, [], { proibidos: [], fora: [] })).toContain('0 arquivos tocados, todos no escopo')
  expect(promptDoPane('/r/.herdr/frentes/x.md')).toBe('Leia /r/.herdr/frentes/x.md e trabalhe só nessa frente. Ao terminar, pare com o resultado na árvore, sem commit.')
})
