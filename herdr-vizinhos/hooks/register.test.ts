import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const agente = (pane: string, ws: string, estado: string) => ({ pane_id: pane, workspace_id: ws, agent_status: estado, terminal_title_stripped: 't' })
const snapDe = (estadoVizinho: string) =>
  JSON.stringify({
    result: {
      snapshot: {
        workspaces: [
          { workspace_id: 'w1', label: 'mods', agent_status: 'working' },
          { workspace_id: 'w2', label: 'motor', agent_status: estadoVizinho },
        ],
        agents: [agente('w1:p1', 'w1', 'working'), agente('w2:p1', 'w2', estadoVizinho)],
      },
    },
  })

const ARQ = '/h/.claude/herdr/vizinhos/w1%3Ap1.json'

function mundo(on: On, o: { herdr?: boolean; falha?: boolean; semFsEProcesso?: boolean } = {}) {
  const m = { snap: snapDe('working'), escritos: [] as { path: string; text: string }[], toasts: [] as string[], argv: [] as string[][] }
  mock.env(on, o.herdr === false ? { HOME: '/h' } : { HOME: '/h', HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HERDR_WORKSPACE_ID: 'w1', HERDR_BIN_PATH: '/usr/bin/herdr' })
  if (!o.semFsEProcesso) on('process.run', (_$, e) => {
    const argv = (e as { argv: string[] }).argv
    m.argv.push(argv)
    const ok = !(o.falha && argv[1] === 'api')
    return { value: { exitCode: ok ? 0 : 1, stdout: ok ? m.snap : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  if (!o.semFsEProcesso) on('fs.write', (_$, e) => (m.escritos.push(e as { path: string; text: string }), { value: undefined }) as never)
  on('ui.toast', (_$, e) => (m.toasts.push((e as { text: string }).text), { value: undefined }) as never)
  const relogio = mock.clock(on, { now: Date.UTC(2026, 9, 16) })
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  on('session.start', () => ({ cwd: '/proj' }) as never)
  on('session.end', () => ({ sessionId: 's' }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }) as never)
  return { ...m, relogio, get snap() { return m.snap }, set snap(v: string) { m.snap = v } }
}

const ferramenta = async ($: Engine) => JSON.parse(JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'true' } as never))) as { context?: string[] }
const pedido = async ($: Engine) => JSON.parse(JSON.stringify(await $.prompt.submit({ text: 'segue' } as never))) as { context?: string[] }

test('dentro do herdr: escreve os vizinhos no arquivo do pane, liga o timer e só reescreve quando muda', async ($, on) => {
  const m = mundo(on)
  await $.session.start({ cwd: '/proj' } as never)
  expect(m.argv[0]).toEqual(['/usr/bin/herdr', 'api', 'snapshot'])
  expect(m.escritos.map(e => e.path)).toEqual([ARQ])
  const c = JSON.parse(m.escritos[0]!.text)
  expect(c).toMatchObject({ versao: 1, fonte: 'herdr', em: '2026-10-16T00:00:00.000Z', workspace: 'w1' })
  expect(c.vizinhos.map((v: { rotulo: string; estado: string }) => [v.rotulo, v.estado])).toEqual([['motor', 'working']])
  await ferramenta($)
  expect(m.escritos.length).toBe(1)
  // A primeira leitura não avisa: o que já estava assim ao abrir não é novidade.
  expect(m.toasts).toEqual([])
  // Sem ferramenta nem pedido, o timer relê sozinho a cada 5 s.
  m.snap = snapDe('blocked')
  await m.relogio.advance(4999)
  expect(m.toasts).toEqual([])
  await m.relogio.advance(1)
  expect(m.toasts).toEqual(['herdr: motor (w2:p1) está esperando o operador'])
  expect(m.escritos.length).toBe(2)
  // O aviso que o timer viu vai ao modelo na próxima ferramenta.
  expect((await ferramenta($)).context?.join('\n')).toContain('[herdr] motor (w2:p1) está esperando o operador')
})

test('vizinho que fica blocked: toast para o operador e uma linha ao modelo no próximo resultado, uma vez só', async ($, on) => {
  const m = mundo(on)
  await $.session.start({ cwd: '/proj' } as never)
  m.snap = snapDe('blocked')
  const r = await ferramenta($)
  expect(m.toasts).toEqual(['herdr: motor (w2:p1) está esperando o operador'])
  expect(r.context?.join('\n')).toContain('[herdr] motor (w2:p1) está esperando o operador. A sessão de outro workspace é do operador')
  expect(m.escritos.length).toBe(2)
  expect((await ferramenta($)).context ?? []).not.toContainEqual(expect.stringContaining('[herdr]'))
  // done chega pelo pedido, quando é ele que relê primeiro.
  m.snap = snapDe('done')
  const p = await pedido($)
  expect(p.context?.join('\n')).toContain('[herdr] motor (w2:p1) terminou.')
  expect(m.toasts.at(-1)).toBe('herdr: motor (w2:p1) terminou')
})

test('fora do herdr o mod some: nada roda, nada é escrito, nada vai ao contexto', async ($, on) => {
  const m = mundo(on, { herdr: false })
  await $.session.start({ cwd: '/proj' } as never)
  m.snap = snapDe('blocked')
  await ferramenta($)
  await pedido($)
  await m.relogio.advance(20000)
  expect(m.argv).toEqual([])
  expect(m.escritos).toEqual([])
})

test('herdr que falha não segura a ferramenta nem o pedido, e não escreve nada', async ($, on) => {
  const m = mundo(on, { falha: true })
  await $.session.start({ cwd: '/proj' } as never)
  expect((await ferramenta($)).context ?? []).toEqual([])
  expect(m.escritos).toEqual([])
})

test('a sessão que sai apaga o arquivo dela', async ($, on) => {
  const m = mundo(on)
  await $.session.start({ cwd: '/proj' } as never)
  await $.session.end({ cwd: '/proj' } as never)
  expect(m.argv.at(-1)).toEqual(['rm', '-f', ARQ])
  // E o timer para: o arquivo não volta.
  const n = m.argv.length
  m.snap = snapDe('done')
  await m.relogio.advance(20000)
  expect(m.argv.length).toBe(n)
})

test('modo habilitado: todo pedido leva a regra (inteira no primeiro e depois de compactar, curta nos outros); fora do herdr, nada', async ($, on) => {
  mundo(on)
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'resumo', toolUses: [] }] }) as never)
  await $.session.start({ cwd: '/proj' } as never)
  const ctx = async () => ((await pedido($)).context ?? []).join('\n')
  const primeiro = await ctx()
  expect(primeiro).toContain('[herdr] habilitado (herdr-vizinhos/ACIONAMENTO.md)')
  const segundo = await ctx()
  expect(segundo).toContain('[herdr] habilitado: plano com 2+ frentes')
  expect(segundo).not.toContain('ACIONAMENTO.md')
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'antes', toolUses: [] }] } as never)
  expect(await ctx()).toContain('ACIONAMENTO.md')
  // Comando do operador (/algo) não leva a regra.
  expect(JSON.stringify(await $.prompt.submit({ text: '/objetivo', command: { name: 'objetivo' } } as never))).not.toContain('[herdr] habilitado')
})

test('modo habilitado: fora do herdr, o pedido não leva a regra', async ($, on) => {
  mundo(on, { herdr: false })
  await $.session.start({ cwd: '/proj' } as never)
  expect(JSON.stringify(await pedido($))).not.toContain('[herdr]')
})

test('modo habilitado: com aviso pendente, a regra vem antes do aviso no mesmo pedido (sobrevivente #6 da 0.2.0)', async ($, on) => {
  const m = mundo(on)
  await $.session.start({ cwd: '/proj' } as never)
  m.snap = snapDe('blocked')
  const ctx = (await pedido($)).context ?? []
  const iRegra = ctx.findIndex(c => c.startsWith('[herdr] habilitado'))
  const iAviso = ctx.findIndex(c => c.includes('está esperando o operador'))
  expect(iRegra).toBeGreaterThanOrEqual(0)
  expect(iAviso).toBe(iRegra + 1)
})

function mundoBriefing(on: On, o: { herdr?: boolean; diff?: string; novos?: string; gitFalha?: boolean; lsFalha?: boolean } = {}) {
  const m = mundo(on, { herdr: o.herdr, semFsEProcesso: true })
  const fs = new Map<string, string>()
  const registradas: string[] = []
  on('tool.register', (_$, e) => (registradas.push((e as { name: string }).name), { value: undefined }) as never)
  on('session.cwd', () => ({ value: '/proj' }) as never)
  on('fs.exists', (_$, e) => ({ value: fs.has((e as { path: string }).path) }) as never)
  on('fs.read', (_$, e) => ({ value: fs.get((e as { path: string }).path) ?? '' }) as never)
  on('fs.write', (_$, e) => {
    const { path, text } = e as { path: string; text: string }
    fs.set(path, text)
    m.escritos.push({ path, text })
    return { value: undefined } as never
  })
  const git: { argv: string[]; cwd?: string }[] = []
  on('process.run', (_$, e) => {
    const { argv, init } = e as { argv: string[]; init?: { cwd?: string } }
    if (argv[0] !== 'git') return { value: { exitCode: 0, stdout: m.snap, stderr: '' } } as never
    git.push({ argv, cwd: init?.cwd })
    if (o.gitFalha || (o.lsFalha && argv[1] === 'ls-files')) return { value: { exitCode: 128, stdout: '', stderr: 'not a git repository' } } as never
    return { value: { exitCode: 0, stdout: argv[1] === 'diff' ? (o.diff ?? '') : (o.novos ?? ''), stderr: '' } } as never
  })
  return { ...m, fs, registradas, git }
}

const chamar = async ($: Engine, a: object) => JSON.parse(JSON.stringify(await $.tool.call({ tool: 'mcp__herdr-vizinhos__briefing', ...a } as never))) as { result: string; isError?: boolean; context?: string[] }

test('briefing: dentro do herdr a ferramenta é registrada; escrever grava o arquivo e o .gitignore da .herdr e devolve a instrução do pane', async ($, on) => {
  const m = mundoBriefing(on)
  await $.session.start({ cwd: '/proj' } as never)
  expect(m.registradas).toEqual(['briefing'])
  const r = await chamar($, { acao: 'escrever', frente: 'Revisão', objetivo: 'revisar', feito: 'testes passam', arquivos: ['src/'], naoTocar: ['package.json'], pendencia: 2, harness: 'codex' })
  expect(r.isError).toBeUndefined()
  expect(r.result).toBe('Briefing gravado em /proj/.herdr/frentes/revisao.md.\nInstrução para o pane: Leia /proj/.herdr/frentes/revisao.md e trabalhe só nessa frente. Ao terminar, pare com o resultado na árvore, sem commit.')
  expect(m.fs.get('/proj/.herdr/.gitignore')).toBe('*\n')
  expect(m.fs.get('/proj/.herdr/frentes/revisao.md')).toContain('<!-- herdr-briefing v1 · 2026-10-16T00:00:00.000Z · pendência #2 · harness codex -->')
  // O .gitignore que já existe fica como está.
  m.fs.set('/proj/.herdr/.gitignore', 'meu\n')
  await chamar($, { acao: 'escrever', frente: 'Outra', pasta: '/proj/', objetivo: 'o', feito: 'f' })
  expect(m.fs.get('/proj/.herdr/.gitignore')).toBe('meu\n')
  expect(m.fs.has('/proj/.herdr/frentes/outra.md')).toBe(true)
  // ler devolve o arquivo.
  expect((await chamar($, { acao: 'ler', frente: 'Revisão' })).result).toBe(m.fs.get('/proj/.herdr/frentes/revisao.md'))
})

test('briefing: sem objetivo ou feito não grava; sem arquivo, ler e conferir dizem para escrever antes; acao desconhecida é erro', async ($, on) => {
  const m = mundoBriefing(on)
  const r = await chamar($, { acao: 'escrever', frente: 'X', objetivo: '' })
  expect(r.isError).toBe(true)
  expect(r.result).toBe('Erro: o briefing precisa de objetivo, feito.')
  expect(m.fs.size).toBe(0)
  expect((await chamar($, { acao: 'ler', frente: 'X' })).result).toContain('não há briefing da frente "X" em /proj/.herdr/frentes/x.md')
  expect((await chamar($, { acao: 'escrever', frente: '' })).result).toBe('Erro: falta frente.')
  expect((await chamar($, { acao: 'ler', frente: '   ' })).result).toBe('Erro: falta frente.')
  await chamar($, { acao: 'escrever', frente: 'X', objetivo: 'o', feito: 'f' })
  const errada = await chamar($, { acao: 'apagar', frente: 'X' })
  expect(errada.isError).toBe(true)
  expect(errada.result).toBe('Erro: acao é escrever, ler ou conferir.')
  m.fs.set('/proj/.herdr/frentes/x.md', '# outra coisa\n')
  expect((await chamar($, { acao: 'conferir', frente: 'X' })).result).toContain('não é um briefing v1')
})

test('briefing conferir: o git roda na pasta da frente; proibido e fora de Arquivos saem listados; no escopo, lembra o feito', async ($, on) => {
  const m = mundoBriefing(on, { diff: 'src/a.ts\npackage.json\n', novos: 'README.md\n.herdr/frentes/revisao.md\n' })
  await chamar($, { acao: 'escrever', frente: 'Revisão', pasta: '/w', objetivo: 'revisar', feito: 'testes passam', arquivos: ['src/'], naoTocar: ['package.json'] })
  const r = await chamar($, { acao: 'conferir', frente: 'Revisão', pasta: '/w' })
  expect(m.git).toEqual([
    { argv: ['git', 'diff', '--name-only', '--relative', 'HEAD'], cwd: '/w' },
    { argv: ['git', 'ls-files', '-o', '--exclude-standard'], cwd: '/w' },
  ])
  expect(r.result).toBe(
    'Frente "Revisão": 3 arquivos tocados; FORA DO ESCOPO:\n  ✘ package.json (em "O que não tocar")\n  ✘ README.md (fora de "Arquivos")\nA frente não está feita: desfaça ou justifique cada um antes da prova.',
  )
})

test('briefing conferir: tudo no escopo diz o feito; git que falha é erro com o motivo', async ($, on) => {
  const m = mundoBriefing(on, { diff: 'src/a.ts\n' })
  await chamar($, { acao: 'escrever', frente: 'R', objetivo: 'o', feito: 'testes passam', arquivos: ['src/'] })
  expect((await chamar($, { acao: 'conferir', frente: 'R' })).result).toBe('Frente "R": 1 arquivo tocado, todos no escopo. Feito quando: testes passam')
  expect(m.git[0]!.cwd).toBe('/proj')
})

test('briefing conferir: fora de um repositório git, erro com o que o git disse', async ($, on) => {
  mundoBriefing(on, { gitFalha: true })
  await chamar($, { acao: 'escrever', frente: 'R', objetivo: 'o', feito: 'f' })
  const r = await chamar($, { acao: 'conferir', frente: 'R' })
  expect(r.isError).toBe(true)
  expect(r.result).toBe('Erro: o git não leu /proj (not a git repository).')
})

test('briefing: fora do herdr a ferramenta não é registrada', async ($, on) => {
  const m = mundoBriefing(on, { herdr: false })
  await $.session.start({ cwd: '/proj' } as never)
  expect(m.registradas).toEqual([])
})

test('briefing conferir: o ls-files que falha sozinho também é erro (os novos ficariam de fora)', async ($, on) => {
  mundoBriefing(on, { lsFalha: true })
  await chamar($, { acao: 'escrever', frente: 'R', objetivo: 'o', feito: 'f' })
  const r = await chamar($, { acao: 'conferir', frente: 'R' })
  expect(r.isError).toBe(true)
  expect(r.result).toBe('Erro: o git não leu /proj (not a git repository).')
})
