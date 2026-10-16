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

function mundo(on: On, o: { herdr?: boolean; falha?: boolean } = {}) {
  const m = { snap: snapDe('working'), escritos: [] as { path: string; text: string }[], toasts: [] as string[], argv: [] as string[][] }
  mock.env(on, o.herdr === false ? { HOME: '/h' } : { HOME: '/h', HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HERDR_WORKSPACE_ID: 'w1', HERDR_BIN_PATH: '/usr/bin/herdr' })
  on('process.run', (_$, e) => {
    const argv = (e as { argv: string[] }).argv
    m.argv.push(argv)
    const ok = !(o.falha && argv[1] === 'api')
    return { value: { exitCode: ok ? 0 : 1, stdout: ok ? m.snap : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  on('fs.write', (_$, e) => (m.escritos.push(e as { path: string; text: string }), { value: undefined }) as never)
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
