import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { logDoProjeto } from './prova'

type On = Parameters<TestBody>[1]

const LOG_PATH = '/dados/experimentos/EXP-001-log.md'

const FORMATO = ['--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/']

const DIFF_PY = 'diff --git a/src/calc.py b/src/calc.py\n--- a/src/calc.py\n+++ b/src/calc.py\n@@ -1 +1,2 @@\n+def dobro(x):\n+    return x * 2\n'

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
  expect(r).toContain('commit no repositório do log')
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
function mundo(on: On, o: { baseFalha?: boolean; pluginNaRaiz?: boolean; quebra?: boolean; versao?: { v: string }; python?: boolean; pycVelho?: boolean; rmFalha?: boolean; leRepo?: boolean; nomeDoPlugin?: string; venvEditavel?: boolean; sobrescreverFalha?: boolean; cwdSessao?: string; nucleos?: string; statusMuda?: boolean; vaza?: boolean; disputa?: boolean; lento?: boolean; cpFalhaEm?: string } = {}) {
  const fs = new Map<string, string>(o.python ? [
    ['/repo/pyproject.toml', '[tool.pytest.ini_options]\n'],
    ['/repo/src/calc.py', 'def dobro(x):\n    return x * 2\n'],
    ['/repo/src/test_calc.py', 'from calc import dobro\nassert dobro(3) == 6\n'],
    // O .pyc que veio do original e não é validado pelo fonte (unchecked-hash): vale para qualquer tamanho.
    // O venv do projeto com a instalação editável: o .pth e o shebang apontam para o original.
    ...(o.venvEditavel
      ? ([
          ['/repo/.venv/pyvenv.cfg', 'home = /usr/bin\n'],
          ['/repo/.venv/lib/python3.15/site-packages/_calc.pth', '/repo/src\n'],
          ['/repo/.venv/bin/pytest', '#!/repo/.venv/bin/python\nimport pytest\n'],
          ['/repo/.venv/lib/python3.15/site-packages/vizinho.pth', '/repository/src\n'],
          // Um link na cópia: escrever nele escreveria no alvo.
          ['/repo/.venv/bin/ligado', '#!/repo/.venv/bin/python\n'],
          // Listado, mas o stat falha (sumiu ou não dá para ler): sem saber o que é, não se escreve nele.
          ['/repo/.venv/bin/sumido', '#!/repo/.venv/bin/python\n'],
        ] as [string, string][])
      : []),
    ...(o.pycVelho ? [['/repo/src/__pycache__/calc.cpython-315.pyc', JSON.stringify({ tamanho: null, codigo: 'def dobro(x):\n    return x * 2\n' })] as [string, string]] : []),
  ] : [
    ['/repo/src/a.ts', 'export const soma = (a, b) => a + b\n'],
    // Por alias do tsconfig: sem ler os aliases, nenhum teste alcançaria a.ts (rodada 0.8.1, #13).
    ['/repo/src/a.test.ts', "import { soma } from '@/a'\nexpect(soma(1, 2)).toBe(3)\n"],
    ['/repo/tsconfig.json', '{ "compilerOptions": { "paths": { "@/*": ["src/*"] } } }'],
    // Um módulo com o teste dele, que não alcança a.ts: a execução incremental o esconde nos mutantes de a.ts.
    ['/repo/src/b.ts', 'export const um = 1\n'],
    ['/repo/src/b.test.ts', "import { um } from './b.js'\nexpect(um).toBe(1)\n"],
    o.pluginNaRaiz ? ['/repo/.claude-plugin/plugin.json', JSON.stringify({ name: o.nomeDoPlugin ?? 'x' })] : ['/repo/package.json', '{"scripts":{"test":"vitest run"}}'],
  ])
  const apagadas: string[] = []
  const sobrouEscondido: string[] = []
  const rodadas: string[][] = []
  const ambientes: (Record<string, string> | undefined)[] = []
  const sobrescritos = new Map<string, string>()
  const modelo = { chamadas: 0 }
  const conc = { agora: 0, max: 0, status: 0 }
  const TMP = '/tmp/prova-de-teste-abc'
  // Com a pasta da sessão em outro lugar, sem log fixo: o destino sai da raiz da execução (isolamento, 0.11.0).
  mock.env(on, o.cwdSessao ? { HOME: '/h' } : { PROVA_DE_TESTE_LOG: LOG_PATH })
  on('process.run', (_$, e) => {
    const { argv, init } = e as { argv: string[]; init?: { cwd?: string; env?: Record<string, string> } }
    const r = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    const a = argv.slice(1).filter(x => !FORMATO.includes(x)).join(' ')
    if (argv[0] === 'git') {
      if (a === 'rev-parse --show-toplevel') return r('/repo\n')
      // O log padrão mora no mesmo repositório da rodada (/repo): isolamento por projeto (0.11.0).
      if (a === 'rev-parse --path-format=absolute --git-common-dir') return ['/repo', '/h/.claude/prova-de-teste'].includes(init?.cwd ?? '') ? r('/repo/.git\n') : r('', 128)
      if (a === 'diff HEAD') return r(o.python ? DIFF_PY : DIFF)
      if (a === 'status --porcelain') return r(o.statusMuda && conc.status++ > 0 ? '' : ' M src/a.ts\n')
      if (a === 'ls-files --cached --others --exclude-standard' && o.python) return r('pyproject.toml\nsrc/calc.py\nsrc/test_calc.py\n')
      if (a === 'ls-files --cached --others --exclude-standard') return r('src/a.ts\nsrc/a.test.ts\nsrc/b.ts\nsrc/b.test.ts\ntsconfig.json\n')
      if (a === 'ls-tree -r -l HEAD') return r('100644 blob aaa     30\tsrc/a.ts\n100644 blob bbb     2018\tsrc/a.test.ts\n')
      return r('')
    }
    if (argv[0] === 'mktemp') return r(`${TMP}\n`)
    if (argv[0] === 'nproc') return o.nucleos ? r(`${o.nucleos}\n`) : r('', 127)
    if (argv[0] === 'cp') {
      if (o.cpFalhaEm && argv.at(-1)!.endsWith(o.cpFalhaEm)) return { value: { exitCode: 1, stdout: '', stderr: 'cp: sem espaço' } } as never
      for (const [k, v] of [...fs]) if (k.startsWith('/repo/')) fs.set(`${argv.at(-1)}/${k.slice(6)}`, v)
      return r('')
    }
    if (argv[0] === 'sh' && argv[2]!.includes('pyvenv.cfg')) {
      // ACHAR_NO_VENV: os arquivos do venv da cópia que citam a raiz.
      const achados = [...fs.keys()].filter(k => k.startsWith(`${init?.cwd}/.venv/`) && /\/(bin\/[^/]+|site-packages\/[^/]+\.pth)$/.test(k) && fs.get(k)!.includes(argv[4]!))
      return r(achados.map(k => `${k.slice(init!.cwd!.length + 1)}\n`).join(''))
    }
    if (argv[0] === 'sh' && argv[2]!.startsWith('cat ')) {
      if (o.sobrescreverFalha) return { value: { exitCode: 1, stdout: '', stderr: 'sh: permissão negada' } } as never
      fs.set(argv[5]!, fs.get(argv[4]!)!)
      sobrescritos.set(argv[5]!, fs.get(argv[4]!)!)
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
    if (argv[0] === 'rm' && o.rmFalha && argv.some(x => x.endsWith('__pycache__'))) {
      return { value: { exitCode: 1, stdout: '', stderr: 'rm: permissão negada' } } as never
    }
    if (argv[0] === 'rm') {
      sobrouEscondido.push(...[...fs.keys()].filter(k => k.endsWith('.prova-fora')))
      apagadas.push(argv.at(-1)!)
      for (const k of [...fs.keys()]) if (k.startsWith(argv.at(-1)!)) fs.delete(k)
      return r('')
    }
    if (argv[0] === 'python3') {
      rodadas.push([...argv, init?.cwd ?? ''])
      ambientes.push(init?.env)
      // O CPython no pior caso, tudo no mesmo segundo: o .pyc vale quando o tamanho do fonte bate (ou quando não é validado).
      // Com o venv, o import segue o .pth: o código que roda é o da pasta para onde ele aponta.
      const pth = fs.get(`${TMP}/repo/.venv/lib/python3.15/site-packages/_calc.pth`)
      const fonte = fs.get(`${pth ? pth.trim() : `${TMP}/repo/src`}/calc.py`) ?? ''
      const pyc = `${TMP}/repo/src/__pycache__/calc.cpython-315.pyc`
      const salvo = fs.has(pyc) ? (JSON.parse(fs.get(pyc)!) as { tamanho: number | null; codigo: string }) : undefined
      const valido = salvo && (salvo.tamanho === null || salvo.tamanho === fonte.length)
      if (!valido && init?.env?.PYTHONDONTWRITEBYTECODE !== '1') fs.set(pyc, JSON.stringify({ tamanho: fonte.length, codigo: fonte }))
      return (valido ? salvo.codigo : fonte).includes('x + 2')
        ? r('FAILED src/test_calc.py::test_dobro - assert 5 == 6\n1 failed in 0.01s\n', 1)
        : r('1 passed in 0.01s\n')
    }
    if (argv[0] === 'npm' || argv[0] === 'claude') {
      rodadas.push([...argv, init?.cwd ?? ''])
      ambientes.push(init?.env)
      // O teste falso só pega a troca de + por -; lê a cópia em que roda.
      const dir = init?.cwd ?? `${TMP}/repo`
      const fonte = fs.get(`${dir}/src/a.ts`) ?? ''
      if (o.baseFalha) return r('  ✕ soma dá 3 (1 ms)\n', 1)
      // Um teste que lê a árvore do repositório (o SaidaReal do publico): sem os testes escondidos, falha sem mutante nenhum.
      if (o.leRepo && [...fs.keys()].some(k => k.endsWith('.prova-fora'))) return r('  ✕ lê o repositório (1 ms)\nTests:  1 total\n', 1)
      if (fonte.includes('=> a +\n')) return r("(fail) the file did not load\n\nSyntaxError: Unexpected token '\\n'\n", 1)
      // Só os testes visíveis rodam; o de a.ts só pega a troca de + por -.
      const visiveis = [...fs.keys()].filter(k => k.startsWith(`${dir}/`) && k.endsWith('.test.ts'))
      const total = `Tests:  ${visiveis.length} total\n`
      const pega = visiveis.includes(`${dir}/src/a.test.ts`) && fonte.includes('a - b')
      const res = pega ? r(`  ✕ soma dá 3 (1 ms)\n${total}`, 1) : r(`  ✓ soma dá 3\n${total}`)
      // Mais de uma suíte ao mesmo tempo: com disputa, a base falha; lento, o mutante b + a estoura o tempo sem nome.
      return (async () => {
        conc.agora++
        conc.max = Math.max(conc.max, conc.agora)
        let juntas = conc.agora > 1
        await new Promise(ok => setTimeout(ok, 5))
        juntas ||= conc.agora > 1
        conc.agora--
        if (o.disputa && juntas) return r('Error: listen EADDRINUSE: address already in use :::3000\n', 1)
        if (o.lento && juntas && fonte.includes('b + a')) return r('', 124)
        return res
      })()
    }
    return r('', 127)
  })
  on('fs.exists', (_$, e) => ({ value: fs.has((e as { path: string }).path) }) as never)
  on('fs.stat', (_$, e) => {
    const p = (e as { path: string }).path
    if (p.endsWith('/.venv/bin/sumido')) throw new Error('ENOENT: stat falhou')
    return { value: { kind: 'file', size: (fs.get(p) ?? '').length, mtimeMs: 0, isLink: p.endsWith('/.venv/bin/ligado') } } as never
  })
  on('fs.read', (_$, e) => {
    const p = (e as { path: string }).path
    // O plugin.json do próprio mod (fora do repositório falso): a versão que o teste controla.
    if (o.versao && !fs.has(p) && p.endsWith('/.claude-plugin/plugin.json')) return { value: JSON.stringify({ version: o.versao.v }) } as never
    return { value: fs.get(p) ?? '' } as never
  })
  on('fs.write', (_$, e) => {
    const { path, text } = e as { path: string; text: string }
    fs.set(path, text)
    // Um defeito simulado: a escrita do mutante na cópia chega também ao original.
    if (o.vaza && path.startsWith(`${TMP}/repo/src/`) && text.includes('a - b')) fs.set(path.replace(`${TMP}/repo/`, '/repo/'), text)
    return { value: undefined } as never
  })
  on('session.cwd', () => ({ value: o.cwdSessao ?? '/repo' }) as never)
  on('session.model', () => ({ value: 'opus' }) as never)
  on('model.complete', () =>
    (modelo.chamadas++, {
      value: {
        isAnswered: true,
        usage: {},
        text: (o.python ? [
          // Os dois do mesmo tamanho: o equivalente sobrevive, o segundo tem de morrer.
          'src/calc.py:2 | livre | `x * 2` → `2 * x`',
          'src/calc.py:2 | condição invertida | `x * 2` → `x + 2`',
        ] : [
          // Caminho curto, como o modelo devolveu na 1ª execução real: tem de ser aplicado mesmo assim.
          'a.ts:1 | condição invertida | `a + b` → `a - b`',
          'src/a.ts:1 | null/inválido | `(a, b) => a + b` → `(a, b) => b + a`',
          'src/a.ts:1 | livre | `não existe` → `x`',
          ...(o.quebra ? ['src/a.ts:1 | borda/vazio | `=> a + b` → `=> a +`'] : []),
          'n/a | borda/vazio | sem listas',
          'n/a | empate/ordem | sem ordenação',
        ]).join('\n'),
      },
    }) as never,
  )
  return { fs, apagadas, rodadas, ambientes, sobrescritos, TMP, modelo, sobrouEscondido, conc }
}

test('executar: copia, roda a base, aplica pelo trecho, mata e deixa sobreviver de verdade, restaura e não toca o original', async ($, on) => {
  const m = mundo(on)
  const original = m.fs.get('/repo/src/a.ts')
  const r = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 'soma' } as never))
  // npm test detectado pelo package.json, rodado na cópia: base, o recorte de a.ts uma vez sem mutante (vale para os dois),
  // o morto só com o teste que alcança a.ts, o sobrevivente com esse teste e depois confirmado na suíte inteira.
  expect(m.rodadas.length).toBe(5)
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
  // A pasta temporária foi apagada, e só ela: sem .py no diff, nenhum __pycache__.
  expect(m.apagadas).toEqual([m.TMP])
  // Todo comando de teste roda sem gravar .pyc, a base inclusive.
  expect(m.ambientes.every(x => x?.PYTHONDONTWRITEBYTECODE === '1')).toBe(true)

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

test('executar: mutantes Python do mesmo tamanho não rodam o bytecode do anterior (sobrevivente falso, 15/10/2026)', async ($, on) => {
  const m = mundo(on, { python: true })
  const r = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 'dobro' } as never))
  expect(m.rodadas[0]!.slice(0, 4)).toEqual(['python3', '-m', 'pytest', '-q'])
  expect(r).toContain('2 | src/calc.py:2 | condição invertida | `x * 2` → `x + 2` | MORTO por \\"src/test_calc.py::test_dobro\\"')
  expect(r).toContain('Mutantes:   2 aplicados | 1 mortos | 1 sobreviventes')
  expect(m.ambientes.every(x => x?.PYTHONDONTWRITEBYTECODE === '1')).toBe(true)
})

test('executar: o __pycache__ que veio na cópia ao lado do .py mutável sai antes da base (pyc unchecked-hash)', async ($, on) => {
  const m = mundo(on, { python: true, pycVelho: true })
  const r = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 'dobro' } as never))
  expect(r).toContain('Mutantes:   2 aplicados | 1 mortos | 1 sobreviventes')
  // Só o da cópia e a pasta temporária: o original não é tocado.
  expect(m.apagadas).toEqual([`${m.TMP}/repo/src/__pycache__`, m.TMP])
  expect(m.fs.has('/repo/src/__pycache__/calc.cpython-315.pyc')).toBe(true)
})

test('executar: se o __pycache__ da cópia não sai, a rodada para antes da base (sem bytecode velho no veredito)', async ($, on) => {
  const m = mundo(on, { python: true, pycVelho: true, rmFalha: true })
  const r = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 'dobro' } as never))
  expect(r).toContain('Erro: não apaguei o __pycache__ da cópia (rm: permissão negada).')
  expect(r).toContain('"isError":true')
  expect(m.rodadas).toEqual([])
})

test('executar: recorte que falha sem mutante (teste que lê o repositório) não mata ninguém; a suíte inteira decide (rodada no publico, 0.8.2)', async ($, on) => {
  const m = mundo(on, { leRepo: true })
  const r = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 'soma' } as never))
  expect(r).not.toContain('lê o repositório')
  expect(r).toContain('1 | src/a.ts:1 | condição invertida | `a + b` → `a - b` | MORTO por \\"soma dá 3\\" [suíte inteira (o recorte de 1 arquivos de teste falha sem mutante)]')
  expect(r).toContain('2 | src/a.ts:1 | null/inválido | `(a, b) => a + b` → `(a, b) => b + a` | SOBREVIVENTE')
  expect(r).toContain('Mutantes:   2 aplicados | 1 mortos | 1 sobreviventes')
  // O recorte inválido roda uma vez só, não uma por mutante: base, recorte, e um run por mutante.
  expect(m.rodadas.length).toBe(4)
  expect(m.sobrouEscondido).toEqual([])
})

test('executar: o venv copiado aponta para a cópia, e o teste vê o código mutado, não o original (0.8.3, 1ª passada da rodada 59)', async ($, on) => {
  const m = mundo(on, { python: true, venvEditavel: true })
  const r = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 'dobro' } as never))
  expect(r).toContain('Mutantes:   2 aplicados | 1 mortos | 1 sobreviventes')
  // Na cópia (já apagada no fim), pelo que foi sobrescrito: o .pth e o shebang; o vizinho, que só começa igual, não.
  const venv = `${m.TMP}/repo/.venv`
  expect(Object.fromEntries(m.sobrescritos)).toEqual({
    [`${venv}/lib/python3.15/site-packages/_calc.pth`]: `${m.TMP}/repo/src\n`,
    [`${venv}/bin/pytest`]: `#!${m.TMP}/repo/.venv/bin/python\nimport pytest\n`,
  })
  // O link e o que não deu stat não foram sobrescritos (estão fora da lista acima); o venv do original fica como estava.
  expect(m.fs.get('/repo/.venv/lib/python3.15/site-packages/_calc.pth')).toBe('/repo/src\n')
})

test('executar: sem conseguir apontar o venv para a cópia, a rodada para com o erro e nenhum mutante roda', async ($, on) => {
  const m = mundo(on, { python: true, venvEditavel: true, sobrescreverFalha: true })
  const r = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 'dobro' } as never))
  expect(r).toContain('Erro: não apontei o venv da cópia para a cópia (.venv/')
  expect(r).toContain('sh: permissão negada')
  expect(m.rodadas).toEqual([])
  // A pasta temporária sai mesmo assim.
  expect(m.apagadas.at(-1)).toBe(m.TMP)
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

test('registrar v1.2: o diff num clone do próprio mod, fora da pasta dele, é calibração (r-prova-de-teste em /tmp, 0.8.3)', async ($, on) => {
  // /repo não fica sob a pasta do mod: só o nome no plugin.json diz que é o instrumento.
  const m = mundo(on, { pluginNaRaiz: true, nomeDoPlugin: 'prova-de-teste' })
  await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 'soma' } as never)
  m.fs.set(LOG_PATH, '# log\n')
  await $.tool.call({ tool: 'mcp__prova-de-teste__registrar', tarefa: 'soma', aplicados: 2, mortos: 1, sobreviventes: 1, reais: 1, estado: 'FRACO', tempo: 5 } as never)
  expect(m.fs.get(LOG_PATH)).toContain('calibração: o diff altera o próprio instrumento')
})

test('registrar v1.2: o plugin de outro nome na mesma situação continua medição', async ($, on) => {
  const m = mundo(on, { pluginNaRaiz: true, nomeDoPlugin: 'contexto-bar' })
  await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 'soma' } as never)
  m.fs.set(LOG_PATH, '# log\n')
  await $.tool.call({ tool: 'mcp__prova-de-teste__registrar', tarefa: 'soma', aplicados: 2, mortos: 1, sobreviventes: 1, reais: 1, estado: 'FRACO', tempo: 5 } as never)
  expect(m.fs.get(LOG_PATH)).toContain('| medição')
  expect(m.fs.get(LOG_PATH)).not.toContain('calibração')
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

test('resposta do escolhedor no teto de tokens: a última linha sai e o aviso diz que pode faltar categoria (defeito da 0.8.4)', async ($, on) => {
  gitFalso(on)
  on('session.cwd', () => ({ value: '/repo' }) as never)
  on('session.model', () => ({ value: 'opus' }) as never)
  let pedido = 0
  let saida = 16000
  let resposta = 'src/a.ts:1 | borda/vazio | `a + b` → `a - b`\nsrc/a.ts:1 | empate/ordem | `.map(f'
  on('model.complete', (_$, e) => {
    pedido = (e as { maxTokens: number }).maxTokens
    return { value: { isAnswered: true, text: resposta, usage: { output_tokens: saida } } } as never
  })
  const r = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__mutantes' } as never))
  expect(pedido).toBe(16000)
  expect(r).toContain('Resposta do escolhedor cortada no teto de 16000 tokens')
  expect(r).toContain('Mutantes (1)')
  expect(r).not.toContain('.map(f')
  // Resposta cortada que termina em quebra de linha: sai a linha pela metade, não a linha vazia (sobrevivente #21 da 0.9.0).
  resposta += '\n'
  const comQuebra = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__mutantes' } as never))
  expect(comQuebra).toContain('Mutantes (1)')
  expect(comQuebra).not.toContain('.map(f')
  // Abaixo do teto, nada sai e não há aviso.
  resposta = resposta.trimEnd()
  saida = 15999
  const ok = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__mutantes' } as never))
  expect(ok).not.toContain('cortada')
  expect(ok).toContain('Mutantes (2)')
})

test('a efetividade do ciclo vai ao arquivo de indicadores a cada registro, com o log já gravado', async ($, on) => {
  on('session.root', () => ({ value: '/repo' }) as never)
  mock.env(on, { HOME: '/home/u', PROVA_DE_TESTE_LOG: LOG_PATH })
  gitFalso(on)
  let log = '# log\n2026-10-15 | a | v1.2 | mutantes: 5/5/0 | reais: 1 | PROVADO | 30 | instrumento: mod 0.9.0 | medição\n'
  const escritas: Record<string, string[]> = {}
  const destino = '/home/u/.claude/indicadores/%2Frepo/prova-de-teste.json'
  on('fs.exists', () => ({ value: true }) as never)
  on('fs.stat', () => {
    throw new Error('sem link')
  })
  on('fs.read', (_$, e) => {
    const p = (e as { path: string }).path
    if (p === LOG_PATH) return { value: log } as never
    if (p === destino && escritas[destino]?.length) return { value: escritas[destino]!.at(-1) } as never
    throw new Error('ENOENT')
  })
  on('fs.write', (_$, e) => {
    const { path, text } = e as { path: string; text: string }
    ;(escritas[path] ??= []).push(text)
    if (path === LOG_PATH) log = text
    return { value: undefined } as never
  })
  const registra = (t: string) => $.tool.call({ tool: 'mcp__prova-de-teste__registrar', tarefa: t, aplicados: 3, mortos: 3, sobreviventes: 0, reais: 0, estado: 'PROVADO', tempo: 10 } as never)
  await registra('b')
  expect(JSON.parse(escritas[destino]![0]!).itens[0]).toMatchObject({ id: 'primeira-passada', valor: 100, texto: '100%' })
  expect(JSON.parse(escritas[destino]![0]!).itens[0].detalhe).toContain('últimas 2 tarefas')
  await registra('c')
  expect(escritas[destino]!.length).toBe(2)
  expect(JSON.parse(escritas[destino]![1]!).itens[0].detalhe).toContain('últimas 3 tarefas')
})

// Isolamento por projeto (0.11.0): o log compartilhado mora num repositório git (que vai ao GitHub e ao público).
const isolado = (on: On, o: { cwd: string; logEmGit?: boolean; listaInvertida?: boolean; raiz?: string | null }) => {
  mock.env(on, { HOME: '/h' })
  const fs = new Map<string, string>([['/mods/publico/EXP-001-log.md', '# log\n']])
  const gits: string[][] = []
  const repos: Record<string, string> = { '/mods/publico': '/mods/.git', '/tmp/wt': '/mods/.git', '/data/sensivel': '/data/sensivel/.git', '/data/sensivel-wt': '/data/sensivel/.git', '/data/sensivel/sub': '/data/sensivel/.git' }
  on('process.run', (_$, e) => {
    const { argv, init } = e as { argv: string[]; init?: { cwd?: string } }
    gits.push([...argv, init?.cwd ?? ''])
    const r = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (argv.includes('--git-common-dir')) {
      const repo = o.logEmGit === false && init?.cwd === '/mods/publico' ? undefined : repos[init?.cwd ?? '']
      return repo ? r(`${repo}\n`) : r('', 128)
    }
    return r('')
  })
  on('session.cwd', () => ({ value: o.cwd }) as never)
  if (o.raiz !== undefined)
    on('session.root', () => {
      if (o.raiz === null) throw new Error('sem raiz')
      return { value: o.raiz } as never
    })
  on('fs.stat', (_$, e) => {
    const p = (e as { path: string }).path
    if (p === '/h/.claude/prova-de-teste/EXP-001-log.md') return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: true, realPath: '/mods/publico/EXP-001-log.md' } } as never
    throw new Error('ENOENT')
  })
  on('fs.exists', (_$, e) => ({ value: fs.has((e as { path: string }).path) }) as never)
  on('fs.read', (_$, e) => {
    const t = fs.get((e as { path: string }).path)
    if (t === undefined) throw new Error('ENOENT')
    return { value: t } as never
  })
  on('fs.write', (_$, e) => {
    const { path, text } = e as { path: string; text: string }
    fs.set(path, text)
    return { value: undefined } as never
  })
  on('fs.list', (_$, e) => {
    const pasta = `${(e as { path: string }).path}/`
    const nomes = [...fs.keys()].filter(k => k.startsWith(pasta) && !k.slice(pasta.length).includes('/')).map(k => k.slice(pasta.length)).sort()
    return { value: (o.listaInvertida ? nomes.reverse() : nomes).map(name => ({ name, kind: 'file' })) } as never
  })
  return { fs, gits }
}
const prov = (n: string, a: number, mo: number) => `2026-10-15 | ${n}: x | v1.2 | mutantes: ${a}/${mo}/${a - mo} | reais: 0 | PROVADO | 10 | instrumento: mod 0.10.0 | medição`
const registro = { tool: 'mcp__prova-de-teste__registrar', tarefa: 'tarefa x: detalhe', aplicados: 2, mortos: 2, sobreviventes: 0, reais: 0, estado: 'PROVADO', tempo: 3 }

test('isolamento: rodada de outro projeto vai ao log local dele, fora de qualquer git, e o log compartilhado não muda', async ($, on) => {
  const m = isolado(on, { cwd: '/data/sensivel' })
  const r = JSON.stringify(await $.tool.call(registro as never))
  expect(r).toContain('log local do projeto, fora de qualquer git')
  expect(m.fs.get('/h/.claude/prova-de-teste/projetos/%2Fdata%2Fsensivel.md')).toContain('| tarefa x: detalhe | v1.2 | mutantes: 2/2/0')
  expect(m.fs.get('/mods/publico/EXP-001-log.md')).toBe('# log\n')
  expect(m.gits.some(g => g[1] === 'add' || g[1] === 'commit')).toBe(false)
})

test('isolamento: rodada dos mods, mesmo numa worktree deles, vai ao log compartilhado com commit', async ($, on) => {
  const m = isolado(on, { cwd: '/tmp/wt' })
  const r = JSON.stringify(await $.tool.call(registro as never))
  expect(r).toContain('commit no repositório do log')
  expect(m.fs.get('/mods/publico/EXP-001-log.md')).toContain('| tarefa x: detalhe |')
  expect(m.gits.some(g => g[1] === 'commit' && g.at(-1) === '/mods/publico')).toBe(true)
  expect([...m.fs.keys()].some(k => k.includes('/projetos/'))).toBe(false)
})

test('isolamento: log compartilhado fora de git é local e vale para qualquer projeto; pasta sem git usa a própria pasta', async ($, on) => {
  const m = isolado(on, { cwd: '/data/sensivel', logEmGit: false })
  await $.tool.call(registro as never)
  expect(m.fs.get('/mods/publico/EXP-001-log.md')).toContain('| tarefa x: detalhe |')
})

test('isolamento: a raiz que decide é a da execução, não a pasta da sessão (sobrevivente #15 da 0.11.0)', async ($, on) => {
  const m = mundo(on, { cwdSessao: '/longe' })
  await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 'soma', cwd: '/repo' } as never)
  const r = JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__registrar', tarefa: 'soma', aplicados: 2, mortos: 1, sobreviventes: 1, reais: 1, estado: 'FRACO', tempo: 1 } as never))
  expect(r).toContain('Gravado em /h/.claude/prova-de-teste/EXP-001-log.md')
  expect([...m.fs.keys()].some(k => k.includes('/projetos/'))).toBe(false)
})

test('isolamento: worktree de outro projeto vai ao log do repositório dele; pasta vazia vai a sem-projeto (sobreviventes #7 e #1)', async ($, on) => {
  const m = isolado(on, { cwd: '/data/sensivel-wt' })
  await $.tool.call(registro as never)
  expect(m.fs.get('/h/.claude/prova-de-teste/projetos/%2Fdata%2Fsensivel.md')).toContain('| tarefa x: detalhe |')
  expect(logDoProjeto('/h', '')).toBe('/h/.claude/prova-de-teste/projetos/sem-projeto.md')
})

test('isolamento: pasta que não é repositório vai ao log local com o nome da pasta', async ($, on) => {
  const m = isolado(on, { cwd: '/home/u/solta' })
  await $.tool.call(registro as never)
  expect(m.fs.get('/h/.claude/prova-de-teste/projetos/%2Fhome%2Fu%2Fsolta.md')).toContain('| tarefa x: detalhe |')
})


test('indicadores por projeto: cada sessão vê só a efetividade do log do seu projeto, num arquivo da sua raiz (nota do operador, 15/10)', async ($, on) => {
  const m = isolado(on, { cwd: '/data/sensivel' })
  on('session.root', () => ({ value: '/data/sensivel' }) as never)
  m.fs.set('/mods/publico/EXP-001-log.md', `# log\n${prov('dos mods', 4, 4)}\n`)
  m.fs.set('/h/.claude/prova-de-teste/projetos/%2Fdata%2Fsensivel.md', `${prov('sensivel', 4, 1)}\n`)
  await $.tool.call({ ...registro, tarefa: 'sensivel 2: y', aplicados: 4, mortos: 3, sobreviventes: 1, reais: 1, estado: 'FRACO' } as never)
  const ind = JSON.parse(m.fs.get('/h/.claude/indicadores/%2Fdata%2Fsensivel/prova-de-teste.json')!)
  // Só as do projeto: a provada "sensivel" (1 de 4 na 1ª lista); a dos mods não entra; a nova ainda está aberta.
  expect(ind.itens[0].detalhe).toContain('últimas 1 tarefas: 25%')
  // Nada no arquivo global, nem na pasta de outra raiz.
  expect(m.fs.has('/h/.claude/indicadores/prova-de-teste.json')).toBe(false)
  expect([...m.fs.keys()].filter(k => k.startsWith('/h/.claude/indicadores/')).length).toBe(1)
})

test('indicadores por projeto: a sessão dos mods vê só o log compartilhado, mesmo com logs locais de outros projetos', async ($, on) => {
  const m = isolado(on, { cwd: '/tmp/wt' })
  on('session.root', () => ({ value: '/tmp/wt' }) as never)
  m.fs.set('/mods/publico/EXP-001-log.md', `# log\n${prov('dos mods', 4, 4)}\n`)
  m.fs.set('/h/.claude/prova-de-teste/projetos', '')
  m.fs.set('/h/.claude/prova-de-teste/projetos/%2Fdata%2Fsensivel.md', `${prov('sensivel', 4, 0)}\n`)
  await $.tool.call(registro as never)
  const ind = JSON.parse(m.fs.get('/h/.claude/indicadores/%2Ftmp%2Fwt/prova-de-teste.json')!)
  expect(ind.itens[0].detalhe).toContain('últimas 2 tarefas: 100%')
})

test('indicadores por projeto: raiz que falha cai na pasta da sessão; a raiz vale antes da subpasta; sem nenhuma, nada é escrito (sobreviventes #1, #3 e #5 da 0.12.0)', async ($, on) => {
  const m = isolado(on, { cwd: '/data/sensivel', raiz: null })
  m.fs.set('/h/.claude/prova-de-teste/projetos/%2Fdata%2Fsensivel.md', `${prov('sensivel', 4, 4)}\n`)
  await $.tool.call(registro as never)
  expect(m.fs.has('/h/.claude/indicadores/%2Fdata%2Fsensivel/prova-de-teste.json')).toBe(true)
})

test('indicadores por projeto: na subpasta, o arquivo é o da raiz', async ($, on) => {
  const m = isolado(on, { cwd: '/data/sensivel/sub', raiz: '/data/sensivel' })
  m.fs.set('/h/.claude/prova-de-teste/projetos/%2Fdata%2Fsensivel.md', `${prov('sensivel', 4, 4)}\n`)
  await $.tool.call(registro as never)
  expect(m.fs.has('/h/.claude/indicadores/%2Fdata%2Fsensivel/prova-de-teste.json')).toBe(true)
  expect([...m.fs.keys()].some(k => k.includes('%2Fsub'))).toBe(false)
})

test('indicadores por projeto: sem raiz nem pasta da sessão, nada vai ao arquivo global', async ($, on) => {
  const m = isolado(on, { cwd: '', raiz: '' })
  await $.tool.call(registro as never)
  expect([...m.fs.keys()].filter(k => k.startsWith('/h/.claude/indicadores'))).toEqual([])
})

const executarJa = async ($: Parameters<TestBody>[0], extra: object = {}) => JSON.stringify(await $.tool.call({ tool: 'mcp__prova-de-teste__executar', tarefa: 'soma', ...extra } as never))

test('executar em paralelo: um quarto dos núcleos, cada mutante na sua cópia, mesmo veredito da fila e na ordem da lista (rodada de 1.441 s no motor, 15/10)', async ($, on) => {
  const m = mundo(on, { nucleos: '32' })
  const r = await executarJa($)
  // 3 mutantes na lista: 3 cópias (32/4 = 8, limitado pelos mutantes).
  expect(r).toContain('Paralelo:   3 cópias ao mesmo tempo (32 núcleos)')
  expect(r).toContain('3 cópias em paralelo')
  expect(m.conc.max).toBeGreaterThan(1)
  expect(r).toContain('1 | src/a.ts:1 | condição invertida | `a + b` → `a - b` | MORTO por \\"soma dá 3\\"')
  expect(r).toContain('2 | src/a.ts:1 | null/inválido')
  expect(r).toContain('Mutantes:   2 aplicados | 1 mortos | 1 sobreviventes | 1 não aplicados')
  expect(r).toContain('cmp na cópia: idêntico')
  // Cada cópia rodou na própria pasta, e nenhuma deixou teste escondido.
  const pastas = new Set(m.rodadas.map(x => x.at(-1)))
  expect([...pastas].sort()).toEqual([`${m.TMP}/repo`, `${m.TMP}/repo-2`, `${m.TMP}/repo-3`])
  expect(m.sobrouEscondido).toEqual([])
  expect(m.apagadas).toEqual([m.TMP])
})

test('executar em paralelo: pedido vale até o número de mutantes; 1 é a fila sem linha a dizer; sem nproc, fila', async ($, on) => {
  mundo(on, { nucleos: '32' })
  expect(await executarJa($, { paralelo: 2 })).toContain('Paralelo:   2 cópias ao mesmo tempo')
  const fila = await executarJa($, { paralelo: 1, repetir: true })
  expect(fila).not.toContain('Paralelo:')
  expect(fila).not.toContain('em paralelo')
})

test('executar em paralelo: a base que falha com as cópias juntas e passa sozinha manda a rodada para a fila, com o motivo', async ($, on) => {
  const m = mundo(on, { nucleos: '32', disputa: true })
  const r = await executarJa($)
  expect(r).toContain('Paralelo:   em fila (32 núcleos): a linha de base falhou com 3 cópias ao mesmo tempo e passou sozinha')
  expect(r).toContain('Mutantes:   2 aplicados | 1 mortos | 1 sobreviventes')
  expect(r).toContain('linha de base passou')
  expect(m.conc.max).toBeGreaterThan(1)
})

test('executar em paralelo: morte sem teste nomeado (tempo esgotado na disputa) é refeita sozinha e não vira morte falsa', async ($, on) => {
  mundo(on, { nucleos: '32', lento: true })
  // Na suíte inteira: no incremental, a falha sem nome já era refeita na suíte inteira.
  const r = await executarJa($, { incremental: false })
  expect(r).toContain('2 | src/a.ts:1 | null/inválido | `(a, b) => a + b` → `(a, b) => b + a` | SOBREVIVENTE')
  expect(r).toContain('refeito sozinho (morte sem nome em paralelo)')
  expect(r).toContain('1 morte(s) sem nome refeita(s) sozinha(s)')
})

test('executar: commit ou edição de outra sessão durante a rodada não invalida; mutante que chega ao original, sim', async ($, on) => {
  const m = mundo(on, { statusMuda: true })
  const r = await executarJa($)
  expect(r).toContain('original ✔ intocado (nenhum mutante chegou a ele); o repositório mudou por fora durante a rodada')
  expect(r).toContain('Estado:     FRACO')
  expect(m.fs.get('/repo/src/a.ts')).toBe('export const soma = (a, b) => a + b\n')
})

test('executar: o texto mutado que aparece no arquivo original marca ALTERADO e a rodada não vale', async ($, on) => {
  mundo(on, { vaza: true })
  const r = await executarJa($)
  expect(r).toContain('original ✘ ALTERADO: um mutante chegou ao arquivo original')
  expect(r).not.toContain('mudou por fora')
  expect(r).toContain('Estado:     NÃO VERIFICADO')
})

test('executar em paralelo: se uma das cópias não fica pronta, a rodada vai em fila e diz qual (sobrevivente #16 da 0.13.0)', async ($, on) => {
  const m = mundo(on, { nucleos: '32', cpFalhaEm: '/repo-3' })
  const r = await executarJa($)
  expect(r).toContain('Paralelo:   em fila (32 núcleos): a cópia 3 não ficou pronta (a cópia falhou (cp: sem espaço))')
  expect(new Set(m.rodadas.map(x => x.at(-1)))).toEqual(new Set([`${m.TMP}/repo`]))
  expect(r).toContain('Mutantes:   2 aplicados | 1 mortos | 1 sobreviventes')
})
