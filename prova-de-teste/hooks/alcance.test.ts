import { expect, test } from 'claude-code/testing'

import { aliasesDeTsconfig, aliasesDeVite, cabeNoMapa, ehConfigDeAlias, ehEntradaDeTeste, especificadoresJs, LIMITE_MAPA, grafo, importsPy, normalizar, resolverJs, testesQueAlcancam } from './alcance'
import { planoIncremental } from './execucao'

test('ehEntradaDeTeste: só o que o executor descobre pelo nome; helper e fixture da pasta de teste não', () => {
  expect(ehEntradaDeTeste('hooks/a.test.ts')).toBe(true)
  expect(ehEntradaDeTeste('src/x.spec.mjs')).toBe(true)
  expect(ehEntradaDeTeste('tests/test_soma.py')).toBe(true)
  expect(ehEntradaDeTeste('pkg/soma_test.py')).toBe(true)
  expect(ehEntradaDeTeste('tests/helpers/fixture.ts')).toBe(false)
  expect(ehEntradaDeTeste('tests/conftest.py')).toBe(false)
  expect(ehEntradaDeTeste('src/latest.ts')).toBe(false)
})

test('normalizar resolve . e ..; acima da raiz não existe', () => {
  expect(normalizar('a/b/../c/./d')).toBe('a/c/d')
  expect(normalizar('a/../../x')).toBeUndefined()
  expect(normalizar('./x')).toBe('x')
})

test('especificadoresJs: import, export from, efeito colateral, require e import(); pacote entra e não resolve', () => {
  const fonte = [
    "import { a } from './a'",
    "import type { T } from '../tipos'",
    "export { b } from './b.js'",
    "import './efeito'",
    "const c = require('./c')",
    "const d = await import('./d')",
    "import { expect } from 'claude-code/testing'",
    "import x from 'lodash'",
  ].join('\n')
  expect(especificadoresJs(fonte).sort()).toEqual(['../tipos', './a', './b.js', './c', './d', './efeito', 'claude-code/testing', 'lodash'])
  expect(resolverJs('src/x.ts', 'lodash', new Set(['lodash.ts']))).toBeUndefined()
  // Import em várias linhas.
  expect(especificadoresJs("import {\n  a,\n  b,\n} from './varias'\n")).toEqual(['./varias'])
})

test('resolverJs: extensão implícita, .js que é .ts, index da pasta, e nada fora do repositório', () => {
  const arqs = new Set(['src/a.ts', 'src/b.ts', 'src/lib/index.tsx', 'tipos.ts'])
  expect(resolverJs('src/x.test.ts', './a', arqs)).toBe('src/a.ts')
  expect(resolverJs('src/x.test.ts', './b.js', arqs)).toBe('src/b.ts')
  expect(resolverJs('src/x.test.ts', './lib', arqs)).toBe('src/lib/index.tsx')
  expect(resolverJs('src/x.test.ts', '../tipos', arqs)).toBe('tipos.ts')
  expect(resolverJs('src/x.test.ts', '../../fora', arqs)).toBeUndefined()
  expect(resolverJs('src/x.test.ts', './nao', arqs)).toBeUndefined()
  // Arquivo vence a pasta com index, como no Node e no TypeScript (rodada 0.8.0, #7).
  expect(resolverJs('x.test.ts', './m', new Set(['m/index.ts', 'm.ts']))).toBe('m.ts')
  expect(resolverJs('x.test.ts', './m.js', new Set(['m.ts', 'm.js']))).toBe('m.js')
})

test('importsPy: absoluto (raiz e src/), relativo, submódulo pelo from, pacote pelo __init__', () => {
  const arqs = new Set(['pkg/__init__.py', 'pkg/soma.py', 'pkg/sub/mod.py', 'src/app/core.py', 'tests/test_x.py', 'tests/util.py'])
  const de = 'tests/test_x.py'
  expect(importsPy(de, 'from pkg.soma import soma\n', arqs)).toEqual(['pkg/soma.py'])
  expect(importsPy(de, 'from pkg import soma\n', arqs).sort()).toEqual(['pkg/__init__.py', 'pkg/soma.py'])
  expect(importsPy(de, 'import pkg.sub.mod as m\n', arqs).sort()).toEqual(['pkg/__init__.py', 'pkg/sub/mod.py'])
  expect(importsPy(de, 'from app.core import f\n', arqs)).toEqual(['src/app/core.py'])
  expect(importsPy(de, 'from .util import ajuda\n', arqs)).toEqual(['tests/util.py'])
  expect(importsPy('pkg/sub/mod.py', 'from .. import soma\n', arqs).sort()).toEqual(['pkg/__init__.py', 'pkg/soma.py'])
  expect(importsPy(de, 'import os, json\nfrom typing import Any\n', arqs)).toEqual([])
})

test('testesQueAlcancam: imports em qualquer profundidade, ciclo não trava, teste que não chega fica de fora', () => {
  const fontes = new Map([
    ['src/a.ts', "import { b } from './b'\n"],
    ['src/b.ts', "import { a } from './a'\n"], // ciclo a ↔ b
    ['src/c.ts', 'export const c = 1\n'],
    ['src/a.test.ts', "import { a } from './a'\n"],
    ['src/fixture.ts', "export * from './b'\n"],
    ['test/e2e.spec.ts', "import '../src/fixture'\n"],
    ['src/c.test.ts', "import { c } from './c'\n"],
  ])
  const g = grafo(fontes)
  expect(testesQueAlcancam('src/b.ts', g)).toEqual(['src/a.test.ts', 'test/e2e.spec.ts'])
  expect(testesQueAlcancam('src/c.ts', g)).toEqual(['src/c.test.ts'])
  expect(testesQueAlcancam('src/sozinho.ts', g)).toEqual([])
  // Ordem estável: em ordem alfabética, não na da busca (o direto z vem antes do indireto a na busca; rodada 0.8.0, #6).
  const g2 = grafo(new Map([['m.ts', ''], ['z.test.ts', "import './m'\n"], ['ponte.ts', "import './m'\n"], ['a.test.ts', "import './ponte'\n"]]))
  expect(testesQueAlcancam('m.ts', g2)).toEqual(['a.test.ts', 'z.test.ts'])
  // O próprio arquivo de teste mutado (helper com nome de teste) alcança a si mesmo.
  expect(testesQueAlcancam('src/c.test.ts', g)).toEqual(['src/c.test.ts'])
})

test('planoIncremental: suíte inteira quando não há mapa, ninguém alcança ou todos alcançam; comando de plugin sem os testes sai', () => {
  const g = grafo(
    new Map([
      ['p1/hooks/a.ts', ''],
      ['p1/hooks/a.test.ts', "import './a'\n"],
      ['p1/hooks/b.test.ts', ''],
      ['p2/hooks/c.test.ts', "import '../../p1/hooks/a'\n"],
      ['p2/hooks/d.test.ts', ''],
    ]),
  )
  const mapa = { g, testes: ['p1/hooks/a.test.ts', 'p1/hooks/b.test.ts', 'p2/hooks/c.test.ts', 'p2/hooks/d.test.ts'] }
  const c1 = { pasta: 'p1', argv: ['claude', 'plugin', 'test', 'x/p1'] }
  const c2 = { pasta: 'p2', argv: ['claude', 'plugin', 'test', 'x/p2'] }
  const c3 = { pasta: 'p3', argv: ['claude', 'plugin', 'test', 'x/p3'] }
  expect(planoIncremental('p1/hooks/a.ts', undefined, [c1])).toEqual({ escopo: 'suíte inteira (sem mapa de imports)', comandos: [c1] })
  expect(planoIncremental('p1/hooks/z.ts', mapa, [c1]).escopo).toBe('suíte inteira (nenhum teste importa o arquivo)')
  const p = planoIncremental('p1/hooks/a.ts', mapa, [c1, c2, c3])
  expect(p).toEqual({ escopo: 'incremental: 2/4 arquivos de teste', alcancam: ['p1/hooks/a.test.ts', 'p2/hooks/c.test.ts'], comandos: [c1, c2] })
  // Só o comando de p3 roda, e nenhum dos testes que alcançam o arquivo está em p3.
  expect(planoIncremental('p1/hooks/a.ts', mapa, [c3]).escopo).toBe('suíte inteira (nenhum teste importa o arquivo)')
  // O denominador é o escopo dos comandos: com só o de p1, os testes de p2 não contam.
  expect(planoIncremental('p1/hooks/a.ts', mapa, [c1]).escopo).toBe('incremental: 1/2 arquivos de teste')
  expect(planoIncremental('p1/hooks/a.ts', { g, testes: [...mapa.testes, 'p1/hooks/e.test.ts'] }, [c1])).toEqual({
    escopo: 'incremental: 1/3 arquivos de teste',
    alcancam: ['p1/hooks/a.test.ts'],
    comandos: [c1],
  })
  // Comando do repositório todo (npm test) sempre cobre.
  expect(planoIncremental('p1/hooks/a.ts', mapa, [{ argv: ['npm', 'test'] }]).alcancam).toHaveLength(2)
  // Todos alcançam: incremental não poupa nada.
  const todos = { g, testes: ['p1/hooks/a.test.ts', 'p2/hooks/c.test.ts'] }
  expect(planoIncremental('p1/hooks/a.ts', todos, [c1]).escopo).toBe('suíte inteira (todos os testes alcançam o arquivo)')
})

test('cabeNoMapa: até o limite lê o repositório; acima, a suíte inteira', () => {
  expect(cabeNoMapa(LIMITE_MAPA)).toBe(true)
  expect(cabeNoMapa(LIMITE_MAPA + 1)).toBe(false)
  expect(cabeNoMapa(0)).toBe(true)
})

test('aliases: paths do tsconfig por escopo e baseUrl, vite alias, o escopo mais fundo vence (projeto real, 0.8.1)', () => {
  // src/tsconfig.json: "@/*": ["./*"] vale para src/; um tsconfig com comentário ainda é lido.
  const src = aliasesDeTsconfig('src/tsconfig.json', '{ // app\n "compilerOptions": { "paths": {\n "@/*": ["./*"],\n "~cfg": ["../config/index.ts"] } } }')
  expect(src).toEqual([
    { escopo: 'src/', de: '@/', para: 'src/', curinga: true },
    { escopo: 'src/', de: '~cfg', para: 'config/index.ts', curinga: false },
  ])
  expect(aliasesDeTsconfig('tsconfig.json', '{"compilerOptions":{"baseUrl":"lib","paths":{"#/*":["*"]}}}')).toEqual([{ escopo: '', de: '#/', para: 'lib/', curinga: true }])
  expect(aliasesDeTsconfig('tsconfig.json', '{"compilerOptions":{}}')).toEqual([])
  // Na raiz, sem baseUrl, `*` aponta para a própria raiz: prefixo vazio, sem barra solta (rodada 0.8.1, #1).
  const raiz = aliasesDeTsconfig('tsconfig.json', '{"paths":{"~/*":["*"]}}')
  expect(raiz).toEqual([{ escopo: '', de: '~/', para: '', curinga: true }])
  expect(resolverJs('a/b.ts', '~/c/d', new Set(['c/d.ts']), raiz)).toBe('c/d.ts')
  // `lib*` é prefixo de nome: `~xfoo` → `libfoo`, com curinga sem barra (#2).
  const pre = aliasesDeTsconfig('tsconfig.json', '{"paths":{"~x*":["lib*"]}}')
  expect(pre).toEqual([{ escopo: '', de: '~x', para: 'lib', curinga: true }])
  expect(resolverJs('a.ts', '~xfoo', new Set(['libfoo.ts']), pre)).toBe('libfoo.ts')
  // Alvo acima da raiz não vira alias (#6); curinga só na chave não é curinga (#11).
  expect(aliasesDeTsconfig('tsconfig.json', '{"paths":{"@/*":["../fora/*"]}}')).toEqual([])
  expect(aliasesDeTsconfig('tsconfig.json', '{"paths":{"@/*":["only.ts"]}}')).toEqual([{ escopo: '', de: '@/*', para: 'only.ts', curinga: false }])
  expect(aliasesDeTsconfig('a/tsconfig.json', '{"compilerOptions":{"baseUrl":"../../x","paths":{"@/*":["*"]}}}')).toEqual([])
  const vite = aliasesDeVite('vitest.config.ts', "alias: {\n  '@': path.resolve(__dirname, 'src'),\n}")
  expect(vite).toEqual([
    { escopo: '', de: '@', para: 'src', curinga: false },
    { escopo: '', de: '@/', para: 'src/', curinga: true },
  ])
  const arqs = new Set(['src/utils/m.ts', 'src/lib/index.ts', 'config/index.ts', 'web/utils/m.ts'])
  expect(resolverJs('src/__tests__/x.test.ts', '@/utils/m', arqs, src)).toBe('src/utils/m.ts')
  expect(resolverJs('src/a.ts', '~cfg', arqs, src)).toBe('config/index.ts')
  // Fora do escopo do tsconfig de src/, o alias dele não vale; o do vite (raiz) vale.
  expect(resolverJs('electron/x.ts', '@/utils/m', arqs, src)).toBeUndefined()
  expect(resolverJs('electron/x.ts', '@/lib', arqs, vite)).toBe('src/lib/index.ts')
  expect(resolverJs('electron/x.ts', '@', new Set(['src/index.ts']), vite)).toBe('src/index.ts')
  // Dois escopos casam: o mais fundo (web/) vence o da raiz.
  // Na ordem que for: o do vite (raiz) vem antes e ainda perde (#4).
  const web = [...vite, { escopo: 'web/', de: '@/', para: 'web/', curinga: true }]
  expect(resolverJs('web/p.ts', '@/utils/m', new Set([...arqs, 'src/utils/m.ts']), web)).toBe('web/utils/m.ts')
  // `@x` não é `@/x`: o curinga exige a barra; o alias exato não casa prefixo.
  expect(resolverJs('src/a.ts', '@utils/m', arqs, src)).toBeUndefined()
  expect(resolverJs('src/a.ts', '~cfg/x', arqs, src)).toBeUndefined()
  expect(ehConfigDeAlias('src/tsconfig.json')).toBe(true)
  expect(ehConfigDeAlias('vitest.config.mts')).toBe(true)
  expect(ehConfigDeAlias('vite.config.ts')).toBe(true)
  expect(ehConfigDeAlias('src/config.ts')).toBe(false)
  // No grafo: o teste que importa por alias alcança o arquivo.
  const g = grafo(new Map([['src/utils/m.ts', ''], ['src/__tests__/m.test.ts', "import { f } from '@/utils/m'\n"]]), src)
  expect(testesQueAlcancam('src/utils/m.ts', g)).toEqual(['src/__tests__/m.test.ts'])
})
