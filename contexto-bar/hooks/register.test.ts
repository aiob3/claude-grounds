import { atom, read } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { buildSnapshot, cellsFor, chaveObjetivo, groupOf, TOOL } from './register'

const categories = [
  { name: 'System prompt', tokens: 3000, kind: 'used' },
  { name: 'System tools', tokens: 12000, kind: 'used' },
  { name: 'MCP tools', tokens: 8000, kind: 'used' },
  { name: 'MCP tools (deferred)', tokens: 40000, kind: 'deferred' },
  { name: 'Memory files', tokens: 2000, kind: 'used' },
  { name: 'Skills', tokens: 5000, kind: 'used' },
  { name: 'Messages', tokens: 20000, kind: 'used' },
  { name: 'Free space', tokens: 117000, kind: 'free' },
  { name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' },
]

test('classifica cada linha do /context no grupo certo', () => {
  expect(groupOf('MCP tools', 'used')).toBe('mcp')
  expect(groupOf('Memory files', 'used')).toBe('claudemd')
  expect(groupOf('Skills', 'used')).toBe('skills')
  expect(groupOf('Messages', 'used')).toBe('conversa')
  expect(groupOf('System tools', 'used')).toBe('sistema')
  expect(groupOf('MCP tools (deferred)', 'deferred')).toBe(null)
})

test('hooks saem da conversa e o percentual ignora livre e reserva', () => {
  const snap = buildSnapshot(categories, 1000)
  const by = Object.fromEntries(snap.segments.map(s => [s.key, s.tokens]))
  expect(by.sistema).toBe(15000)
  expect(by.hooks).toBe(1000)
  expect(by.conversa).toBe(19000)
  expect(snap.total).toBe(200000)
  expect(snap.percent).toBe(25)
})

test('a barra sempre ocupa a largura exata e nenhuma categoria some', () => {
  const snap = buildSnapshot(categories, 100)
  for (const width of [20, 57, 100, 180]) {
    const cells = cellsFor(snap, width)
    expect(cells.reduce((a, b) => a + b, 0)).toBe(width)
    for (let i = 0; i < cells.length; i++) {
      if (snap.segments[i]!.tokens > 0) expect(cells[i]! >= 1).toBe(true)
    }
  }
})

const usageWith = (messages: number) =>
  ({
    value: {
      context: {
        breakdown: {
          categories: categories.map(c => (c.name === 'Messages' ? { ...c, tokens: messages } : c)),
        },
      },
    },
  }) as never

const barText = async ($: Engine) =>
  JSON.stringify(await $.ui.render({ component: 'AbovePrompt', surface: 'terminal', props: { hasSurvey: false, bodyColumns: 100 } } as never))

test('a barra relê o contexto depois de cada ferramenta, sem esperar o fim do turno', async ($, on) => {
  let reads = 0
  on('session.usage', () => {
    reads++
    return usageWith(50000)
  })
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  await $.tool.call({ tool: 'Bash', input: { command: 'true' } } as never)
  expect(reads).toBe(1)
  expect(await barText($)).toContain('"Conversa"," ","50k"')
})

test('a compactação zera a estimativa de Hooks', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  on('prompt.attachment', (_$, e) => ({ text: e.text }) as never)
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'resumo', toolUses: [] }] }) as never)
  await $.prompt.attachment({ type: 'hook_additional_context', text: 'x'.repeat(4000), origin: { kind: 'hook', event: 'SessionStart' } } as never)
  await $.tool.call({ tool: 'Bash', input: { command: 'true' } } as never)
  expect(await barText($)).toContain('"Hooks"," ","1.0k"')
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'antes', toolUses: [] }] } as never)
  expect(await barText($)).toContain('"Hooks"," ","0"')
})

test('a ferramenta define o objetivo, a banda mostra a segunda camada e o prompt leva a linha ao modelo', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }) as never)
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  const r = await $.tool.call({
    tool: 'mcp__contexto-bar__objetivo',
    acao: 'definir',
    titulo: 'Barra permanente',
    conclusao: 'reload mostra a instalada',
    itens: [{ texto: 'instalar', tamanho: 'P' }, { texto: 'rodar reload', dono: 'operador' }],
  } as never)
  expect(JSON.stringify(r)).toContain('Objetivo: Barra permanente')
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  const band = await barText($)
  expect(band).toContain('Barra permanente')
  expect(band).toContain('sua vez')
  // A próxima é a caixa dela na barra de passos, em destaque, sem o texto "próxima #" na banda.
  expect(band).toContain('"children":["[",{"type":"Text","props":{"color":"claude","weight":"bold"},"children":["▣"]},"□","]"')
  expect(band).not.toContain('próxima #')
  // Recém-definido: a primeira linha leva a conclusão; as seguintes, só o título, o progresso e a próxima.
  const sent = (await $.prompt.submit({ text: 'segue' } as never)) as unknown as { context?: string[] }
  expect(JSON.stringify(sent.context)).toContain('próxima #1 instalar (claude)')
  expect(JSON.stringify(sent.context)).toContain('reload mostra a instalada')
  const depois = (await $.prompt.submit({ text: 'segue' } as never)) as unknown as { context?: string[] }
  expect(JSON.stringify(depois.context)).toContain('Barra permanente · 0/2 · próxima #1')
  expect(JSON.stringify(depois.context)).not.toContain('reload mostra a instalada')
  expect(JSON.stringify(depois.context)).not.toContain('rodar reload')
})

test('o operador define e conclui pelo /objetivo, e o painel lista as pendências por dono', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  const def = await $.command.run({ command: 'objetivo', args: 'Migrar vault :: merge em main' } as never)
  expect(JSON.stringify(def)).toContain('Objetivo: Migrar vault')
  await $.command.run({ command: 'objetivo', args: 'meu revisar o ADR' } as never)
  await $.command.run({ command: 'objetivo', args: 'add mover docs' } as never)
  const feito = await $.command.run({ command: 'objetivo', args: 'feito 2' } as never)
  expect(JSON.stringify(feito)).toContain('[x] #2')
  const pane = JSON.stringify(
    await $.ui.render({ component: 'Pane', requestId: 'objetivo', surface: 'terminal', props: {} } as never),
  )
  expect(pane).toContain('SUA VEZ')
  expect(pane).toContain('revisar o ADR')
})

test('o objetivo é gravado por pasta de projeto e uma sessão nova da mesma pasta o retoma', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }) as never)
  let raiz = '/proj/a'
  on('session.root', () => ({ value: raiz }) as never)
  const antigo = {
    titulo: 'Objetivo de outra sessão',
    conclusao: 'merge',
    origem: 'operador',
    itens: [{ id: 1, texto: 'revisar', dono: 'claude', tamanho: 'P', feito: false }],
    marco: 999999,
    consumo: [],
    atualizadoTurno: 42,
    aviso: 'nao-cabe',
  }
  mock.store(on, { [chaveObjetivo('/proj/a')]: antigo })
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)

  // Pasta a: a sessão nova retoma o objetivo gravado, com o turno e o aviso desta sessão.
  const sentA = (await $.prompt.submit({ text: 'oi' } as never)) as unknown as { context?: string[] }
  expect(JSON.stringify(sentA.context)).toContain('Objetivo de outra sessão')
  expect(await barText($)).not.toContain('sem atualização')

  // /cd para a pasta b: sem objetivo lá; definir grava na chave de b, sem tocar a de a.
  raiz = '/proj/b'
  const sentB = (await $.prompt.submit({ text: 'oi' } as never)) as unknown as { context?: string[] }
  expect(JSON.stringify(sentB.context)).toContain('Nenhum objetivo ativo')
  await $.command.run({ command: 'objetivo', args: 'Projeto B :: deploy' } as never)
  const linha = async (pasta: string) => {
    raiz = pasta
    return JSON.stringify(((await $.prompt.submit({ text: 'oi' } as never)) as unknown as { context?: string[] }).context)
  }

  // Ir e voltar entre as pastas relê cada uma do store: a de a ficou intacta, a de b foi gravada.
  expect(await linha('/proj/a')).toContain('Objetivo de outra sessão')
  expect(await linha('/proj/b')).toContain('Projeto B')

  // Encerrar apaga só o da pasta atual.
  await $.command.run({ command: 'objetivo', args: 'encerrar' } as never)
  expect(await linha('/proj/a')).toContain('Objetivo de outra sessão')
  expect(await linha('/proj/b')).toContain('Nenhum objetivo ativo')
})


test('com objetivo ativo, cada pedido abre o painel; sem objetivo ou com /objetivo auto off, não', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }) as never)
  on('session.root', () => ({ value: '/proj/p' }) as never)
  mock.store(on)
  const abertos: string[] = []
  on('ui.open', (_$, e) => {
    abertos.push((e as { id: string }).id)
    return { value: { isPlaced: true } } as never
  })
  await $.prompt.submit({ text: 'oi' } as never)
  expect(abertos).toEqual([])
  await $.command.run({ command: 'objetivo', args: 'Entrega :: deploy' } as never)
  const antes = abertos.length
  await $.prompt.submit({ text: 'segue' } as never)
  expect(abertos.length).toBe(antes + 1)
  expect(abertos.at(-1)).toBe('objetivo')
  // Desligado, o pedido não abre; ligado de novo, volta a abrir.
  const off = JSON.stringify(await $.command.run({ command: 'objetivo', args: 'auto off' } as never))
  expect(off).toContain('não abre mais sozinho')
  const n = abertos.length
  await $.prompt.submit({ text: 'segue' } as never)
  expect(abertos.length).toBe(n)
  await $.command.run({ command: 'objetivo', args: 'auto on' } as never)
  await $.prompt.submit({ text: 'segue' } as never)
  expect(abertos.length).toBe(n + 1)
})

test('se o store do mod falhar, o painel automático continua ligado (sobrevivente #8 da rodada 4)', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }) as never)
  on('session.root', () => ({ value: '/proj/q' }) as never)
  on('store.get', () => {
    throw new Error('store fora')
  })
  on('store.set', () => ({ value: undefined }) as never)
  on('store.delete', () => ({ value: undefined }) as never)
  const abertos: string[] = []
  on('ui.open', (_$, e) => {
    abertos.push((e as { id: string }).id)
    return { value: { isPlaced: true } } as never
  })
  await $.command.run({ command: 'objetivo', args: 'Entrega :: deploy' } as never)
  const antes = abertos.length
  await $.prompt.submit({ text: 'segue' } as never)
  expect(abertos.length).toBe(antes + 1)
})

test('o objetivo vive num arquivo por projeto: sessões em projetos diferentes não se apagam; o store antigo migra uma vez', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }) as never)
  let raiz = '/proj/a'
  on('session.root', () => ({ value: raiz }) as never)
  mock.env(on, { HOME: '/home/u' })
  const fs = new Map<string, string>()
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
  const store = new Map<string, unknown>([[chaveObjetivo('/proj/a'), { titulo: 'Do store antigo', conclusao: 'x', origem: 'claude', itens: [], marco: 0, consumo: [], atualizadoTurno: 0, aviso: null }]])
  on('store.get', (_$, e) => ({ value: store.get((e as { key: string }).key) }) as never)
  on('store.set', (_$, e) => {
    const { key, value } = e as { key: string; value: unknown }
    store.set(key, value)
    return { value: undefined } as never
  })
  on('store.delete', (_$, e) => {
    store.delete((e as { key: string }).key)
    return { value: undefined } as never
  })
  const linha = async (pasta: string) => {
    raiz = pasta
    return JSON.stringify(((await $.prompt.submit({ text: 'oi' } as never)) as unknown as { context?: string[] }).context)
  }
  const arqA = '/home/u/.claude/objetivos/%2Fproj%2Fa.json'
  const arqB = '/home/u/.claude/objetivos/%2Fproj%2Fb.json'

  // Migração: o objetivo de a sai do store e passa ao arquivo de a; a chave some do store.
  expect(await linha('/proj/a')).toContain('Do store antigo')
  expect(JSON.parse(fs.get(arqA)!)).toMatchObject({ raiz: '/proj/a', objetivo: { titulo: 'Do store antigo' } })
  expect(store.has(chaveObjetivo('/proj/a'))).toBe(false)

  // Outra sessão grava o objetivo de b no arquivo de b; mudar o de a não toca o arquivo de b.
  fs.set(arqB, JSON.stringify({ raiz: '/proj/b', objetivo: { titulo: 'Da outra sessão', conclusao: 'y', origem: 'operador', itens: [], marco: 0, consumo: [], atualizadoTurno: 0, aviso: null } }))
  const b = fs.get(arqB)
  await $.command.run({ command: 'objetivo', args: 'Novo de A :: fim' } as never)
  expect(fs.get(arqB)).toBe(b)
  expect(JSON.parse(fs.get(arqA)!).objetivo.titulo).toBe('Novo de A')
  expect(store.size).toBe(0)
  expect(await linha('/proj/b')).toContain('Da outra sessão')

  // Encerrar deixa o arquivo dizendo "sem objetivo": uma chave velha no store não ressuscita.
  expect(await linha('/proj/a')).toContain('Novo de A')
  await $.command.run({ command: 'objetivo', args: 'encerrar' } as never)
  expect(JSON.parse(fs.get(arqA)!)).toEqual({ raiz: '/proj/a', objetivo: null })
  store.set(chaveObjetivo('/proj/a'), { titulo: 'Zumbi', conclusao: 'z', origem: 'claude', itens: [], marco: 0, consumo: [], atualizadoTurno: 0, aviso: null })
  await linha('/proj/b')
  expect(await linha('/proj/a')).toContain('Nenhum objetivo ativo')

  // Um arquivo cuja raiz gravada não é a desta pasta (copiado à mão) não vale para ela.
  fs.set(arqB, JSON.stringify({ raiz: '/proj-b', objetivo: { titulo: 'Colisão', conclusao: 'c', origem: 'claude', itens: [], marco: 0, consumo: [], atualizadoTurno: 0, aviso: null } }))
  expect(await linha('/proj/b')).not.toContain('Colisão')
})

test('arquivo do objetivo: HOME vazio cai no store; pasta sem objetivo não cria arquivo; gravação que falha não apaga o store; arquivo corrompido não ressuscita o store', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }) as never)
  let raiz = '/proj/c'
  on('session.root', () => ({ value: raiz }) as never)
  let home = ''
  on('env.get', () => ({ value: home }) as never)
  const fs = new Map<string, string>()
  let gravaFalha = false
  on('fs.exists', (_$, e) => ({ value: fs.has((e as { path: string }).path) }) as never)
  on('fs.read', (_$, e) => ({ value: fs.get((e as { path: string }).path) }) as never)
  on('fs.write', (_$, e) => {
    if (gravaFalha) throw new Error('EACCES')
    const { path, text } = e as { path: string; text: string }
    fs.set(path, text)
    return { value: undefined } as never
  })
  const goal = (titulo: string) => ({ titulo, conclusao: 'x', origem: 'claude', itens: [], marco: 0, consumo: [], atualizadoTurno: 0, aviso: null })
  const store = new Map<string, unknown>([[chaveObjetivo('/proj/d'), goal('Só no store de d')], [chaveObjetivo('/proj/e'), goal('Zumbi de e')]])
  on('store.get', (_$, e) => ({ value: store.get((e as { key: string }).key) }) as never)
  on('store.set', (_$, e) => {
    const { key, value } = e as { key: string; value: unknown }
    store.set(key, value)
    return { value: undefined } as never
  })
  on('store.delete', (_$, e) => {
    store.delete((e as { key: string }).key)
    return { value: undefined } as never
  })
  const linha = async (pasta: string) => {
    raiz = pasta
    return JSON.stringify(((await $.prompt.submit({ text: 'oi' } as never)) as unknown as { context?: string[] }).context)
  }

  // HOME vazio: nada vai para a raiz do disco; o objetivo vai para o store.
  await linha('/proj/c')
  await $.command.run({ command: 'objetivo', args: 'Sem home :: fim' } as never)
  expect(fs.size).toBe(0)
  expect((store.get(chaveObjetivo('/proj/c')) as { titulo: string }).titulo).toBe('Sem home')

  // Com HOME: passar por uma pasta sem objetivo não cria arquivo.
  home = '/home/u'
  await linha('/proj/sem')
  expect([...fs.keys()]).toEqual([])

  // A migração que não consegue gravar o arquivo deixa o objetivo no store.
  gravaFalha = true
  expect(await linha('/proj/d')).toContain('Só no store de d')
  expect(store.has(chaveObjetivo('/proj/d'))).toBe(true)
  gravaFalha = false

  // Arquivo corrompido: sem objetivo, e a chave velha do store não volta.
  fs.set('/home/u/.claude/objetivos/%2Fproj%2Fe.json', '{corrompido')
  expect(await linha('/proj/e')).toContain('Nenhum objetivo ativo')
})

test('definir e adicionar devolvem a checagem de alinhamento; concluir não', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('session.root', () => ({ value: '/proj/al' }) as never)
  mock.store(on)
  const chamar = async (a: object) => JSON.stringify(await $.tool.call({ tool: TOOL, ...a } as never))
  const def = await chamar({ acao: 'definir', titulo: 'Lançar', conclusao: 'gente de fora experimenta o ciclo', itens: [{ texto: 'fio', tamanho: 'P' }] })
  expect(def).toContain('Alinhamento')
  expect(def).toContain('gente de fora experimenta o ciclo')
  // O estado vem primeiro; a checagem fecha a resposta (rodada 11, #3).
  expect(def.indexOf('Objetivo:')).toBeLessThan(def.indexOf('Alinhamento'))
  expect(await chamar({ acao: 'adicionar', itens: [{ texto: 'readme em inglês', tamanho: 'M' }] })).toContain('Alinhamento')
  expect(await chamar({ acao: 'concluir', ids: [1] })).not.toContain('Alinhamento')
})

const transcriptDe = (...linhas: object[]) => linhas.map(l => JSON.stringify(l)).join('\n') + '\n'
const resp = (id: string, input: number, lidos: number, criados: number) => ({
  type: 'assistant',
  message: { id, usage: { input_tokens: input, cache_read_input_tokens: lidos, cache_creation_input_tokens: criados } },
})
// Um turno inteiro: quem não ouviu o início de um turno não ouve o fim.
const umTurno = async ($: Engine, turnId: string, agentId?: string) => {
  await $.turn.start({ text: '', turnId, ...(agentId ? { agentId } : {}) } as never)
  await $.turn.complete({ turnId, reason: 'answer', answer: 'ok', ...(agentId ? { agentId } : {}) } as never)
}
const usoDoTurno = (input: number, lidos: number) =>
  ({ text: 'ok', usage: { input_tokens: input, output_tokens: 1, cache_read_input_tokens: lidos, cache_creation_input_tokens: 0, model: 'm' } }) as never

test('cache: o transcript semeia uma vez, cada turno da conversa principal soma, a barra mostra o acerto e o painel o detalhe', async ($, on) => {
  on('session.usage', () => ({ value: { context: { tokens: 243000, window: 200000, breakdown: { categories } } } }) as never)
  on('session.id', () => ({ value: 'sess' }) as never)
  on('session.cwd', () => ({ value: '/home/u/Work' }) as never)
  on('session.root', () => ({ value: '/home/u/Work' }) as never)
  mock.env(on, { HOME: '/home/u' })
  const arquivo = '/home/u/.claude/projects/-home-u-Work/sess.jsonl'
  let leituras = 0
  on('fs.exists', (_$, e) => ({ value: (e as { path: string }).path === arquivo }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 1000, mtimeMs: 0, isLink: false } }) as never)
  on('fs.read', (_$, e) => {
    if ((e as { path: string }).path !== arquivo) throw new Error('ENOENT')
    leituras++
    return { value: transcriptDe(resp('m1', 0, 0, 40000), resp('m2', 0, 40000, 0), { ...resp('s', 0, 0, 90000), isSidechain: true }) } as never
  })
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('turn.complete', () => usoDoTurno(0, 80000))

  // Primeiro fim de turno sem semente: semeia do transcript (40k lidos de 80k), sem somar o turno por cima.
  await umTurno($, 't1')
  expect(leituras).toBe(1)
  expect(await barText($)).toContain(' · cache 50%')
  // Turnos seguintes somam o uso sem reler o arquivo; turno de subagente não conta.
  await umTurno($, 't2')
  await umTurno($, 't3', 'sub')
  expect(leituras).toBe(1)
  expect(await barText($)).toContain(' · cache 75%')
  const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'objetivo', surface: 'terminal', props: {} } as never))
  expect(pane).toContain('cache 75% (120k de 160k lidos)')
  expect(pane).toContain('último pedido 243k')
  // Terminal estreito: o acerto sai da barra para não quebrar a linha.
  const larg = async (bodyColumns: number) =>
    JSON.stringify(await $.ui.render({ component: 'AbovePrompt', surface: 'terminal', props: { hasSurvey: false, bodyColumns } } as never))
  expect(await larg(24)).not.toContain('cache')
  // No limite: ' 25%' (4) + ' · cache 75%' (12) + 2 colchetes deixam exatamente 10 células com 28 colunas (sobrevivente #3).
  expect(await larg(28)).toContain(' · cache 75%')
  expect(await larg(27)).not.toContain('cache')
})

test('cache: hook acima que responde o turno sem o uso não apaga a conta; o uso vem do próprio evento (sobrevivente #12 da 3ª rodada)', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('session.id', () => ({ value: 'sess' }) as never)
  on('session.cwd', () => ({ value: '/home/u/Work' }) as never)
  on('session.root', () => ({ value: '/home/u/Work' }) as never)
  mock.env(on, { HOME: '/home/u' })
  const arquivo = '/home/u/.claude/projects/-home-u-Work/sess.jsonl'
  on('fs.exists', (_$, e) => ({ value: (e as { path: string }).path === arquivo }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 1000, mtimeMs: 0, isLink: false } }) as never)
  on('fs.read', () => ({ value: transcriptDe(resp('m1', 0, 0, 40000), resp('m2', 0, 40000, 0)) }) as never)
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  // A hook acima responde com o texto dela e deixa o uso de fora, como o tipo permite.
  on('turn.complete', () => ({ text: 'ok' }) as never)
  await umTurno($, 't1')
  expect(await barText($)).toContain(' · cache 50%')
  await $.turn.start({ text: '', turnId: 't2' } as never)
  await $.turn.complete({ turnId: 't2', reason: 'answer', answer: 'ok', usage: { input_tokens: 0, output_tokens: 1, cache_read_input_tokens: 80000, cache_creation_input_tokens: 0, model: 'm' } } as never)
  expect(await barText($)).toContain(' · cache 75%')
})

test('cache: transcript de exatamente 4 MiB ainda é lido (o limite do $.fs.read é "acima de 4 MiB"); a pasta de trabalho vem antes da raiz (sobreviventes #4 e #7)', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('session.id', () => ({ value: 'sess' }) as never)
  on('session.cwd', () => ({ value: '/w/sub' }) as never)
  on('session.root', () => ({ value: '/w' }) as never)
  mock.env(on, { HOME: '/home/u' })
  const daCwd = '/home/u/.claude/projects/-w-sub/sess.jsonl'
  const daRaiz = '/home/u/.claude/projects/-w/sess.jsonl'
  const lidos: string[] = []
  on('fs.exists', (_$, e) => ({ value: [daCwd, daRaiz].includes((e as { path: string }).path) }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 4 * 1024 * 1024, mtimeMs: 0, isLink: false } }) as never)
  on('fs.read', (_$, e) => {
    const p = (e as { path: string }).path
    lidos.push(p)
    return { value: transcriptDe(p === daCwd ? resp('a', 0, 30, 70) : resp('b', 0, 90, 10)) } as never
  })
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('turn.complete', () => usoDoTurno(10, 990))
  await umTurno($, 't1')
  expect(lidos).toEqual([daCwd])
  expect(await barText($)).toContain(' · cache 30%')
})

test('cache: transcript grande demais não é lido nem quebra a barra; conta desde o carregamento e diz que é parcial', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('session.id', () => ({ value: 'sess' }) as never)
  on('session.cwd', () => ({ value: '/w' }) as never)
  mock.env(on, { HOME: '/home/u' })
  on('fs.exists', () => ({ value: true }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 40 * 1024 * 1024, mtimeMs: 0, isLink: false } }) as never)
  let leituras = 0
  on('fs.read', () => {
    leituras++
    throw new Error('grande demais')
  })
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('turn.complete', () => usoDoTurno(10, 990))
  await umTurno($, 't1')
  expect(leituras).toBe(0)
  expect(await barText($)).not.toContain('cache')
  await umTurno($, 't2')
  expect(await barText($)).toContain(' · cache 99%')
  const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'objetivo', surface: 'terminal', props: {} } as never))
  expect(pane).toContain('desde o carregamento')
})

test('painel: sem cache medido ainda, o tamanho do último pedido aparece sozinho (sobrevivente #12 da 2ª rodada)', async ($, on) => {
  on('session.usage', () => ({ value: { context: { tokens: 243000, window: 200000, breakdown: { categories } } } }) as never)
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  await $.tool.call({ tool: 'Bash', input: { command: 'true' } } as never)
  const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'objetivo', surface: 'terminal', props: {} } as never))
  expect(pane).toContain('último pedido 243k')
  expect(pane).not.toContain('cache')
})

test('a caixa da próxima tem a cor do caso: bloqueante error, do operador warning, do Claude claude (sobrevivente #22 da 2ª rodada)', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('session.root', () => ({ value: '/proj/cor' }) as never)
  mock.store(on)
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  await $.tool.call({ tool: 'Bash', input: { command: 'true' } } as never)
  const corDaProxima = async () => {
    const m = (await barText($)).match(/\{"type":"Text","props":\{"color":"([^"]+)","weight":"bold"\},"children":\["▣"\]\}/)
    return m?.[1]
  }
  await $.command.run({ command: 'objetivo', args: 'Cores :: fim' } as never)
  await $.command.run({ command: 'objetivo', args: 'meu revisar' } as never)
  await $.command.run({ command: 'objetivo', args: 'add codar' } as never)
  expect(await corDaProxima()).toBe('warning')
  await $.command.run({ command: 'objetivo', args: 'feito 1' } as never)
  expect(await corDaProxima()).toBe('claude')
  await $.command.run({ command: 'objetivo', args: 'bloqueante 2' } as never)
  expect(await corDaProxima()).toBe('error')
})

// Uma sessão com relógio na mão e um Bash que vai para o segundo plano.
const sessaoComSegundoPlano = (on: any, opts: { mtime?: (agora: number) => number } = {}) => {
  let agora = 1_000_000
  on('clock.now', () => ({ value: agora }) as never)
  on('session.usage', () => usageWith(50000))
  on('prompt.submit', (_$: unknown, e: { text: string; context?: string[] }) => ({ text: e.text, context: e.context }) as never)
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('classic.Stop', () => ({}) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 0, mtimeMs: opts.mtime ? opts.mtime(agora) : 1_000_000, isLink: false } }) as never)
  on('tool.call', (_$: unknown, e: { tool: string }) =>
    (e.tool === 'Bash'
      ? { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' }, text: 'Command running in background with ID: b1. Output is being written to: /tmp/t/tasks/b1.output. You will be notified when it completes.' }
      : { result: { text: 'ok' } }) as never)
  return { passar: (min: number) => (agora += min * 60000) }
}
const contextoDe = async ($: Engine, text: string) => JSON.stringify(((await $.prompt.submit({ text } as never)) as unknown as { context?: string[] }).context)
const painel = async ($: Engine) => JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'objetivo', surface: 'terminal', props: {} } as never))

test('segundo plano: tarefa muda e sem volta agendada aparece no painel e na linha do próximo pedido; a notificação limpa', async ($, on) => {
  const s = sessaoComSegundoPlano(on)
  await $.tool.call({ tool: 'Bash', command: 'python3 verifica.py', description: 'verificação longa', run_in_background: true } as never)
  await umTurno($, 't1')
  s.passar(12)
  expect(await contextoDe($, 'concluiu?')).toContain(' · ⚠ tarefa em segundo plano sem saída há 12 min, sem volta agendada')
  expect(await painel($)).toContain('segundo plano: verificação longa · sem saída há 12 min · nada agendado para voltar')
  // A barra acima do prompt não ganha linha nova.
  expect(await barText($)).not.toContain('segundo plano')
  const fim = await contextoDe($, '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>')
  expect(fim).not.toContain('⚠')
  expect(await painel($)).not.toContain('segundo plano')
})

test('segundo plano: com ScheduleWakeup depois da tarefa e saída que se mexe, nada alerta; o Stop que não lista a tarefa a tira', async ($, on) => {
  const s = sessaoComSegundoPlano(on, { mtime: agora => agora - 60000 })
  await $.tool.call({ tool: 'Bash', command: 'python3 -u verifica.py', run_in_background: true } as never)
  await $.tool.call({ tool: 'ScheduleWakeup', delaySeconds: 300, prompt: 'conferir', reason: 'r' } as never)
  await umTurno($, 't1')
  s.passar(12)
  expect(await contextoDe($, 'e aí?')).not.toContain('⚠')
  expect(await painel($)).toContain('segundo plano: python3 -u verifica.py · em curso')
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] } as never)
  expect(await painel($)).not.toContain('segundo plano')
})

test('segundo plano: TaskStop tira a tarefa; tarefa de subagente não é registrada', async ($, on) => {
  const s = sessaoComSegundoPlano(on)
  await $.tool.call({ tool: 'Bash', command: 'sleep 999', run_in_background: true, agentId: 'sub' } as never)
  await umTurno($, 't1')
  s.passar(12)
  expect(await contextoDe($, 'oi')).not.toContain('⚠')
  await $.tool.call({ tool: 'Bash', command: 'sleep 999', run_in_background: true } as never)
  await $.tool.call({ tool: 'TaskStop', task_id: 'b1' } as never)
  await umTurno($, 't2')
  s.passar(12)
  expect(await contextoDe($, 'oi')).not.toContain('⚠')
})

test('segundo plano: TaskStop sem id não tira nada; pelo shell_id tira (sobrevivente #13 da 0.10.0)', async ($, on) => {
  const s = sessaoComSegundoPlano(on)
  await $.tool.call({ tool: 'Bash', command: 'sleep 999', run_in_background: true } as never)
  await $.tool.call({ tool: 'TaskStop' } as never)
  await umTurno($, 't1')
  s.passar(12)
  expect(await contextoDe($, 'oi')).toContain('⚠ tarefa em segundo plano')
  await $.tool.call({ tool: 'TaskStop', shell_id: 'b1' } as never)
  expect(await contextoDe($, 'oi')).not.toContain('⚠')
})

test('segundo plano: Monitor depois da tarefa também é volta agendada (sobrevivente #25 da 0.10.0)', async ($, on) => {
  const s = sessaoComSegundoPlano(on)
  await $.tool.call({ tool: 'Bash', command: 'sleep 999', run_in_background: true } as never)
  await $.tool.call({ tool: 'Monitor', command: 'tail -f x' } as never)
  await umTurno($, 't1')
  s.passar(1)
  expect(await contextoDe($, 'oi')).not.toContain('sem volta agendada')
})

test('publicar com a verificação aberta: a nota vem com o resultado, sem negar; sem pendência aberta ou com git status, nada', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('session.root', () => ({ value: '/proj/pub' }) as never)
  mock.store(on)
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }) as never)
  const notas = async (command: string) => {
    const r = (await $.tool.call({ tool: 'Bash', command } as never)) as { deny?: string; context?: string[] }
    expect(r.deny).toBe(undefined)
    return JSON.stringify(r.context ?? [])
  }
  expect(await notas('git push')).not.toContain('esta ação publica')
  await $.command.run({ command: 'objetivo', args: 'Camada no ar :: operador abre a URL' } as never)
  await $.command.run({ command: 'objetivo', args: 'add verificar a camada no ar' } as never)
  expect(await notas('cp -r build/ output/espelhos/camada')).toContain('esta ação publica e a pendência #1 \\"verificar a camada no ar\\" está aberta')
  expect(await notas('git status')).not.toContain('esta ação publica')
  await $.command.run({ command: 'objetivo', args: 'feito 1' } as never)
  expect(await notas('git push')).not.toContain('esta ação publica')
})

// Visual 1: o painel novo (medidores, Agora, sua vez com botão, fila, feitas recolhidas, indicadores de outros mods).
const PAINEL = { component: 'Pane', requestId: 'objetivo', props: { bodyColumns: 48 } } as const
const comObjetivo = async ($: Engine) => {
  await $.command.run({ command: 'objetivo', args: 'Painel novo :: o operador usa o painel sem digitar e o efeito aparece no objetivo' } as never)
  await $.command.run({ command: 'objetivo', args: 'meu conferir a faixa' } as never)
  await $.command.run({ command: 'objetivo', args: 'add desenhar os medidores com largura exata e sem quebrar em terminal estreito de jeito nenhum' } as never)
  await $.command.run({ command: 'objetivo', args: 'add escrever os testes' } as never)
  await $.command.run({ command: 'objetivo', args: 'melhoria 3' } as never)
}

test('painel: o botão Feito conclui a pendência do operador, e ela vai para as feitas recolhidas', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  await comObjetivo($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'contexto-bar', surface, ...PAINEL } as never)
    if (surface === 'terminal') {
      expect(await ui.find({ key: 'feito-1' } as never)).toBeDefined()
      await ui.press({ key: 'feito-1' } as never)
    }
    expect(await ui.find({ key: 'feito-1' } as never)).toBeUndefined()
    expect(await ui.find({ type: 'Button', text: /1 feita ▸/ } as never)).toBeDefined()
    await ui.unmount()
  }
  // Concluída pelo operador: a próxima passa a ser do Claude e o resumo marca a #1.
  const ver = JSON.stringify(await $.tool.call({ tool: TOOL, acao: 'ver' } as never))
  expect(ver).toContain('[x] #1')
  expect(ver).toContain('[ ] #2')
})

test('painel: as feitas abrem e fecham pelo botão; a fila do Claude não repete a próxima e pinta o nível', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  await comObjetivo($)
  await $.command.run({ command: 'objetivo', args: 'feito 1' } as never)
  const ui = await $.ui.mount({ plugin: 'contexto-bar', surface: 'terminal', ...PAINEL } as never)
  expect(await ui.find({ type: 'Text', text: /#1 conferir a faixa/ } as never)).toBeUndefined()
  await ui.press({ key: 'feitas' } as never)
  expect(await ui.find({ type: 'Button', text: /1 feita ▾/ } as never)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /#1 conferir a faixa/ } as never)).toBeDefined()
  await ui.press({ key: 'feitas' } as never)
  expect(await ui.find({ type: 'Text', text: /#1 conferir a faixa/ } as never)).toBeUndefined()
  await ui.unmount()
  const pane = await painel($)
  // A #2 é a próxima (no Agora); na fila só a #3, que é melhoria (apagada, ponto subtle).
  expect(pane).toContain('▣ #')
  expect(pane.match(/desenhar os medidores/g)?.length).toBe(1)
  expect(pane).toContain('{"type":"Text","props":{"color":"subtle"},"children":["·"]}," #","3"')
  expect(pane).toContain('FILA DO CLAUDE')
})

test('painel: texto longo cabe numa linha e o resto só aparece com o ponteiro em cima', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  await comObjetivo($)
  await $.command.run({ command: 'objetivo', args: 'add uma pendência com um texto comprido o bastante para não caber em quarenta e oito colunas de painel' } as never)
  const pane = await painel($)
  // 48 colunas: '● #4 ' (5) + 43 de texto, a última delas as reticências.
  expect(pane).toContain('"uma pendência com um texto comprido o bast…"')
  expect(pane).toContain('{"type":"Box","props":{"display":"none","paddingLeft":5},"hover":{"display":"flex"},"children":[{"type":"Text","props":{"dimColor":true,"wrap":"wrap"},"children":["…","ante para não caber em quarenta e oito colunas de painel"]}]}')
  // A conclusão também: uma linha de 48, o resto no hover.
  expect(pane).toContain('"conclui: o operador usa o painel sem digitar e …"')
  expect(pane).toContain('"…","o efeito aparece no objetivo"')
  // Texto que cabe não ganha hover.
  expect(pane).not.toContain('"…","escrever os testes"')
})

test('painel: o botão auto liga e desliga o painel automático, como o /objetivo auto', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  mock.store(on)
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }) as never)
  const abertos: string[] = []
  on('ui.open', (_$, e) => {
    abertos.push((e as { id: string }).id)
    return { value: { isPlaced: true } } as never
  })
  await comObjetivo($)
  const ui = await $.ui.mount({ plugin: 'contexto-bar', surface: 'terminal', ...PAINEL } as never)
  expect(await ui.find({ type: 'Button', text: /auto ligado/ } as never)).toBeDefined()
  await ui.press({ key: 'auto' } as never)
  expect(await ui.find({ type: 'Button', text: /auto desligado/ } as never)).toBeDefined()
  await ui.unmount()
  // Desligado pelo botão: o pedido seguinte não abre o painel.
  await $.prompt.submit({ text: 'segue' } as never)
  expect(abertos).toEqual([])
  await $.command.run({ command: 'objetivo', args: 'auto on' } as never)
  expect(await painel($)).toContain('auto ligado')
})

test('painel: o Agora mostra o estado do agente (trabalhando com a ferramenta, concluído no fim do turno)', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }) as never)
  let durante = ''
  on('tool.call', async () => {
    durante = await painel($)
    return { result: { text: 'ok' } } as never
  })
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('turn.complete', () => usoDoTurno(0, 0))
  expect(await painel($)).toContain('"○"," ","ocioso"')
  await $.prompt.submit({ text: 'vai' } as never)
  expect(await painel($)).toContain('"●"," ","trabalhando"')
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  expect(durante).toContain('trabalhando · Bash')
  expect(await painel($)).not.toContain('trabalhando · Bash')
  await umTurno($, 't1')
  expect(await painel($)).toContain('"✔"," ","concluído"')
  // Subagente não mexe no estado da conversa principal.
  await $.tool.call({ tool: 'Read', file_path: '/x', agentId: 'sub' } as never)
  expect(await painel($)).toContain('concluído')
  expect(durante).not.toContain('trabalhando · Read')
})

test('painel: indicadores de outros mods viram medidores; arquivo quebrado não apaga os outros', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  mock.env(on, { HOME: '/home/u' })
  const pasta = '/home/u/.claude/indicadores'
  const arquivos: Record<string, string> = {
    'prova-de-teste.json': JSON.stringify({ versao: 1, fonte: 'prova-de-teste', itens: [{ id: 'exp-001', rotulo: 'EXP-001', valor: 28, meta: 10, estado: 'ok', detalhe: 'promoção: 3/3 critérios' }] }),
    'quebrado.json': '{ não é json',
    'outro.json': JSON.stringify({ versao: 1, fonte: 'outro', itens: [{ id: 'n', rotulo: 'rodadas', valor: 3, unidade: 'hoje' }] }),
    'leia.txt': 'ignorado',
  }
  on('fs.exists', (_$, e) => ({ value: (e as { path: string }).path === pasta }) as never)
  on('fs.list', () => ({ value: [...Object.keys(arquivos).map(name => ({ name, kind: 'file' })), { name: 'sub.json', kind: 'dir' }] }) as never)
  on('fs.read', (_$, e) => {
    const nome = (e as { path: string }).path.slice(pasta.length + 1)
    if (!(nome in arquivos)) throw new Error('ENOENT')
    return { value: arquivos[nome] } as never
  })
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  const pane = await painel($)
  // Ordem estável pelo nome do arquivo, qualquer que seja a ordem da pasta (sobrevivente M5 da 0.11.0).
  expect(pane.indexOf('"rodadas    "') < pane.indexOf('"EXP-001    "')).toBe(true)
  expect(pane).toContain('"EXP-001    "')
  expect(pane).toContain('"28/10 ✓"')
  expect(pane).toContain('promoção: 3/3 critérios')
  expect(pane).toContain('"3 hoje"')
  expect(pane).not.toContain('ignorado')
  // O arquivo some: o medidor sai no próximo refresh.
  delete arquivos['prova-de-teste.json']
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  expect(await painel($)).not.toContain('EXP-001')
})

test('painel: com o store fora, o botão auto ainda mostra e vale o que o operador escolheu (sobrevivente M9 da 0.11.0)', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }) as never)
  on('store.get', () => {
    throw new Error('store fora')
  })
  on('store.set', () => {
    throw new Error('store fora')
  })
  on('store.delete', () => ({ value: undefined }) as never)
  const abertos: string[] = []
  on('ui.open', (_$, e) => {
    abertos.push((e as { id: string }).id)
    return { value: { isPlaced: true } } as never
  })
  await comObjetivo($)
  const ui = await $.ui.mount({ plugin: 'contexto-bar', surface: 'terminal', ...PAINEL } as never)
  await ui.press({ key: 'auto' } as never)
  expect(await ui.find({ type: 'Button', text: /auto desligado/ } as never)).toBeDefined()
  await ui.unmount()
  await $.prompt.submit({ text: 'segue' } as never)
  expect(abertos).toEqual([])
})

test('painel: a vez do operador vem na ordem da prioridade, bloqueante primeiro (sobrevivente M10 da 0.11.0)', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  await $.command.run({ command: 'objetivo', args: 'Ordem :: o operador vê primeiro o que trava' } as never)
  await $.command.run({ command: 'objetivo', args: 'meu revisar o texto' } as never)
  await $.command.run({ command: 'objetivo', args: 'meu aprovar o deploy' } as never)
  await $.command.run({ command: 'objetivo', args: 'bloqueante 2' } as never)
  const pane = await painel($)
  const sua = pane.slice(pane.indexOf('SUA VEZ'))
  expect(sua.indexOf('aprovar o deploy') < sua.indexOf('revisar o texto')).toBe(true)
})

test('painel: a cor do medidor da janela muda em 60% e em 80% exatos (sobrevivente #7 da 0.11.0)', async ($, on) => {
  let pct = 0
  on('session.usage', () => ({ value: { context: { breakdown: { categories: [
    { name: 'Messages', tokens: pct * 1000, kind: 'used' },
    { name: 'Free space', tokens: (100 - pct) * 1000, kind: 'free' },
  ] } } } }) as never)
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  const cor = async (p: number) => {
    pct = p
    await $.tool.call({ tool: 'Bash', command: 'true' } as never)
    const m = /"janela     "\]\},\{"type":"Text","props":\{"color":"(\w+)"\}.*?"(\d+)%/.exec(await painel($))
    expect(m?.[2]).toBe(String(p))
    return m?.[1]
  }
  expect(await cor(59)).toBe('success')
  expect(await cor(60)).toBe('warning')
  expect(await cor(79)).toBe('warning')
  expect(await cor(80)).toBe('error')
})

test('painel: as barras dos medidores terminam todas na mesma coluna', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  mock.env(on, { HOME: '/home/u' })
  const pasta = '/home/u/.claude/indicadores'
  on('fs.exists', (_$, e) => ({ value: (e as { path: string }).path === pasta }) as never)
  on('fs.list', () => ({ value: [{ name: 'p.json', kind: 'file' }] }) as never)
  on('fs.read', () => ({ value: JSON.stringify({ versao: 1, fonte: 'p', itens: [{ id: 'e', rotulo: 'EXP-001', valor: 29, meta: 10 }] }) }) as never)
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  await comObjetivo($)
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  // Pares cheio + vazio de cada medidor (pendências, janela, EXP-001): a soma é a mesma em todos.
  const pane = await painel($)
  const somas = [...pane.matchAll(/"children":\["(█*)"\]\},\{"type":"Text","props":\{"dimColor":true\},"children":\["(░*)"\]/g)].map(m => m[1]!.length + m[2]!.length)
  expect(somas.length).toBe(3)
  expect(new Set(somas).size).toBe(1)
})

test('painel: a fila do Claude vem na ordem da prioridade, melhoria por último (sobrevivente #7 da lista final da 0.11.0)', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  await comObjetivo($)
  // #3 é melhoria e veio antes; #4 é requisito e veio depois: na fila, #4 antes de #3.
  await $.command.run({ command: 'objetivo', args: 'add revisar o contraste' } as never)
  const pane = await painel($)
  const fila = pane.slice(pane.indexOf('FILA DO CLAUDE'))
  expect(fila.indexOf('revisar o contraste') < fila.indexOf('escrever os testes')).toBe(true)
})
