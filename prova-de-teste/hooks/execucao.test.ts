import { expect, test } from 'claude-code/testing'

import {
  aplicarTrecho,
  conferirEstado,
  erroDeCarga,
  invalido,
  lerMutacoes,
  comandosPara,
  categoriasDescobertas,
  concentracao,
  conferir,
  contar,
  contarTestes,
  detectarComando,
  linhasDoDiff,
  porMutante,
  resumoCusto,
  somarTestes,
  tamanhoDoRepo,
  estadoDe,
  lerMutacao,
  quemMatou,
  relatorio,
  resolverArquivo,
} from './execucao'
import type { Execucao, Resultado } from './execucao'

test('lê a mutação com crase simples ou dupla, inclusive trecho com crase dentro', () => {
  expect(lerMutacao('`a + b` → `a - b`')).toEqual({ de: 'a + b', para: 'a - b' })
  expect(lerMutacao('`x` → ``')).toEqual({ de: 'x', para: '' })
  expect(lerMutacao('`` `${a}` `` → `` `b` ``')).toEqual({ de: '`${a}`', para: '`b`' })
  expect(lerMutacao('troque a por b')).toBe(null)
})

test('aplica pelo trecho na ocorrência mais próxima da linha indicada, e recusa o que não dá para aplicar', () => {
  const fonte = 'if (x) a()\nfoo\nif (x) b()\nbar\nif (x) c()\n'
  const r = aplicarTrecho(fonte, 4, '`if (x)` → `if (!x)`')
  expect('erro' in r).toBe(false)
  if ('erro' in r) return
  expect(r.texto).toBe('if (x) a()\nfoo\nif (!x) b()\nbar\nif (x) c()\n')
  expect(r.linhaReal).toBe(3)
  expect(r.ocorrencias).toBe(3)
  // Empate de distância: fica a primeira.
  const e = aplicarTrecho('k\nk\n', 1, '`k` → `j`')
  expect('erro' in e ? e.erro : e.linhaReal).toBe(1)
  expect(aplicarTrecho(fonte, 1, '`nao existe` → `y`')).toEqual({ erro: 'trecho original não encontrado no arquivo' })
  expect(aplicarTrecho(fonte, 1, '`foo` → `foo`')).toEqual({ erro: 'mutação não muda nada' })
  expect(aplicarTrecho(fonte, 1, 'sem crases')).toEqual({ erro: 'mutação fora do formato `original` → `mutado`' })
})

test('atribui a morte ao teste que falhou, pelos formatos comuns', () => {
  expect(quemMatou('(pass) a [1ms]\n(fail) separa o diff [2.1ms]\n', 1)).toBe('separa o diff')
  expect(quemMatou('  ✓ ok\n  ✕ soma dá 3 (4 ms)\n', 1)).toBe('soma dá 3')
  expect(quemMatou('FAILED tests/test_a.py::test_soma - assert\n', 1)).toBe('tests/test_a.py::test_soma')
  expect(quemMatou('FAIL src/a.test.ts\n', 1)).toBe('src/a.test.ts')
  // node --test: o reporter spec (o teste de dentro vem antes do grupo, o resumo "failing tests:" não é teste) e o TAP.
  expect(quemMatou('✔ passa (0.7ms)\n▶ grupo\n  ✖ soma dá 3 (0.65ms)\n✖ grupo (0.92ms)\n\n✖ failing tests:\n', 1)).toBe('soma dá 3')
  expect(quemMatou('ℹ fail 1\n\n✖ failing tests:\n\ntest at a.test.js:3:1\n✖ lê o corpo (0.23ms)\n', 1)).toBe('lê o corpo')
  expect(quemMatou('ok 1 - passa\nnot ok 2 - soma dá 3\n', 1)).toBe('soma dá 3')
  expect(quemMatou('Segmentation fault\n', 139)).toBe('código de saída 139')
})

test('detecta os comandos: um por plugin tocado; senão npm test ou pytest para o repositório todo; sem nada, vazio', () => {
  const nada = { temPytest: false, pastasDePlugin: [] }
  expect(detectarComando({ ...nada, pastasDePlugin: ['mods/x'] }, ['mods/x/hooks/a.ts'], '/c')).toEqual([{ pasta: 'mods/x', argv: ['claude', 'plugin', 'test', '/c/mods/x'] }])
  expect(detectarComando({ ...nada, pastasDePlugin: [''] }, ['hooks/a.ts'], '/c')).toEqual([{ pasta: '', argv: ['claude', 'plugin', 'test', '/c'] }])
  // Dois plugins tocados: dois comandos (achado antes da rodada 5: o detector pegava só o primeiro).
  expect(detectarComando({ ...nada, pastasDePlugin: ['a', 'b'] }, ['a/x.ts', 'b/y.ts'], '/c').map(c => c.pasta)).toEqual(['a', 'b'])
  // Pasta de plugin que o diff não tocou não entra; nome parecido também não.
  expect(detectarComando({ ...nada, pastasDePlugin: ['mods/x'] }, ['mods/xy/a.ts'], '/c')).toEqual([])
  expect(detectarComando({ ...nada, pacote: '{"scripts":{"test":"vitest run"}}' }, ['a.ts'], '/c')).toEqual([{ argv: ['npm', 'test', '--silent'] }])
  expect(detectarComando({ ...nada, pacote: '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' }, ['a.ts'], '/c')).toEqual([])
  expect(detectarComando({ ...nada, pacote: '{inválido', temPytest: true }, ['a.py'], '/c')).toEqual([{ argv: ['python3', '-m', 'pytest', '-q'] }])
  // package.json sem script de teste não vira npm test: segue para o pytest (sobrevivente #10 da rodada 5).
  expect(detectarComando({ ...nada, pacote: '{"name":"x"}', temPytest: true }, ['a.py'], '/c')).toEqual([{ argv: ['python3', '-m', 'pytest', '-q'] }])
  expect(detectarComando(nada, ['a.go'], '/c')).toEqual([])
})

test('cada mutante roda só os comandos do plugin onde está; comando sem pasta vale para todos', () => {
  const cs = [{ pasta: 'a', argv: ['A'] }, { pasta: 'b', argv: ['B'] }, { pasta: '', argv: ['R'] }]
  expect(comandosPara('a/x.ts', cs).map(c => c.argv[0])).toEqual(['A', 'R'])
  expect(comandosPara('b/y.ts', cs).map(c => c.argv[0])).toEqual(['B', 'R'])
  expect(comandosPara('ab/z.ts', cs).map(c => c.argv[0])).toEqual(['R'])
  expect(comandosPara('a/x.ts', [{ argv: ['npm'] }]).map(c => c.argv[0])).toEqual(['npm'])
  // Arquivo fora de todo plugin, sem comando do repositório: nenhum comando o cobre.
  expect(comandosPara('EXPERIMENTO.md', cs.slice(0, 2))).toEqual([])
})

const res = (n: number, categoria: Resultado['categoria'], situacao: Resultado['situacao'], motivo?: string): Resultado => ({
  n,
  arquivo: 'src/a.ts',
  linha: n,
  categoria,
  mutacao: '`a` → `b`',
  situacao,
  motivo,
  segundos: 1,
})

const exec = (resultados: Resultado[], extra: Partial<Execucao> = {}): Execucao => ({
  tarefa: 't',
  modelo: 'opus',
  comando: ['npm test'],
  enviados: ['src/a.ts'],
  excluidos: ['src/a.test.ts'],
  naoAplicaveis: [],
  linhaDeBase: { passou: true, segundos: 1 },
  resultados,
  restauracao: 'cmp na cópia: idêntico',
  originalIntocado: true,
  segundos: 9,
  ...extra,
})

const todas = [res(1, 'borda/vazio', 'MORTO', 't1'), res(2, 'empate/ordem', 'MORTO', 't2'), res(3, 'null/inválido', 'MORTO', 't3'), res(4, 'condição invertida', 'MORTO', 't4')]

test('estado: PROVADO só com base verde, original intocado, restauração idêntica, tudo morto e categorias cobertas', () => {
  expect(estadoDe(exec(todas))).toBe('PROVADO')
  expect(estadoDe(exec([...todas, res(5, 'livre', 'SOBREVIVENTE')]))).toBe('FRACO')
  // Não aplicado não cobre categoria.
  expect(estadoDe(exec([...todas.slice(0, 3), res(4, 'condição invertida', 'NÃO APLICADO', 'x')]))).toBe('FRACO')
  expect(estadoDe(exec(todas.slice(0, 3), { naoAplicaveis: ['condição invertida: sem ramos'] }))).toBe('PROVADO')
  expect(estadoDe(exec(todas, { linhaDeBase: { passou: false, segundos: 1 } }))).toBe('NÃO VERIFICADO')
  expect(estadoDe(exec(todas, { originalIntocado: false }))).toBe('NÃO VERIFICADO')
  expect(estadoDe(exec(todas, { restauracao: 'cmp na cópia: DIFERENTE' }))).toBe('NÃO VERIFICADO')
  expect(estadoDe(exec([]))).toBe('NÃO VERIFICADO')
})

test('contagem ignora os não aplicados; concentração alerta só acima da metade', () => {
  const rs = [...todas, res(5, 'livre', 'NÃO APLICADO', 'x'), res(6, 'livre', 'SOBREVIVENTE')]
  expect(contar(rs)).toEqual({ aplicados: 5, mortos: 4, sobreviventes: 1 })
  expect(categoriasDescobertas(rs, [])).toEqual([])
  expect(concentracao(todas)).toEqual({ maior: 1, total: 4, teste: 't1', alerta: false })
  // 2 de 4 é exatamente a metade: sem alerta; 3 de 4, com.
  const dois = [res(1, 'livre', 'MORTO', 'A'), res(2, 'livre', 'MORTO', 'A'), res(3, 'livre', 'MORTO', 'B'), res(4, 'livre', 'MORTO', 'C')]
  expect(concentracao(dois).alerta).toBe(false)
  expect(concentracao([...dois.slice(0, 2), res(3, 'livre', 'MORTO', 'A'), dois[3]!]).alerta).toBe(true)
  expect(concentracao([])).toEqual({ maior: 0, total: 0, teste: undefined, alerta: false })
})

test('o relatório traz cada mutante, as categorias, a concentração, a restauração e o estado', () => {
  const r = relatorio(exec([...todas, { ...res(5, 'livre', 'NÃO APLICADO', 'trecho original não encontrado no arquivo'), linhaReal: 9 }]), '2026-10-14')
  expect(r).toContain('PROVA DE TESTE — t — 2026-10-14')
  expect(r).toContain('Mutantes:   4 aplicados | 4 mortos | 0 sobreviventes | 1 não aplicados')
  expect(r).toContain('1 | src/a.ts:1 | borda/vazio | `a` → `b` | MORTO por "t1"')
  expect(r).toContain('5 | src/a.ts:5 (aplicado na 9) | livre')
  expect(r).toContain('NÃO APLICADO: trecho original não encontrado')
  expect(r).toContain('borda/vazio ✔ | empate/ordem ✔ | null/inválido ✔ | condição invertida ✔')
  expect(r).toContain('Concentração: 1/4')
  expect(r).toContain('original ✔ intocado')
  expect(r).toContain('Estado:     PROVADO')
  // Sem aviso de fora do git nem não-código, nada sobra no relatório (rodada 7, #11).
  expect(r).not.toContain('undefined')
  expect(r).not.toContain('não-código')
  expect(relatorio(exec(todas.slice(0, 2)), 'd')).toContain('null/inválido ✘')
  expect(relatorio(exec([res(1, 'livre', 'SOBREVIVENTE')]), 'd')).toContain('SOBREVIVENTE → reforçar ou justificar')
})

test('conferir: só passa com os mesmos três números da execução', () => {
  const feita = { aplicados: 5, mortos: 4, sobreviventes: 1, quando: 'agora' }
  expect(conferir(feita, { aplicados: 5, mortos: 4, sobreviventes: 1 })).toBe(undefined)
  expect(conferir(feita, { aplicados: 5, mortos: 5, sobreviventes: 0 })).toContain('5/4/1')
  expect(conferir(feita, { aplicados: 4, mortos: 4, sobreviventes: 1 })).toContain('não batem')
  expect(conferir(feita, { aplicados: 5, mortos: 4, sobreviventes: 2 })).toContain('não batem')
})

test('resolve o caminho que o modelo devolveu: exato, sufixo único ou recusa com o motivo (achado na 1ª execução da rodada 4)', () => {
  const enviados = ['prova-de-teste/hooks/execucao.ts', 'prova-de-teste/hooks/register.ts', 'outro/hooks/register.ts']
  expect(resolverArquivo('prova-de-teste/hooks/execucao.ts', enviados)).toEqual({ arquivo: 'prova-de-teste/hooks/execucao.ts' })
  expect(resolverArquivo('execucao.ts', enviados)).toEqual({ arquivo: 'prova-de-teste/hooks/execucao.ts' })
  expect(resolverArquivo('hooks/execucao.ts', enviados)).toEqual({ arquivo: 'prova-de-teste/hooks/execucao.ts' })
  expect(resolverArquivo('register.ts', enviados)).toEqual({ erro: 'caminho ambíguo: prova-de-teste/hooks/register.ts, outro/hooks/register.ts' })
  // Sufixo tem de cair numa fronteira de pasta: "cucao.ts" não é execucao.ts.
  expect(resolverArquivo('cucao.ts', enviados)).toEqual({ erro: 'arquivo fora do diff enviado' })
  expect(resolverArquivo('', enviados)).toEqual({ erro: 'arquivo fora do diff enviado' })
  // O escolhedor às vezes repete o caminho com dois-pontos: vale o pedaço que resolve (rodada 5).
  expect(resolverArquivo('execucao.ts:prova-de-teste/hooks/execucao.ts', enviados)).toEqual({ arquivo: 'prova-de-teste/hooks/execucao.ts' })
  expect(resolverArquivo('nada.ts:execucao.ts', enviados)).toEqual({ arquivo: 'prova-de-teste/hooks/execucao.ts' })
  expect(resolverArquivo('nada.ts:outro.ts', enviados)).toEqual({ erro: 'arquivo fora do diff enviado' })
  expect(resolverArquivo('execucao.ts:prova-de-teste/hooks/register.ts', enviados)).toEqual({ erro: 'caminho ambíguo: prova-de-teste/hooks/execucao.ts, prova-de-teste/hooks/register.ts' })
  // A pasta repetida na frente (rodada 7).
  expect(resolverArquivo('prova-de-teste/prova-de-teste/hooks/execucao.ts', enviados)).toEqual({ arquivo: 'prova-de-teste/hooks/execucao.ts' })
  expect(resolverArquivo('xprova-de-teste/hooks/execucao.ts', enviados)).toEqual({ erro: 'arquivo fora do diff enviado' })
})

test('trecho com crase e seta por dentro: vale a divisão cujo original existe no arquivo (morte falsa #9 da rodada 4)', () => {
  const fonte = "if (!m) return { erro: 'fora do formato `original` → `mutado`' }\n"
  const r = aplicarTrecho(fonte, 1, "`if (!m) return { erro: 'fora do formato `original` → `mutado`' }` → `if (false) return { erro: 'fora do formato `original` → `mutado`' }`")
  expect('erro' in r ? r.erro : r.texto).toBe("if (false) return { erro: 'fora do formato `original` → `mutado`' }\n")
})

test('mutante que não carrega é inválido, não morto', () => {
  expect(invalido('(fail) the file did not load\n')).toBe(true)
  expect(invalido('SyntaxError: Unexpected token\n')).toBe(true)
  expect(invalido("error TS1005: ';' expected.\n")).toBe(true)
  expect(invalido('(fail) soma dá 3 [1ms]\n')).toBe(false)
  expect(invalido('')).toBe(false)
  // Erro lançado dentro de um teste sai indentado sob o nome dele: é morte, não carga (contexto-bar e um projeto externo, rodada 6).
  expect(invalido('(fail) grava o arquivo [31ms]\n  SyntaxError: JSON Parse error: Unexpected identifier "undefined"\n')).toBe(false)
  expect(invalido('✖ lê o corpo (0.23ms)\n  SyntaxError [Error]: Unexpected token \'<\'\n')).toBe(false)
  // O node que não carrega o arquivo escreve o erro na coluna 0.
  expect(invalido('/c/b.test.js:1\nconst x = ;\n          ^\n\nSyntaxError: Unexpected token \';\'\n✖ b.test.js (34ms)\n')).toBe(true)
})

test('trecho original vazio nunca vira leitura: buscaria "" para sempre (sobrevivente #11 da 3ª execução da rodada 4)', () => {
  expect(lerMutacoes('`` → `x`')).toEqual([])
  // A nota do escolhedor depois da mutação sai (rodada 0.7.0, #1, #5, #7); parênteses dentro do trecho ficam.
  expect(lerMutacoes('`if (x) return 1` → `` (remove a guarda)')).toEqual([{ de: 'if (x) return 1', para: '' }])
  expect(lerMutacoes('`a + n` → `n` (guarda só o último)')).toEqual([{ de: 'a + n', para: 'n' }])
  expect(lerMutacoes('`f(a)` → `f(b)`')).toEqual([{ de: 'f(a)', para: 'f(b)' }])
  expect(lerMutacoes('` → `x`')).toEqual([])
  expect(aplicarTrecho('abc\n', 1, '`` → `x`')).toEqual({ erro: 'mutação fora do formato `original` → `mutado`' })
})

test('o mutante que não carrega diz por quê: a primeira linha do erro de carga', () => {
  expect(erroDeCarga("/c/b.test.js:1\nconst x = ;\n\nSyntaxError: Unexpected token ';'\n    at wrapSafe\n")).toBe("SyntaxError: Unexpected token ';'")
  expect(erroDeCarga('(fail) the file did not load\n\n  error TS2345: Argument of type string\n')).toBe('error TS2345: Argument of type string')
  expect(erroDeCarga('(fail) the file did not load\n')).toBe('the file did not load')
  expect(erroDeCarga('(fail) soma [1ms]\n  SyntaxError: JSON Parse error\n')).toBeUndefined()
  // Vale o primeiro erro, não o último.
  expect(erroDeCarga('(fail) the file did not load\n\n  error TS2345: A\n  error TS1005: B\n')).toBe('error TS2345: A')
  expect(erroDeCarga('SyntaxError: A\nerror TS1005: B\n')).toBe('SyntaxError: A')
  // O texto citado no código de um teste que falhou não é carga (rodada 7: #4 e #8 falsos).
  expect(erroDeCarga("(fail) diz por quê [1ms]\n  12 |   expect(erroDeCarga('(fail) the file did not load\\n')).toBe(x)\n  Received: undefined\n")).toBeUndefined()
})

test('conferirEstado: estado acima do executado só com cada sobrevivente justificado (demo do claude-grounds: equivalente falso)', () => {
  const feita = { estado: 'FRACO', estadoSeEquivalentes: 'PROVADO', sobreviventesN: [3, 5] }
  // Igual ou pior que o executado: passa sem justificativa.
  expect(conferirEstado(feita, 'FRACO')).toBeUndefined()
  expect(conferirEstado(feita, 'NÃO VERIFICADO')).toBeUndefined()
  // Melhor: cada sobrevivente precisa de motivo.
  expect(conferirEstado(feita, 'PROVADO')).toContain('sem justificativa: #3, #5')
  expect(conferirEstado(feita, 'PROVADO', [{ n: 3, motivo: 'x' }, { n: 5, motivo: '  ' }])).toContain('sem justificativa: #5')
  expect(conferirEstado(feita, 'PROVADO', [{ n: 3, motivo: 'a' }, { n: 5, motivo: 'b' }])).toBeUndefined()
  // Justificar o que não sobreviveu é erro.
  expect(conferirEstado(feita, 'PROVADO', [{ n: 3, motivo: 'a' }, { n: 5, motivo: 'b' }, { n: 7, motivo: 'c' }])).toContain('#7 não sobreviveu')
  // O mod aplicou a escolha às cegas: PROVADO-PARCIAL não cabe numa execução dele.
  expect(conferirEstado(feita, 'PROVADO-PARCIAL', [{ n: 3, motivo: 'a' }, { n: 5, motivo: 'b' }])).toContain('o estado é PROVADO')
  // Com categoria descoberta, justificar sobreviventes não basta.
  expect(conferirEstado({ ...feita, estadoSeEquivalentes: 'FRACO' }, 'PROVADO', [{ n: 3, motivo: 'a' }, { n: 5, motivo: 'b' }])).toContain('estado máximo é FRACO')
  // Sem sobrevivente, mas com categoria descoberta: subir de estado continua barrado (rodada 10, #2).
  expect(conferirEstado({ estado: 'FRACO', estadoSeEquivalentes: 'FRACO', sobreviventesN: [] }, 'PROVADO')).toContain('estado máximo é FRACO')
  // Execução gravada antes da 0.6.0 (sem a lista): não há como conferir.
  expect(conferirEstado({ estado: 'FRACO' }, 'PROVADO')).toBeUndefined()
})

test('contarTestes lê o resumo de cada executor; sem resumo, não inventa', () => {
  expect(contarTestes('(pass) a [1ms]\n\n 46 pass\n 0 fail\nRan 46 tests across 3 files. [0.96s]\n')).toBe(46)
  expect(contarTestes('Tests:       1 failed, 11 passed, 12 total\n')).toBe(12)
  expect(contarTestes('      Tests  9 passed (9)\n')).toBe(9)
  expect(contarTestes('# tests 7\n# suites 1\n# pass 7\n')).toBe(7)
  expect(contarTestes('ℹ tests 5\nℹ pass 4\n')).toBe(5)
  // pytest: só os que rodaram (passed, failed, errors); pulados não contam.
  expect(contarTestes('==== 3 failed, 9 passed, 2 skipped in 0.31s ====\n')).toBe(12)
  expect(contarTestes('12 passed in 1.02s\n')).toBe(12)
  expect(contarTestes('1 error in 0.10s\n')).toBe(1)
  expect(contarTestes('  ✓ soma dá 3\n')).toBeUndefined()
  expect(contarTestes('')).toBeUndefined()
})

test('linhasDoDiff conta só + e -, sem os cabeçalhos; tamanhoDoRepo soma os blobs do ls-tree', () => {
  expect(linhasDoDiff('--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n+c\n contexto\n')).toBe(3)
  // Uma linha removida que começa com "--" (comentário SQL) ainda conta.
  expect(linhasDoDiff('diff --git a/q.sql b/q.sql\n--- a/q.sql\n+++ b/q.sql\n@@ -1 +0,0 @@\n--- comentário\ndiff --git a/r b/r\n--- a/r\n+++ b/r\n')).toBe(1)
  expect(linhasDoDiff('')).toBe(0)
  const ls = '100644 blob aaa     120\tsrc/a.ts\n100644 blob bbb    2048\tREADME.md\n160000 commit ccc       -\tsub\n'
  expect(tamanhoDoRepo(ls)).toEqual({ arquivos: 2, bytes: 2168 })
  expect(tamanhoDoRepo('')).toEqual({ arquivos: 0, bytes: 0 })
  // Blob sem tamanho legível conta o arquivo e zero bytes, sem virar NaN.
  expect(tamanhoDoRepo('100644 blob aaa\tx\n100644 blob bbb 5\ty\n')).toEqual({ arquivos: 2, bytes: 5 })
})

test('porMutante e resumoCusto: médias só dos aplicados; testes só quando todos têm o número', () => {
  const a = { ...res(1, 'livre', 'MORTO', 'x'), segundos: 2, testes: 10 }
  const b = { ...res(2, 'livre', 'SOBREVIVENTE'), segundos: 4, testes: 20 }
  const na = { ...res(3, 'livre', 'NÃO APLICADO', 'y'), segundos: 99, testes: 999 }
  expect(porMutante([a, b, na])).toEqual({ n: 2, segundos: 3, testes: 15 })
  expect(porMutante([a, { ...b, testes: undefined }]).testes).toBeUndefined()
  expect(porMutante([na])).toEqual({ n: 0, segundos: 0 })
  const e = exec([a, b, na], { linhaDeBase: { passou: true, segundos: 1.25 }, custo: { repo: { arquivos: 40, bytes: 3 * 1024 * 1024 }, diff: { arquivos: 2, linhas: 80 }, testesNaBase: 46 } })
  expect(resumoCusto(e)).toBe('base 1.3 s, 46 testes; por mutante 3.0 s, 15 testes (n=2); repositório 40 arquivos, 3.0 MB; diff 80 linhas em 2 arquivos')
  expect(resumoCusto(exec([a]))).toContain('repositório ?; diff ?')
  // 1 MB exato já se escreve em MB; abaixo, em KB.
  const repo = (bytes: number) => resumoCusto(exec([a], { custo: { repo: { arquivos: 1, bytes }, diff: { arquivos: 1, linhas: 1 } } }))
  expect(repo(1024 * 1024)).toContain('1 arquivos, 1.0 MB')
  expect(repo(1024 * 1024 - 1)).toContain('1 arquivos, 1024 KB')
  // Um comando sem resumo deixa a soma desconhecida: zero seria mentira.
  expect(somarTestes(3, 4)).toBe(7)
  expect(somarTestes(3, undefined)).toBeUndefined()
  expect(somarTestes(undefined, 4)).toBeUndefined()
  expect(relatorio(e, 'd')).toContain('Custo:      base 1.3 s, 46 testes; por mutante')
})
