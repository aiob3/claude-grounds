import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const LOG_PATH = '/dados/experimentos/EXP-001-log.md'

const FORMATO = ['--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/']

const DIFF =
  'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n+export const soma = (a, b) => a + b\n' +
  'diff --git a/src/a.test.ts b/src/a.test.ts\n--- a/src/a.test.ts\n+++ b/src/a.test.ts\n@@ -1 +1 @@\n+expect(soma(1, 2)).toBe(3) // SEGREDO-DO-TESTE\n'

/** Um repositório falso: o que cada comando git devolve, e a lista dos chamados. */
function gitFalso(on: On, novos = "") {
  const chamados: string[][] = []
  on('process.run', (_$, e) => {
    const argv = (e as { argv: string[] }).argv
    chamados.push(argv)
    const a = argv.slice(1).filter(x => !FORMATO.includes(x)).join(' ')
    // O diff tem de vir no formato que o mod lê, qualquer que seja a configuração do git.
    if (argv[1] === 'diff') for (const f of FORMATO) if (!argv.includes(f)) throw new Error(`git diff sem ${f}`)
    const r = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (a === 'rev-parse --show-toplevel') return r('/repo\n')
    if (a === 'diff HEAD') return r(DIFF)
    if (a === 'ls-files --others --exclude-standard') return r(novos)
    if (a.startsWith('diff --no-index')) return r(`diff --git a/${argv.at(-1)} b/${argv.at(-1)}\n--- /dev/null\n+++ b/${argv.at(-1)}\n@@ -0,0 +1 @@\n+novo\n`, 1)
    if (a.startsWith('add') || a.startsWith('commit')) return r('')
    return r('', 1)
  })
  return chamados
}

test('a escolha às cegas manda ao modelo só o código-fonte, nunca o teste, e devolve a tabela com as lacunas', async ($, on) => {
  gitFalso(on, 'src/b.ts\nsrc/b.test.ts\n')
  on('session.cwd', () => ({ value: '/repo' }) as never)
  on('session.model', () => ({ value: 'opus' }) as never)
  let enviado = ''
  on('model.complete', (_$, e) => {
    enviado = JSON.stringify(e)
    return { value: { isAnswered: true, text: 'src/a.ts:1 | condição invertida | `a + b` → `a - b`\nn/a | empate/ordem | sem ordenação', usage: {} } } as never
  })
  const r = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__mutantes' } as never))
  expect(enviado).toContain('soma = (a, b)')
  expect(enviado).toContain('src/b.ts')
  expect(enviado).not.toContain('SEGREDO-DO-TESTE')
  expect(enviado).not.toContain('src/b.test.ts')
  expect(r).toContain('às cegas por opus')
  expect(r).toContain('Testes retirados antes do envio: src/a.test.ts, src/b.test.ts')
  expect(r).toContain('1 | src/a.ts:1 | condição invertida')
  expect(r).toContain('Categorias sem mutante nem justificativa: borda/vazio, null/inválido')
  // O protocolo citado é o que viaja com o mod, na pasta dele (rodada 9, #20).
  expect(r).toMatch(/Protocolo: \/[^ ]+\/PROTOCOLO\.md\./)
})

test('arquivos fora do git: entram no envio com aviso quando dominam; com novos false, ficam fora (projeto externo)', async ($, on) => {
  const chamados = gitFalso(on, 'src/n1.ts\nsrc/n2.ts\nREADME.md\n')
  on('session.cwd', () => ({ value: '/repo' }) as never)
  on('session.model', () => ({ value: 'opus' }) as never)
  const enviados: string[] = []
  on('model.complete', (_$, e) => {
    enviados.push(JSON.stringify(e))
    return { value: { isAnswered: true, text: 'src/a.ts:1 | livre | `a + b` → `a - b`', usage: {} } } as never
  })
  const r = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__mutantes' } as never))
  expect(enviados[0]).toContain('src/n1.ts')
  expect(enviados[0]).not.toContain('README.md')
  expect(r).toContain('Não-código fora do envio: README.md')
  expect(r).toContain('2 de 3 arquivos enviados estão fora do git (src/n1.ts, src/n2.ts)')
  const antes = chamados.length
  const sem = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__mutantes', novos: false } as never))
  expect(enviados[1]).not.toContain('src/n1.ts')
  expect(sem).not.toContain('fora do git')
  expect(chamados.slice(antes).some(a => a.includes('ls-files'))).toBe(false)
})

test('sem código-fonte alterado, não chama o modelo', async ($, on) => {
  on('process.run', (_$, e) => {
    const a = (e as { argv: string[] }).argv.slice(1).filter(x => !FORMATO.includes(x)).join(' ')
    const stdout = a === 'rev-parse --show-toplevel' ? '/repo\n' : a === 'diff HEAD' ? DIFF.slice(DIFF.indexOf('diff --git a/src/a.test.ts')) : ''
    return { value: { exitCode: 0, stdout, stderr: '' } } as never
  })
  on('session.cwd', () => ({ value: '/repo' }) as never)
  let chamou = false
  on('model.complete', () => {
    chamou = true
    return { value: { isAnswered: true, text: '', usage: {} } } as never
  })
  const r = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__mutantes' } as never))
  expect(chamou).toBe(false)
  expect(r).toContain('só testes: src/a.test.ts')
})

test('registrar acrescenta a linha ao log sem tocar nas anteriores e faz commit', async ($, on) => {
  mock.env(on, { PROVA_DE_TESTE_LOG: LOG_PATH })
  const chamados = gitFalso(on)
  let escrito = ''
  on('fs.exists', () => ({ value: true }) as never)
  on('fs.read', () => ({ value: '# log\nlinha antiga' }) as never)
  on('fs.write', (_$, e) => {
    escrito = (e as { text: string }).text
    return { value: undefined } as never
  })
  const r = JSON.stringify(
    await $.tool.call({
      tool: 'mcp__prova-de-teste__registrar',
      tarefa: 'rodada 2',
      aplicados: 6,
      mortos: 6,
      sobreviventes: 0,
      reais: 0,
      estado: 'PROVADO',
      tempo: 12,
    } as never),
  )
  expect(escrito.startsWith('# log\nlinha antiga\n')).toBe(true)
  expect(escrito).toMatch(/\| rodada 2 \| v1\.2 \| mutantes: 6\/6\/0 \| reais: 0 \| PROVADO \| 12 \| instrumento: manual v1\.2 \| medição\n$/)
  // O defeito do instrumento informado faz da rodada calibração.
  const cal = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__registrar', tarefa: 'rodada 3', aplicados: 1, mortos: 1, sobreviventes: 0, reais: 0, estado: 'PROVADO', tempo: 1, defeitoInstrumento: 'morte falsa' } as never))
  expect(cal).toContain('| instrumento: manual v1.2 | calibração: morte falsa')
  expect(chamados.some(a => a[1] === 'commit')).toBe(true)
  expect(r).toContain('commit no git do harness')
  // Registro incoerente não grava nada.
  escrito = ''
  const ruim = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__registrar', tarefa: 'x', aplicados: 3, mortos: 1, sobreviventes: 1, reais: 0, estado: 'FRACO', tempo: 1 } as never))
  expect(escrito).toBe('')
  expect(ruim).toContain('aplicados')
})

test('editar um arquivo de teste lembra o protocolo uma vez por turno; arquivo comum não', async ($, on) => {
  let turno = 1
  on('session.turns', () => ({ value: turno }) as never)
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  const editar = async (file_path: string) =>
    JSON.stringify(await $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' } as never))
  expect(await editar('/repo/src/a.ts')).not.toContain('[prova-de-teste]')
  expect(await editar('/repo/src/a.test.ts')).toContain('[prova-de-teste]')
  expect(await editar('/repo/src/b.test.ts')).not.toContain('[prova-de-teste]')
  turno = 2
  expect(await editar('/repo/src/b.test.ts')).toContain('EXP-001 v1.2: leia ')
})

test('/prova com pasta usa essa pasta; fora de um repositório, a mensagem ensina a passar a pasta', async ($, on) => {
  const pastas: string[] = []
  on('process.run', (_$, e) => {
    const { argv, init } = e as { argv: string[]; init?: { cwd?: string } }
    pastas.push(init?.cwd ?? '')
    const a = argv.slice(1).filter(x => !FORMATO.includes(x)).join(' ')
    if (a === 'rev-parse --show-toplevel') return { value: init?.cwd === '/repo' ? { exitCode: 0, stdout: '/repo\n', stderr: '' } : { exitCode: 128, stdout: '', stderr: 'not a git repository' } } as never
    if (a === 'diff HEAD') return { value: { exitCode: 0, stdout: DIFF.slice(0, DIFF.indexOf('diff --git a/src/a.test.ts')), stderr: '' } } as never
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('session.cwd', () => ({ value: '/home/u/Work' }) as never)
  on('session.model', () => ({ value: 'opus' }) as never)
  on('env.get', () => ({ value: '/home/u' }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: 'src/a.ts:1 | livre | `+` → `-`', usage: {} } }) as never)
  const fora = JSON.stringify(await $.command.run({ command: 'prova', args: '' } as never))
  expect(fora).toContain('/home/u/Work não é um repositório git')
  expect(fora).toContain('/prova <pasta do repositório>')
  const dentro = JSON.stringify(await $.command.run({ command: 'prova', args: '/repo' } as never))
  expect(pastas).toContain('/repo')
  expect(dentro).toContain('às cegas por opus')
  // Diff sem nenhum teste: avisa que o EXP-001 não tem o que provar.
  expect(dentro).toContain('Nenhum arquivo de teste no diff')
})

test('o aviso "sem teste" some com um teste só; HOME ausente ou com falha não derruba o /prova', async ($, on) => {
  const umTeste = DIFF // um arquivo-fonte e exatamente um de teste
  on('process.run', (_$, e) => {
    const { argv } = e as { argv: string[] }
    const a = argv.slice(1).filter(x => !FORMATO.includes(x)).join(' ')
    const stdout = a === 'rev-parse --show-toplevel' ? '/repo\n' : a === 'diff HEAD' ? umTeste : ''
    return { value: { exitCode: 0, stdout, stderr: '' } } as never
  })
  on('session.cwd', () => ({ value: '/repo' }) as never)
  on('session.model', () => ({ value: 'opus' }) as never)
  on('env.get', () => {
    throw new Error('sem env')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: 'src/a.ts:1 | livre | `+` → `-`', usage: {} } }) as never)
  const r = JSON.stringify(await $.command.run({ command: 'prova', args: '' } as never))
  expect(r).toContain('às cegas por opus')
  expect(r).toContain('Testes retirados antes do envio: src/a.test.ts')
  expect(r).not.toContain('Nenhum arquivo de teste no diff')
})

test('sem HOME, /prova ~/pasta não inventa uma pasta', async ($, on) => {
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repository' } }) as never)
  on('session.cwd', () => ({ value: '/repo' }) as never)
  on('env.get', () => ({ value: undefined }) as never)
  const r = JSON.stringify(await $.command.run({ command: 'prova', args: '~/proj' } as never))
  expect(r).toContain('~/proj não é um repositório git')
  expect(r).not.toContain('undefined')
})

/** Um repositório em memória: git, cópia, comando de teste e sistema de arquivos. */
function mundo(on: On, o: { baseFalha?: boolean; pluginNaRaiz?: boolean; quebra?: boolean; versao?: { v: string } } = {}) {
  const fs = new Map<string, string>([
    ['/repo/src/a.ts', 'export const soma = (a, b) => a + b\n'],
    ['/repo/src/a.test.ts', "import { soma } from './a'\nexpect(soma(1, 2)).toBe(3)\n"],
    // Um módulo com o teste dele, que não alcança a.ts: a execução incremental o esconde nos mutantes de a.ts.
    ['/repo/src/b.ts', 'export const um = 1\n'],
    ['/repo/src/b.test.ts', "import { um } from './b.js'\nexpect(um).toBe(1)\n"],
    o.pluginNaRaiz ? ['/repo/.claude-plugin/plugin.json', '{"name":"x"}'] : ['/repo/package.json', '{"scripts":{"test":"vitest run"}}'],
  ])
  const apagadas: string[] = []
  const sobrouEscondido: string[] = []
  const rodadas: string[][] = []
  const modelo = { chamadas: 0 }
  const TMP = '/tmp/prova-de-teste-abc'
  mock.env(on, { PROVA_DE_TESTE_LOG: LOG_PATH })
  on('process.run', (_$, e) => {
    const { argv, init } = e as { argv: string[]; init?: { cwd?: string } }
    const r = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    const a = argv.slice(1).filter(x => !FORMATO.includes(x)).join(' ')
    if (argv[0] === 'git') {
      if (a === 'rev-parse --show-toplevel') return r('/repo\n')
      if (a === 'diff HEAD') return r(DIFF)
      if (a === 'status --porcelain') return r(' M src/a.ts\n')
      if (a === 'ls-files --cached --others --exclude-standard') return r('src/a.ts\nsrc/a.test.ts\nsrc/b.ts\nsrc/b.test.ts\n')
      if (a === 'ls-tree -r -l HEAD') return r('100644 blob aaa     30\tsrc/a.ts\n100644 blob bbb     2018\tsrc/a.test.ts\n')
      return r('')
    }
    if (argv[0] === 'mktemp') return r(`${TMP}\n`)
    if (argv[0] === 'cp') {
      for (const [k, v] of [...fs]) if (k.startsWith('/repo/')) fs.set(`${TMP}/repo/${k.slice(6)}`, v)
      return r('')
    }
    if (argv[0] === 'sh') {
      // O for/mv do executor: renomeia cada arquivo com o sufixo indicado no script.
      const [de, para] = /mv -- "\$f(.*?)" "\$f(.*?)"/.exec(argv[2]!)!.slice(1) as [string, string]
      for (const f of argv.slice(4)) {
        const k = `${init?.cwd}/${f}`
        fs.set(k + para, fs.get(k + de)!)
        fs.delete(k + de)
      }
      return r('')
    }
    if (argv[0] === 'rm') {
      sobrouEscondido.push(...[...fs.keys()].filter(k => k.endsWith('.prova-fora')))
      apagadas.push(argv.at(-1)!)
      for (const k of [...fs.keys()]) if (k.startsWith(argv.at(-1)!)) fs.delete(k)
      return r('')
    }
    if (argv[0] === 'npm' || argv[0] === 'claude') {
      rodadas.push([...argv, init?.cwd ?? ''])
      // O teste falso só pega a troca de + por -.
      const fonte = fs.get(`${TMP}/repo/src/a.ts`) ?? ''
      if (o.baseFalha) return r('  ✕ soma dá 3 (1 ms)\n', 1)
      if (fonte.includes('=> a +\n')) return r("(fail) the file did not load\n\nSyntaxError: Unexpected token '\\n'\n", 1)
      // Só os testes visíveis rodam; o de a.ts só pega a troca de + por -.
      const visiveis = [...fs.keys()].filter(k => k.startsWith(`${TMP}/repo/`) && k.endsWith('.test.ts'))
      const total = `Tests:  ${visiveis.length} total\n`
      const pega = visiveis.includes(`${TMP}/repo/src/a.test.ts`) && fonte.includes('a - b')
      return pega ? r(`  ✕ soma dá 3 (1 ms)\n${total}`, 1) : r(`  ✓ soma dá 3\n${total}`)
    }
    return r('', 127)
  })
  on('fs.exists', (_$, e) => ({ value: fs.has((e as { path: string }).path) }) as never)
  on('fs.read', (_$, e) => {
    const p = (e as { path: string }).path
    // O plugin.json do próprio mod (fora do repositório falso): a versão que o teste controla.
    if (o.versao && !fs.has(p) && p.endsWith('/.claude-plugin/plugin.json')) return { value: JSON.stringify({ version: o.versao.v }) } as never
    return { value: fs.get(p) ?? '' } as never
  })
  on('fs.write', (_$, e) => {
    const { path, text } = e as { path: string; text: string }
    fs.set(path, text)
    return { value: undefined } as never
  })
  on('session.cwd', () => ({ value: '/repo' }) as never)
  on('session.model', () => ({ value: 'opus' }) as never)
  on('model.complete', () =>
    (modelo.chamadas++, {
      value: {
        isAnswered: true,
        usage: {},
        text: [
          // Caminho curto, como o modelo devolveu na 1ª execução real: tem de ser aplicado mesmo assim.
          'a.ts:1 | condição invertida | `a + b` → `a - b`',
          'src/a.ts:1 | null/inválido | `(a, b) => a + b` → `(a, b) => b + a`',
          'src/a.ts:1 | livre | `não existe` → `x`',
          ...(o.quebra ? ['src/a.ts:1 | borda/vazio | `=> a + b` → `=> a +`'] : []),
          'n/a | borda/vazio | sem listas',
          'n/a | empate/ordem | sem ordenação',
        ].join('\n'),
      },
    }) as never,
  )
  return { fs, apagadas, rodadas, TMP, modelo, sobrouEscondido }
}

test('executar: copia, roda a base, aplica pelo trecho, mata e deixa sobreviver de verdade, restaura e não toca o original', async ($, on) => {
  const m = mundo(on)
  const original = m.fs.get('/repo/src/a.ts')
  const r = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 'soma' } as never))
  // npm test detectado pelo package.json, rodado na cópia: base, o morto só com o teste que alcança a.ts,
  // o sobrevivente com esse teste e depois confirmado na suíte inteira.
  expect(m.rodadas.length).toBe(4)
  expect(r).toContain('MORTO por \\"soma dá 3\\" [incremental: 1/2 arquivos de teste]')
  expect(r).toContain('SOBREVIVENTE → reforçar ou justificar como equivalente [incremental: 1/2 arquivos de teste, sobrevivente confirmado na suíte inteira]')
  // Nenhum teste fica escondido na cópia, e a restauração confere.
  expect(m.sobrouEscondido).toEqual([])
  expect(r).toContain('cmp na cópia: idêntico')
  expect(m.rodadas.every(x => x.at(-1) === `${m.TMP}/repo`)).toBe(true)
  expect(r).toContain('1 | src/a.ts:1 | condição invertida | `a + b` → `a - b` | MORTO por \\"soma dá 3\\"')
  expect(r).toContain('2 | src/a.ts:1 | null/inválido')
  expect(r).toContain('SOBREVIVENTE → reforçar')
  expect(r).toContain('NÃO APLICADO: trecho original não encontrado')
  expect(r).toContain('Mutantes:   2 aplicados | 1 mortos | 1 sobreviventes | 1 não aplicados')
  expect(r).toContain('Estado:     FRACO')
  expect(r).toContain('original ✔ intocado')
  expect(m.fs.get('/repo/src/a.ts')).toBe(original)
  // A pasta temporária foi apagada, e só ela.
  expect(m.apagadas).toEqual([m.TMP])

  // registrar: números diferentes da execução são recusados; os executados passam; a execução vale uma vez.
  m.fs.set(LOG_PATH, '# log\n')
  const inventado = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__registrar', tarefa: 'soma', aplicados: 2, mortos: 2, sobreviventes: 0, reais: 0, estado: 'PROVADO', tempo: 5 } as never))
  expect(inventado).toContain('não batem com a última execução do mod (2/1/1')
  expect(m.fs.get(LOG_PATH)).toBe('# log\n')
  const certo = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__registrar', tarefa: 'soma', aplicados: 2, mortos: 1, sobreviventes: 1, reais: 1, estado: 'FRACO', tempo: 5 } as never))
  expect(certo).toContain('mutantes: 2/1/1')
  expect(m.fs.get(LOG_PATH)).toContain('| soma | v1.2 | mutantes: 2/1/1 | reais: 1 | FRACO | 5 | instrumento: mod ')
  // O custo medido pelo mod vai ao relatório e ao log, sem o agente informar nada.
  // Base com os 2 testes; por mutante (1 + (1 + 2)) / 2 = 2.
  expect(r).toMatch(/Custo:      base \d+\.\d s, 2 testes; por mutante \d+\.\d s, 2 testes \(n=2, 2 incrementais\); repositório 2 arquivos, 2 KB; diff \d+ linhas em 1 arquivos/)
  expect(m.fs.get(LOG_PATH)).toMatch(/\| custo: base \d+\.\d s, 2 testes; .*repositório 2 arquivos/)
  // Gasta no registro: o próximo não fica preso aos números dela (sobrevivente #16 da rodada 5).
  const depois = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__registrar', tarefa: 'soma', aplicados: 3, mortos: 3, sobreviventes: 0, reais: 0, estado: 'PROVADO', tempo: 5 } as never))
  expect(depois).toContain('mutantes: 3/3/0')
})

test('executar com incremental false roda a suíte inteira em todos os mutantes, sem esconder nada', async ($, on) => {
  const m = mundo(on)
  const r = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 'soma', incremental: false } as never))
  expect(m.rodadas.length).toBe(3)
  expect(r).toContain('MORTO por \\"soma dá 3\\" [suíte inteira (sem mapa de imports)]')
  expect(r).toMatch(/por mutante \d+\.\d s, 2 testes \(n=2, 0 incrementais\)/)
  expect(m.sobrouEscondido).toEqual([])
})

test('executar: com a linha de base vermelha, nenhum mutante é aplicado e o estado é NÃO VERIFICADO', async ($, on) => {
  const m = mundo(on, { baseFalha: true })
  const r = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 'soma' } as never))
  expect(m.rodadas.length).toBe(1)
  expect(r).toContain('linha de base FALHOU')
  expect(r).toContain('Estado:     NÃO VERIFICADO')
  expect(r).toContain('Saída da linha de base')
  expect(m.apagadas).toEqual([m.TMP])
})

test('executar: plugin na raiz do repositório é achado e testado na raiz da cópia (sobrevivente #4 da 3ª execução da rodada 4)', async ($, on) => {
  const m = mundo(on, { pluginNaRaiz: true })
  const r = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 'soma' } as never))
  expect(m.rodadas[0]!.slice(0, 4)).toEqual(['claude', 'plugin', 'test', `${m.TMP}/repo`])
  expect(r).toContain('Comando:    claude plugin test <cópia>')
  expect(r).toContain('MORTO por')
})

test('executar com repetir reaplica a mesma lista, sem chamar o modelo de novo', async ($, on) => {
  const m = mundo(on)
  const sem = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 's', repetir: true } as never))
  expect(sem).toContain('não há lista anterior')
  const primeira = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 's' } as never))
  const segunda = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 's', repetir: true } as never))
  expect(m.modelo.chamadas).toBe(1)
  // Mesma lista, mesmos mutantes nas mesmas posições.
  const tabelaDe = (t: string) => t.slice(t.indexOf('Mutantes:'), t.indexOf('Categorias:'))
  expect(tabelaDe(segunda)).toBe(tabelaDe(primeira))
})

test('executar: o mutante que não carrega diz o erro de carga no relatório (rodada 7, #21)', async ($, on) => {
  mundo(on, { quebra: true })
  const r = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 'soma' } as never))
  expect(r).toContain('NÃO APLICADO: mutante inválido: o código mutado não carregou (SyntaxError: Unexpected token')
})

test('registrar v1.2: o mod que muda de versão entre executar e registrar faz da rodada calibração (rodada 8, #15)', async ($, on) => {
  const versao = { v: '0.4.0' }
  const m = mundo(on, { versao })
  await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 'soma' } as never)
  m.fs.set(LOG_PATH, '# log\n')
  versao.v = '0.4.1'
  await $.tool.call({ tool: 'mcp__prova-de-teste__registrar', tarefa: 'soma', aplicados: 2, mortos: 1, sobreviventes: 1, reais: 1, estado: 'FRACO', tempo: 5 } as never)
  expect(m.fs.get(LOG_PATH)).toContain('| instrumento: mod 0.4.0 | calibração: instrumento alterado na rodada: 0.4.0→0.4.1')
})

test('registrar sem PROVA_DE_TESTE_LOG: cria o log padrão com cabeçalho; num link, grava e commita no arquivo real (repositório público)', async ($, on) => {
  const chamados = gitFalso(on)
  mock.env(on, { HOME: '/home/u' })
  const fs = new Map<string, string>()
  const links = new Map<string, string>()
  on('fs.exists', (_$, e) => ({ value: fs.has((e as { path: string }).path) }) as never)
  on('fs.stat', (_$, e) => {
    const p = (e as { path: string }).path
    return { value: { kind: 'file', size: 0, mtimeMs: 0, isLink: links.has(p), realPath: links.get(p) ?? p } } as never
  })
  on('fs.read', (_$, e) => ({ value: fs.get((e as { path: string }).path) ?? '' }) as never)
  on('fs.write', (_$, e) => {
    const { path, text } = e as { path: string; text: string }
    fs.set(path, text)
    return { value: undefined } as never
  })
  const reg = (tarefa: string) =>
    $.tool.call({ tool: 'mcp__prova-de-teste__registrar', tarefa, aplicados: 1, mortos: 1, sobreviventes: 0, reais: 0, estado: 'PROVADO', tempo: 1 } as never)
  const padrao = '/home/u/.claude/prova-de-teste/EXP-001-log.md'
  const r = JSON.stringify(await reg('primeira'))
  expect(fs.get(padrao)!.startsWith('# EXP-001')).toBe(true)
  expect(fs.get(padrao)).toContain('| primeira | v1.2 |')
  expect(r).toContain(`Gravado em ${padrao}:`)
  expect(r).not.toContain('(→')
  // O caminho padrão é um link: a linha vai ao arquivo real e o commit roda na pasta dele.
  fs.clear()
  fs.set('/dados/exp/EXP-001-log.md', '# log real\n')
  links.set(padrao, '/dados/exp/EXP-001-log.md')
  const antes = chamados.length
  expect(JSON.stringify(await reg('segunda'))).toContain(`Gravado em ${padrao} (→ /dados/exp/EXP-001-log.md)`)
  expect(fs.get('/dados/exp/EXP-001-log.md')).toContain('| segunda |')
  expect(fs.has(padrao)).toBe(false)
  expect(chamados.slice(antes).some(a => a[1] === 'commit' && a.includes('/dados/exp/EXP-001-log.md'))).toBe(true)
  // O log novo precisa entrar no git antes do commit (rodada 9, #18 manual).
  expect(chamados.slice(antes).some(a => a[1] === 'add' && a.includes('/dados/exp/EXP-001-log.md'))).toBe(true)
})

test('registrar sem HOME nem PROVA_DE_TESTE_LOG não inventa um caminho', async ($, on) => {
  gitFalso(on)
  mock.env(on, {})
  let escreveu = false
  on('fs.write', () => ((escreveu = true), { value: undefined }) as never)
  const r = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__registrar', tarefa: 'x', aplicados: 1, mortos: 1, sobreviventes: 0, reais: 0, estado: 'PROVADO', tempo: 1 } as never))
  expect(r).toContain('PROVA_DE_TESTE_LOG')
  expect(escreveu).toBe(false)
})

test('registrar: a variável vence o HOME; vazia, vale o padrão; HOME que falha não derruba (rodada 9)', async ($, on) => {
  gitFalso(on)
  const env: Record<string, string | Error> = { PROVA_DE_TESTE_LOG: '/meu/log.md', HOME: '/home/u' }
  on('env.get', (_$, e) => {
    const v = env[(e as { name: string }).name]
    if (v instanceof Error) throw v
    return { value: v } as never
  })
  const escritos: string[] = []
  on('fs.exists', () => ({ value: false }) as never)
  on('fs.write', (_$, e) => (escritos.push((e as { path: string }).path), { value: undefined }) as never)
  const reg = () =>
    $.tool.call({ tool: 'mcp__prova-de-teste__registrar', tarefa: 't', aplicados: 1, mortos: 1, sobreviventes: 0, reais: 0, estado: 'PROVADO', tempo: 1 } as never)
  await reg()
  expect(escritos.at(-1)).toBe('/meu/log.md')
  env.PROVA_DE_TESTE_LOG = ''
  await reg()
  expect(escritos.at(-1)).toBe('/home/u/.claude/prova-de-teste/EXP-001-log.md')
  env.HOME = new Error('env fora')
  const r = JSON.stringify(await reg())
  expect(r).toContain('PROVA_DE_TESTE_LOG')
  expect(escritos).toHaveLength(2)
})

test('registrar 0.6.0: estado acima do executado exige justificar cada sobrevivente, e as justificativas vão ao log', async ($, on) => {
  const m = mundo(on)
  await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 'soma' } as never)
  m.fs.set(LOG_PATH, '# log\n')
  const base = { tool: 'mcp__prova-de-teste__registrar', tarefa: 'soma', aplicados: 2, mortos: 1, sobreviventes: 1, reais: 0, tempo: 5 }
  const sem = JSON.stringify(await $.tool.call({ ...base, estado: 'PROVADO-PARCIAL' } as never))
  expect(sem).toContain('sem justificativa: #2')
  expect(m.fs.get(LOG_PATH)).toBe('# log\n')
  const com = JSON.stringify(await $.tool.call({ ...base, estado: 'PROVADO', equivalentes: [{ n: 2, motivo: 'soma comuta' }] } as never))
  expect(com).toContain('equivalentes: #2 soma comuta')
  expect(m.fs.get(LOG_PATH)).toContain('| PROVADO | 5 | instrumento: mod ')
})
