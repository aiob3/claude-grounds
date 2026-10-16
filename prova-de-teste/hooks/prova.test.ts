import { expect, test } from 'claude-code/testing'

import { avisoNovos, validarManuais, CABECALHO_LOG, defeitosDoInstrumento, protocoloEm, ehArquivoDeTeste, instrumentoDe, tocaOInstrumento, nomeDe, versaoDe, lacunas, lerArgs, lerResposta, linhaLog, separar } from './prova'

const bloco = (arquivo: string, corpo = '+x') =>
  `diff --git a/${arquivo} b/${arquivo}\nindex 1..2 100644\n--- a/${arquivo}\n+++ b/${arquivo}\n@@ -1 +1 @@\n${corpo}\n`

test('reconhece arquivos de teste pelas convenções e não confunde nomes parecidos', () => {
  for (const t of ['src/a.test.ts', 'x/b.spec.tsx', 'c.test.mjs', 'tests/util.py', 'pkg/__tests__/d.js', 'test_e.py', 'a/test_f.py', 'g_test.go', 'h_test.rs'])
    expect(ehArquivoDeTeste(t)).toBe(true)
  for (const f of ['src/contest.ts', 'latest.py', 'src/attest_x.py', 'testing.ts', 'src/a.ts', 'protest/x.ts'])
    expect(ehArquivoDeTeste(f)).toBe(false)
})

test('separa o diff: testes saem antes do envio e o caminho certo vale para arquivo novo e apagado', () => {
  const novo = 'diff --git a/src/novo.ts b/src/novo.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/novo.ts\n@@ -0,0 +1 @@\n+n\n'
  const apagado = 'diff --git a/src/velho.ts b/src/velho.ts\ndeleted file mode 100644\n--- a/src/velho.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-v\n'
  const diff = bloco('src/a.ts', '+segredo do código') + bloco('src/a.test.ts', '+expect(segredo do teste)') + novo + apagado
  const { fonte, excluidos } = separar(diff)
  expect(fonte.map(b => b.arquivo)).toEqual(['src/a.ts', 'src/novo.ts', 'src/velho.ts'])
  expect(excluidos).toEqual(['src/a.test.ts'])
  expect(fonte.map(b => b.texto).join('')).not.toContain('segredo do teste')
  expect(separar('')).toEqual({ fonte: [], excluidos: [], naoCodigo: [] })
})

test('lê a resposta do modelo: mutantes, n/a e linhas fora do formato à parte', () => {
  const r = lerResposta(
    [
      'src/a.ts:16 | empate/ordem | `|| a.id - b.id` → ``',
      '- src/a.ts:21 | Borda/Vazio | `[0]` → `[0] ?? x`',
      'n/a | null/inválido | o diff não recebe entrada externa',
      'src/a.ts:abc | livre | sem número',
      'src/a.ts:3 | categoria-inventada | x',
      'src/a.ts:4 | livre |',
      'Aqui estão os mutantes:',
    ].join('\n'),
  )
  expect(r.mutantes).toEqual([
    { arquivo: 'src/a.ts', linha: 16, categoria: 'empate/ordem', mutacao: '`|| a.id - b.id` → ``' },
    { arquivo: 'src/a.ts', linha: 21, categoria: 'borda/vazio', mutacao: '`[0]` → `[0] ?? x`' },
  ])
  expect(r.naoAplicaveis).toEqual(['null/inválido: o diff não recebe entrada externa'])
  expect(r.ignoradas.length).toBe(4)
  // Uma categoria sem mutante e sem n/a é lacuna; com n/a, não.
  expect(lacunas(r.mutantes, r.naoAplicaveis)).toEqual(['condição invertida'])
  expect(lacunas([], [])).toEqual(['borda/vazio', 'empate/ordem', 'null/inválido', 'condição invertida'])
})

test('a linha do log segue o formato v1.1 e recusa registro incoerente', () => {
  const ok = { tarefa: 'mod x | y', aplicados: 7, mortos: 5, sobreviventes: 2, reais: 2, estado: 'FRACO' as const, tempo: 9.5 }
  expect(linhaLog(ok, '2026-10-14').linha).toBe('2026-10-14 | mod x / y | v1.2 | mutantes: 7/5/2 | reais: 2 | FRACO | 9.5 | instrumento: manual v1.2 | medição')
  // v1.2: o instrumento e a classe da rodada; o defeito do instrumento faz dela calibração (o | vira /).
  expect(linhaLog({ ...ok, instrumento: 'mod 0.3.0', defeitos: ['trecho | seta', 'alterado'] }, 'd').linha).toEndWith('| instrumento: mod 0.3.0 | calibração: trecho / seta; alterado')
  expect(linhaLog({ ...ok, instrumento: 'mod 0.3.0', defeitos: [] }, 'd').linha).toEndWith('| instrumento: mod 0.3.0 | medição')
  // Os equivalentes alegados vão na linha, para quem audita (0.6.0).
  expect(linhaLog({ ...ok, custo: 'base 1 s | x' }, 'd').linha).toEndWith('| medição | custo: base 1 s / x')
  expect(linhaLog({ ...ok, equivalentes: [{ n: 3, motivo: 'cwd | barra' }, { n: 5, motivo: 'x' }] }, 'd').linha).toEndWith('| medição | equivalentes: #3 cwd / barra; #5 x')
  expect(linhaLog({ ...ok, custo: 'base 1 s | x' }, 'd').linha).toEndWith('| medição | custo: base 1 s / x')
  expect(linhaLog({ ...ok, equivalentes: [] }, 'd').linha).toEndWith('| medição')
  expect(linhaLog({ ...ok, tarefa: ' ' }, 'd').erro).toContain('tarefa')
  expect(linhaLog({ ...ok, mortos: -1, sobreviventes: 8 }, 'd').erro).toContain('mortos')
  expect(linhaLog({ ...ok, mortos: 4 }, 'd').erro).toContain('aplicados')
  expect(linhaLog({ ...ok, estado: 'OK' as never }, 'd').erro).toContain('estado')
  expect(linhaLog({ ...ok, tempo: Number.NaN }, 'd').erro).toContain('tempo')
  expect(linhaLog({ ...ok, aplicados: 0, mortos: 0, sobreviventes: 0, estado: 'NÃO VERIFICADO' }, 'd').linha).toContain('0/0/0')
})

test('bordas achadas às cegas na rodada 2: renomeação, linha em branco, n/a sem motivo, linha sem número', () => {
  // Arquivo renomeado: vale o caminho novo.
  const renomeado = 'diff --git a/src/velho.ts b/src/novo.ts\nsimilarity index 90%\nrename from src/velho.ts\nrename to src/novo.ts\n--- a/src/velho.ts\n+++ b/src/novo.ts\n@@ -1 +1 @@\n+x\n'
  expect(separar(renomeado).fonte.map(b => b.arquivo)).toEqual(['src/novo.ts'])
  // Um arquivo renomeado para teste sai do envio pelo nome novo.
  expect(separar(renomeado.replaceAll('src/novo.ts', 'src/novo.test.ts')).excluidos).toEqual(['src/novo.test.ts'])
  const r = lerResposta('\n  \nsrc/a.ts: | livre | `x` → `y`\nn/a | empate/ordem |\nn/a | borda/vazio |   \nsrc/a.ts:2 | livre | `a` → `b`\n\n')
  // Linhas em branco não contam como fora do formato.
  expect(r.ignoradas).toEqual(['src/a.ts: | livre | `x` → `y`', 'n/a | empate/ordem |', 'n/a | borda/vazio |'])
  // n/a sem motivo não justifica a categoria; linha sem número não vira mutante.
  expect(r.naoAplicaveis).toEqual([])
  expect(r.mutantes.map(m => m.linha)).toEqual([2])
})

test('/prova lê pasta e base nos argumentos, em qualquer ordem', () => {
  expect(lerArgs('', '/home/u')).toEqual({})
  expect(lerArgs('HEAD~2', '/home/u')).toEqual({ base: 'HEAD~2' })
  expect(lerArgs('/data/projeto', '/home/u')).toEqual({ cwd: '/data/projeto' })
  expect(lerArgs('main ~/proj', '/home/u')).toEqual({ base: 'main', cwd: '/home/u/proj' })
  expect(lerArgs('~', '/home/u')).toEqual({ cwd: '/home/u' })
  expect(lerArgs('./sub origin/main', '/home/u')).toEqual({ cwd: './sub', base: 'origin/main' })
})

test('bordas do /prova achadas às cegas na rodada 3: ../, sem HOME, repetição', () => {
  expect(lerArgs('../irmao', '/home/u')).toEqual({ cwd: '../irmao' })
  // Sem HOME, ~ não vira uma pasta inventada.
  expect(lerArgs('~/proj', '')).toEqual({ cwd: '~/proj' })
  expect(lerArgs('~', '')).toEqual({ cwd: '~' })
  // Repetido, vale o último.
  expect(lerArgs('main HEAD~1', '/home/u')).toEqual({ base: 'HEAD~1' })
  expect(lerArgs('/a /b', '/home/u')).toEqual({ cwd: '/b' })
})

test('helper dentro da pasta de teste é código: a correção que mora nele pode ser mutada (projeto externo, rodada do operador)', () => {
  for (const f of ['test/helpers/chrome.js', 'tests/helper/db.py', '__tests__/utils/montar.ts', 'spec/support/server.rb', 'test/util/x.js'])
    expect(ehArquivoDeTeste(f)).toBe(false)
  for (const t of ['test/helpers/chrome.test.js', 'tests/support/test_db.py', 'test/library.js', 'tests/util.py'])
    expect(ehArquivoDeTeste(t)).toBe(true)
})

test('não-código não vai ao escolhedor: documentação, dotfiles e lockfiles saem e são listados', () => {
  const diff = ['src/a.js', '.gitignore', 'README.md', '.spec/f/design.md', 'package-lock.json', 'docs/x.txt', 'src/estilo.css', 'config.json'].map(f => bloco(f)).join('')
  const r = separar(diff)
  expect(r.fonte.map(b => b.arquivo)).toEqual(['src/a.js', 'src/estilo.css', 'config.json'])
  expect(r.naoCodigo).toEqual(['.gitignore', 'README.md', '.spec/f/design.md', 'package-lock.json', 'docs/x.txt'])
})

test('binário e bytecode não vão ao escolhedor: .pyc apagado do índice entrava como código (rodada no publico, 0.8.2)', () => {
  const apagado = (f: string) => `diff --git a/${f} b/${f}\ndeleted file mode 100644\nindex 1a2b3c4..0000000\nBinary files a/${f} and /dev/null differ\n`
  const diff = [
    apagado('publico/__pycache__/gerar.cpython-315.pyc'),
    // Binário com outro nome qualquer: vale o "Binary files" do git, não a extensão.
    'diff --git a/lib/nativo.so b/lib/nativo.so\nnew file mode 100755\nindex 0000000..1a2b3c4\nBinary files /dev/null and b/lib/nativo.so differ\n',
    'diff --git a/x.bin b/x.bin\nindex 1..2 100644\nGIT binary patch\nliteral 3\nKcmZ?l\n',
    'diff --git a/publico/gerar.py b/publico/gerar.py\n--- a/publico/gerar.py\n+++ b/publico/gerar.py\n@@ -1 +1 @@\n+x = 1\n',
  ].join('')
  const r = separar(diff)
  expect(r.fonte.map(b => b.arquivo)).toEqual(['publico/gerar.py'])
  expect(r.naoCodigo).toEqual(['publico/__pycache__/gerar.cpython-315.pyc', 'lib/nativo.so', 'x.bin'])
  // Pelo nome, mesmo quando o git mostra como texto: .pyo e o cache do numba dentro do __pycache__ (sobreviventes #8 e #17 da 0.8.3).
  const texto = (f: string) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -1 +1 @@\n+x\n`
  expect(separar(texto('pkg/m.cpython-315.opt-1.pyo') + texto('pkg/__pycache__/f.nbi') + texto('pkg/m.py')).naoCodigo).toEqual(['pkg/m.cpython-315.opt-1.pyo', 'pkg/__pycache__/f.nbi'])
  // O __pycache__ da raiz do repositório, sem pasta antes (sobrevivente #3 da 2ª lista da 0.8.3).
  expect(separar(texto('__pycache__/f.nbi')).naoCodigo).toEqual(['__pycache__/f.nbi'])
  // Texto que só cita a frase dentro de uma linha não é binário.
  expect(separar('diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n+m = "Binary files a and b differ"\n').fonte.length).toBe(1)
})

test('avisa quando a maior parte do envio está fora do git (código pré-existente nunca commitado)', () => {
  expect(avisoNovos(['src/a.js', 'src/b.js', 'src/c.js'], ['src/a.js', 'src/b.js', 'src/c.js', 'outro.js'])).toContain('3 de 3 arquivos enviados estão fora do git')
  expect(avisoNovos(['src/a.js', 'src/b.js', 'src/c.js'], ['src/a.js', 'src/b.js'])).toContain('novos: false')
  expect(avisoNovos(['src/a.js', 'src/b.js', 'src/c.js'], ['src/a.js'])).toBe('')
  expect(avisoNovos(['src/a.js', 'src/b.js'], [])).toBe('')
  expect(avisoNovos([], [])).toBe('')
})

test('v1.2: a rodada é calibração quando o instrumento falhou, foi alterado ou é o próprio diff', () => {
  expect(defeitosDoInstrumento({})).toEqual([])
  expect(defeitosDoInstrumento({ informado: '  ' })).toEqual([])
  expect(defeitosDoInstrumento({ informado: 'morte falsa' })).toEqual(['morte falsa'])
  expect(defeitosDoInstrumento({ alteraInstrumento: true })).toEqual(['o diff altera o próprio instrumento'])
  expect(defeitosDoInstrumento({ versaoNaExecucao: '0.3.0', versaoAgora: '0.3.0' })).toEqual([])
  expect(defeitosDoInstrumento({ versaoNaExecucao: '0.3.0', versaoAgora: '0.3.1' })).toEqual(['instrumento alterado na rodada: 0.3.0→0.3.1'])
  // Ordem fixa: o informado, o diff, a versão (rodada 8, #4).
  expect(defeitosDoInstrumento({ informado: 'x', alteraInstrumento: true, versaoNaExecucao: 'a', versaoAgora: 'b' })).toEqual([
    'x',
    'o diff altera o próprio instrumento',
    'instrumento alterado na rodada: a→b',
  ])
  // Execução gravada antes da v1.2 não tem versão: não é "alterado" (rodada 8, #6).
  expect(defeitosDoInstrumento({ versaoAgora: '0.4.0' })).toEqual([])
  expect(defeitosDoInstrumento({ versaoNaExecucao: '0.4.0' })).toEqual([])
})

test('v1.2: versão, instrumento e "o diff toca o mod" (rodada 8)', () => {
  expect(versaoDe('{"name":"p","version":"0.4.0"}')).toBe('0.4.0')
  expect(versaoDe('{"name":"p"}')).toBe('?')
  expect(versaoDe('{quebrado')).toBe('?')
  expect(instrumentoDe({ versao: '0.4.0' })).toBe('mod 0.4.0')
  expect(instrumentoDe({})).toBe('mod ?')
  expect(instrumentoDe(null)).toBeUndefined()
  const mod = '/m/prova-de-teste'
  expect(tocaOInstrumento('/m', ['contexto-bar/a.ts', 'prova-de-teste/hooks/b.ts'], mod)).toBe(true)
  expect(tocaOInstrumento('/m', ['contexto-bar/a.ts'], mod)).toBe(false)
  // Pasta vizinha com o mesmo começo não é o mod.
  expect(tocaOInstrumento('/m', ['prova-de-teste-velho/a.ts'], mod)).toBe(false)
  expect(tocaOInstrumento('/m', [], mod)).toBe(false)
  // Um clone do repositório dos mods fora da pasta do mod: vale o nome do plugin tocado (0.8.3: entrou como medição).
  expect(tocaOInstrumento('/tmp/x/r-prova-de-teste', ['prova-de-teste/hooks/b.ts'], mod, ['prova-de-teste'])).toBe(true)
  expect(tocaOInstrumento('/tmp/x/r', ['contexto-bar/a.ts'], mod, ['contexto-bar'])).toBe(false)
  // O nome do mod vem do manifesto dele; sem manifesto legível, o padrão.
  expect(tocaOInstrumento('/tmp/x', ['a.ts'], mod, ['outro-nome'], 'outro-nome')).toBe(true)
  expect(tocaOInstrumento('/tmp/x', ['a.ts'], mod, ['prova-de-teste'], undefined)).toBe(true)
  expect(nomeDe('{"name":"prova-de-teste"}')).toBe('prova-de-teste')
  expect(nomeDe('{"name":""}')).toBeUndefined()
  // Nome que não é texto, mesmo verdadeiro, não é nome.
  expect(nomeDe('{"name":5}')).toBeUndefined()
  expect(nomeDe('{"name":{"x":"prova-de-teste"}}')).toBeUndefined()
  expect(nomeDe('{"name":true}')).toBeUndefined()
  expect(nomeDe('{inválido')).toBeUndefined()
  expect(nomeDe('')).toBeUndefined()
})

test('o protocolo viaja com o mod e o cabeçalho do log novo traz o formato da versão atual (rodada 9)', () => {
  expect(protocoloEm('/mods/prova-de-teste')).toBe('/mods/prova-de-teste/PROTOCOLO.md')
  expect(CABECALHO_LOG).toContain('v1.2: `<data> | <tarefa>')
  expect(CABECALHO_LOG).toContain('instrumento: <mod x.y.z | manual> | <medição | calibração: defeito>')
})

test('mutante manual declarado: vai à linha do log com categoria, mutação e quem matou; malformado é recusado', () => {
  const ok = { tarefa: 't', aplicados: 3, mortos: 3, sobreviventes: 0, reais: 0, estado: 'PROVADO' as const, tempo: 1 }
  const m = { arquivo: 'hooks/a.ts', linha: 12, categoria: 'empate/ordem', mutacao: 'mover a linha | 13 acima', mortoPor: 'ordem do log' }
  expect(linhaLog({ ...ok, manuais: [m] }, 'd').linha).toEndWith('| medição | manuais: hooks/a.ts:12 empate/ordem mover a linha / 13 acima → morto por "ordem do log"')
  expect(linhaLog({ ...ok, manuais: [{ ...m, linha: undefined }, m] }, 'd').linha).toContain('manuais: hooks/a.ts empate/ordem')
  expect(linhaLog({ ...ok, manuais: [] }, 'd').linha).toEndWith('| medição')
  // Os números da linha continuam os da execução: o manual não entra em aplicados.
  expect(linhaLog({ ...ok, manuais: [m] }, 'd').linha).toContain('mutantes: 3/3/0')
  expect(validarManuais([m])).toBeUndefined()
  expect(validarManuais(undefined)).toBeUndefined()
  expect(validarManuais([{ ...m, categoria: 'outra' }])).toContain('categoria')
  expect(validarManuais([{ ...m, categoria: 'livre' }])).toBeUndefined()
  expect(validarManuais([{ ...m, mutacao: ' ' }])).toContain('#1')
  expect(validarManuais([m, { ...m, mortoPor: '' }])).toContain('#2')
  expect(validarManuais([{ ...m, arquivo: '' }])).toContain('arquivo')
  // Item nulo na lista (JSON malformado do agente): recusa, não quebra.
  expect(validarManuais([m, null as never])).toContain('#2: falta arquivo')
  expect(validarManuais([{ ...m, linha: 0 }])).toContain('linha')
  expect(validarManuais([{ ...m, linha: 1.5 }])).toContain('linha')
  expect(linhaLog({ ...ok, manuais: [{ ...m, mortoPor: ' ' }] }, 'd').erro).toContain('mortoPor')
})
