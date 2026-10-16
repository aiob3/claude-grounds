import { atom, read } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import { buildSnapshot, cellsFor, chaveObjetivo, fecharAsOutras, fecharJunto, groupOf, TOOL } from './register'

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
  const titulos: string[] = []
  on('ui.open', (_$, e) => {
    abertos.push((e as { id: string }).id)
    titulos.push((e as { title: string }).title)
    return { value: { isPlaced: true } } as never
  })
  await $.prompt.submit({ text: 'oi' } as never)
  expect(abertos).toEqual([])
  await $.command.run({ command: 'objetivo', args: 'Entrega :: deploy' } as never)
  const antes = abertos.length
  await $.prompt.submit({ text: 'segue' } as never)
  // As quatro abas; a do objetivo por último, para ser a mostrada (a superfície mostra a última aberta).
  expect(abertos.slice(antes)).toEqual(['caderno', 'prova', 'agentes', 'objetivo'])
  expect(titulos.slice(antes)).toEqual(['Caderno', 'Prova', 'Agentes', 'Objetivo'])
  // Desligado, o pedido não abre; ligado de novo, volta a abrir.
  const off = JSON.stringify(await $.command.run({ command: 'objetivo', args: 'auto off' } as never))
  expect(off).toContain('não abre mais sozinho')
  const n = abertos.length
  await $.prompt.submit({ text: 'segue' } as never)
  expect(abertos.length).toBe(n)
  await $.command.run({ command: 'objetivo', args: 'auto on' } as never)
  await $.prompt.submit({ text: 'segue' } as never)
  expect(abertos.length).toBe(n + 4)
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
  expect(abertos.length).toBe(antes + 4)
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
  // Só o transcript conta: o caderno e os indicadores também leem arquivos.
  on('fs.read', (_$, e) => {
    if ((e as { path: string }).path.includes('/.claude/projects/')) leituras++
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
const aba = async ($: Engine, requestId: string) => JSON.stringify(await $.ui.render({ component: 'Pane', requestId, surface: 'terminal', props: {} } as never))
// O painel inteiro: as quatro abas, na ordem em que aparecem.
const painel = async ($: Engine) => (await Promise.all(['objetivo', 'caderno', 'prova', 'agentes'].map(a => aba($, a)))).join('\n')

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
  expect(pane.indexOf('" rodadas   "') < pane.indexOf('"  EXP-001  "')).toBe(true)
  expect(pane).toContain('"  28/10  "')
  expect(pane).toContain('promoção: 3/3 critérios')
  expect(pane).toContain('"    3    "')
  // Sem meta, o arco fica todo na trilha: nada aceso (sobrevivente #28 da 0.13.0).
  const semMeta = pane.slice(pane.indexOf('"key":"g-outro-n"'), pane.indexOf('"key":"g-prova-de-teste-exp-001"'))
  expect(semMeta).toContain('"color":"inactive"')
  expect(/"color":"claude"\},"children":\["[╭─╮╱╲│]/.test(semMeta)).toBe(false)
  expect(pane).not.toContain('ignorado')
  // O arquivo some: o medidor sai no próximo refresh.
  delete arquivos['prova-de-teste.json']
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  expect(await painel($)).not.toContain('"  EXP-001  "')
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

test('painel: a fila do Claude vem na ordem da prioridade, melhoria por último (sobrevivente #7 da lista final da 0.11.0)', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  await comObjetivo($)
  // #3 é melhoria e veio antes; #4 é requisito e veio depois: na fila, #4 antes de #3.
  await $.command.run({ command: 'objetivo', args: 'add revisar o contraste' } as never)
  const pane = await painel($)
  const fila = pane.slice(pane.indexOf('FILA DO CLAUDE'))
  expect(fila.indexOf('revisar o contraste') < fila.indexOf('escrever os testes')).toBe(true)
})

// O caderno do operador: arquivo simulado, gravado pelo `cat >>` que o mod roda.
type Montado = { input: (t: object) => Promise<unknown>; press: (t: object) => Promise<unknown>; find: (q: object) => Promise<unknown>; unmount: () => Promise<void> }
const montar = async ($: Engine, requestId = 'caderno') => (await $.ui.mount({ plugin: 'contexto-bar', surface: 'terminal', ...PAINEL, requestId } as never)) as unknown as Montado
const comCaderno = (on: Parameters<TestBody>[1]) => {
  let arq = ''
  const execs: { argv: readonly string[] }[] = []
  mock.env(on, { HOME: '/h' })
  on('session.root', () => ({ value: '/proj/c' }) as never)
  on('fs.exists', (_$, e) => ({ value: (e as { path: string }).path.endsWith('.jsonl') && arq !== '' }) as never)
  on('fs.read', (_$, e) => {
    if ((e as { path: string }).path.endsWith('.jsonl')) return { value: arq } as never
    throw new Error('ENOENT')
  })
  on('process.run', (_$, e) => {
    const r = e as { argv: readonly string[]; init?: { stdin?: string } }
    execs.push({ argv: r.argv })
    arq += r.init?.stdin ?? ''
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  return { texto: () => arq, execs }
}

test('caderno: a nota escrita no painel chega ao Claude no resultado da próxima ferramenta, uma vez, com o propósito na primeira', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }) as never)
  const c = comCaderno(on)
  await comObjetivo($)
  const ui = await montar($)
  await ui.input({ key: 'nota-0', text: 'e se o painel tiver abas nativas?' } as never)
  // O campo volta vazio (chave nova) e a nota aparece aguardando.
  expect(await ui.find({ key: 'nota-1' } as never)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /e se o painel tiver abas nativas\?/ } as never)).toBeDefined()
  await ui.unmount()
  // Gravada por acréscimo no arquivo do projeto, ligada à próxima pendência.
  expect(c.execs[0]!.argv).toEqual(['sh', '-c', 'mkdir -p "$(dirname "$1")" && cat >> "$1"', '_', '/h/.claude/caderno/%2Fproj%2Fc.jsonl'])
  const gravada = JSON.parse(c.texto().trim())
  expect(gravada).toMatchObject({ v: 1, ev: 'nota', autor: 'operador', tipo: 'nota', texto: 'e se o painel tiver abas nativas?', ref: '#1' })
  const r = JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'true' } as never))
  expect(r).toContain(`[caderno] Nota nova do operador: ${gravada.id} (nota, sobre #1, agora há pouco)`)
  expect(r).toContain('advisor e um adversário')
  // Não volta na ferramenta seguinte; a linha do pedido conta a nota sem resposta.
  expect(JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'true' } as never))).not.toContain('[caderno]')
  expect(await contextoDe($, 'segue')).toContain(' · caderno: 1 sem resposta')
  // A segunda nota da sessão chega sem repetir o propósito (sobrevivente #4 da 0.12.0).
  await $.command.run({ command: 'objetivo', args: 'nota agora trocar as barras por gauges' } as never)
  const segunda = JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'true' } as never))
  expect(segunda).toContain('[caderno] Nota nova do operador')
  expect(segunda).toContain('(agora, sobre #1, agora há pouco): trocar as barras por gauges')
  expect(segunda).not.toContain('advisor e um adversário')
})

test('caderno: a triagem do Claude grava, some da contagem e aparece no painel com o motivo; erros explicam', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }) as never)
  const c = comCaderno(on)
  await comObjetivo($)
  await $.command.run({ command: 'objetivo', args: 'nota depois #3 levar o caderno para o herdr' } as never)
  const nota = JSON.parse(c.texto().trim())
  expect(nota).toMatchObject({ tipo: 'depois', ref: '#3', texto: 'levar o caderno para o herdr' })
  // Nota vazia pelo comando: diz que nada foi gravado (sobrevivente #5 da 0.12.0).
  expect(JSON.stringify(await $.command.run({ command: 'objetivo', args: 'nota agora    ' } as never))).toContain('nada gravado')
  expect(c.texto().trim().split('\n').length).toBe(1)
  const triar = async (a: object) => JSON.stringify(await $.tool.call({ tool: TOOL, acao: 'triar', ...a } as never))
  expect(await triar({ nota: 'n-x', decisao: 'aceita', motivo: 'm' })).toContain(`Abertas: ${nota.id}`)
  expect(await triar({ nota: nota.id, decisao: 'talvez', motivo: 'm' })).toContain('decisao é uma de aceita, recusada, muda-plano, registrada')
  expect(await triar({ nota: nota.id, decisao: 'aceita', motivo: '  ' })).toContain('diga o motivo')
  expect(c.texto().trim().split('\n').length).toBe(1)
  const ok = await triar({ nota: nota.id, decisao: 'aceita', motivo: 'entra na fase 1 do herdr', destino: 'roadmap', contraponto: 'pode pesar no painel' })
  expect(ok).toContain(`Triagem gravada: ${nota.id} aceita → roadmap. Entrou no roadmap como R1 (depois). Nenhuma nota sem resposta.`)
  expect(JSON.parse(c.texto().trim().split('\n')[1]!)).toMatchObject({ v: 1, ev: 'triagem', id: nota.id, autor: 'claude', decisao: 'aceita', motivo: 'entra na fase 1 do herdr', destino: 'roadmap', contraponto: 'pode pesar no painel' })
  expect(await contextoDe($, 'segue')).not.toContain('caderno:')
  const pane = await painel($)
  expect(pane).toContain('"✔"]},{"type":"Text","props":{"dimColor":true},"children":[" ","depois"," "]}')
  expect(pane).toContain('aceita: entra na fase 1 do herdr → roadmap')
  expect(pane).toContain('"contra: ","pode pesar no painel"')
})

test('caderno: os tipos são botões, a regra do escolhido aparece, e a nota sai com ele; celular mostra o comando', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  const c = comCaderno(on)
  const ui = await montar($)
  expect(await ui.find({ type: 'Text', text: /sem mudar de rumo/ } as never)).toBeDefined()
  await ui.press({ key: 'tipo-referencia' } as never)
  expect(await ui.find({ type: 'Text', text: /link, busca ou imagem/ } as never)).toBeDefined()
  await ui.input({ key: 'nota-0', text: 'https://ratatui.rs/examples/widgets/gauge/' } as never)
  await ui.unmount()
  expect(JSON.parse(c.texto().trim())).toMatchObject({ tipo: 'referencia' })
  expect(JSON.parse(c.texto().trim())).not.toHaveProperty('ref')
  // Nota vazia não grava nada.
  const ui2 = await montar($)
  await ui2.input({ key: 'nota-1', text: '   ' } as never)
  await ui2.unmount()
  expect(c.texto().trim().split('\n').length).toBe(1)
  const cel = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'caderno', surface: 'mobile', props: { bodyColumns: 48 } } as never))
  expect(cel).toContain('/objetivo nota [tipo] [#id] texto')
  expect(cel).not.toContain('"Input"')
})

test('caderno: sem ferramenta no meio, a nota chega no próximo pedido; o painel mostra a mais recente primeiro; rótulo com acento vale no comando (sobreviventes #8, #19 e #21 da 0.12.0)', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }) as never)
  const c = comCaderno(on)
  await comObjetivo($)
  await $.command.run({ command: 'objetivo', args: 'nota primeira observação' } as never)
  await $.command.run({ command: 'objetivo', args: 'nota referência https://ratatui.rs gauges' } as never)
  const ultima = JSON.parse(c.texto().trim().split('\n')[1]!)
  expect(ultima).toMatchObject({ tipo: 'referencia', texto: 'https://ratatui.rs gauges' })
  const ctx = await contextoDe($, 'segue')
  expect(ctx).toContain('[caderno] 2 notas novas do operador')
  expect(ctx).toContain('primeira observação')
  const pane = await painel($)
  expect(pane.indexOf('https://ratatui.rs gauges') < pane.indexOf('primeira observação')).toBe(true)
})

test('painel: gauges lado a lado com a cor da janela em 60% e 80% exatos; braille no Kitty, caixa sem ele (sobrevivente #7 da 0.11.0)', async ($, on) => {
  let pct = 0
  on('session.usage', () => ({ value: { context: { breakdown: { categories: [
    { name: 'Messages', tokens: pct * 1000, kind: 'used' },
    { name: 'Free space', tokens: (100 - pct) * 1000, kind: 'free' },
  ] } } } }) as never)
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  mock.env(on, { KITTY_WINDOW_ID: '1' })
  const cor = async (p: number) => {
    pct = p
    await $.tool.call({ tool: 'Bash', command: 'true' } as never)
    const m = new RegExp(`"color":"(\\w+)","weight":"bold"\\},"children":\\[" *${p}% *"\\]`).exec(await painel($))
    return m?.[1]
  }
  expect(await cor(59)).toBe('success')
  expect(await cor(60)).toBe('warning')
  expect(await cor(79)).toBe('warning')
  expect(await cor(80)).toBe('error')
  const pane = await painel($)
  expect(pane).toContain('"  janela   "')
  expect(/[\u2801-\u28ff]/.test(pane)).toBe(true)
  expect(pane).not.toContain('╭')
  // Cache não é gauge: fica no rodapé.
  expect(pane).not.toContain('"   cache   "')
})

test('painel: sem Kitty, os gauges saem em caixa; no desktop também', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  mock.env(on, { TERM: 'alacritty' })
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  expect(await painel($)).toContain('╭')
  const desk = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'objetivo', surface: 'desktop', props: { bodyColumns: 48 } } as never))
  expect(desk).toContain('╭')
  expect(desk).not.toMatch(/[\u2801-\u28ff]/)
})

test('painel: quem executa — modelo e effort da conversa principal, subagentes vivos com tipo e tarefa no hover', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('turn.step', async function* (_$, e) {
    yield { kind: 'input', index: 0, json: '' } as never
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  let proximo = 'ag1'
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: proximo }) as never)
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('turn.complete', () => usoDoTurno(0, 0))
  const passo = async (a: object) => {
    const st = $.turn.step({ turnId: 't', index: 0, messageCount: 1, ...a } as never) as unknown as AsyncIterable<unknown>
    for await (const _ of st) void _
  }
  await passo({ model: 'claude-opus-5-5', effort: 'high' })
  expect(await painel($)).toContain('Opus 5.5 · effort high')
  await $.agent.spawn({ tool_use_id: 'tu', prompt: 'p', description: 'varrer os testes', subagentType: 'Explore', provider: { kind: 'engine' } } as never)
  await passo({ model: 'claude-sonnet-5-5', effort: 'low', agentId: 'ag1' })
  let pane = await painel($)
  expect(pane).toContain('"Opus 5.5 · effort high"," · 1 subagente (aba Agentes)"')
  expect(pane).toContain('"Explore"')
  expect(pane).toContain('Sonnet 5.5')
  expect(pane).toContain(', low')
  expect(pane).toContain('varrer os testes')
  // O mesmo id duas vezes não duplica; um segundo subagente entra depois do primeiro (sobreviventes #8 e #9 da 0.13.0).
  await $.agent.spawn({ tool_use_id: 'tu', prompt: 'p', description: 'varrer os testes', subagentType: 'Explore', provider: { kind: 'engine' } } as never)
  expect(await painel($)).toContain('" · 1 subagente (aba Agentes)"')
  proximo = 'ag2'
  await $.agent.spawn({ tool_use_id: 'tu2', prompt: 'p', description: 'rever o diff', subagentType: 'Plan', provider: { kind: 'engine' } } as never)
  pane = await painel($)
  expect(pane).toContain('" · 2 subagentes (aba Agentes)"')
  expect(pane.indexOf('varrer os testes') < pane.indexOf('rever o diff')).toBe(true)
  await umTurno($, 'ts2', 'ag2')
  // O subagente termina: sai da lista; a conversa principal fica.
  await umTurno($, 'ts', 'ag1')
  pane = await painel($)
  expect(pane).not.toContain('subagente')
  expect(pane).toContain('Opus 5.5 · effort high')
  // Passo sem effort (modelo que não aceita): só o modelo (sobrevivente #16 da 0.13.0).
  await passo({ model: 'claude-haiku-4-5' })
  pane = await painel($)
  expect(pane).toContain('"Haiku 4.5"')
  expect(pane).not.toContain('undefined')
})

test('caderno: tipos com atalho 1 a 4 e o escolhido marcado; a última nota mostra se já foi respondida', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  const c = comCaderno(on)
  await comObjetivo($)
  let pane = await painel($)
  expect(pane).toContain('"key":"tipo-nota","label":"● nota","hotkey":"1","variant":"primary"')
  expect(pane).toContain('"key":"tipo-referencia","label":"referência","hotkey":"4","variant":"secondary"')
  expect(pane).toContain('clique no campo (ou ctrl+x tab) · Enter envia')
  // O campo sem rótulo: o terminal desenhava "✎ :" antes do texto.
  expect(pane).toContain('"placeholder":"✎ escreva aqui; #id no começo liga a uma pendência"')
  expect(pane).not.toContain('"label":"✎')
  await $.command.run({ command: 'objetivo', args: 'nota olhar o contraste' } as never)
  pane = await painel($)
  expect(pane).toContain('◌ última nota enviada agora há pouco: chega ao Claude na próxima ferramenta')
  const id = JSON.parse(c.texto().trim()).id
  await $.tool.call({ tool: TOOL, acao: 'triar', nota: id, decisao: 'registrada', motivo: 'ok' } as never)
  expect(await painel($)).toContain('✔ última nota respondida: registrada')
})

test('duas sessões na mesma pasta: a mudança de uma aparece na outra e nenhuma apaga a outra; arquivo pela metade é ignorado', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }) as never)
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  on('session.root', () => ({ value: '/proj/m' }) as never)
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'resumo', toolUses: [] }] }) as never)
  mock.env(on, { HOME: '/home/u' })
  const arquivo = '/home/u/.claude/objetivos/%2Fproj%2Fm.json'
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
  const chamar = async (a: object) => JSON.stringify(await $.tool.call({ tool: TOOL, ...a } as never))
  await chamar({ acao: 'definir', titulo: 'Juntos', conclusao: 'as duas sessões veem a mesma fila', itens: [{ texto: 'tarefa desta sessão' }] })
  // A outra sessão acrescenta uma pendência direto no arquivo.
  const outra = JSON.parse(fs.get(arquivo)!)
  outra.objetivo.itens.push({ id: 2, texto: 'tarefa da outra sessão', dono: 'claude', tamanho: 'P', feito: false, nivel: 'requisito' })
  fs.set(arquivo, JSON.stringify(outra))
  // Depois de uma ferramenta qualquer, esta sessão já mostra a pendência da outra.
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  expect(await painel($)).toContain('tarefa da outra sessão')
  // E concluir aqui não apaga o que a outra fez.
  const r = await chamar({ acao: 'concluir', ids: [1] })
  expect(r).toContain('[x] #1')
  expect(r).toContain('[ ] #2 (claude, P) tarefa da outra sessão')
  expect(JSON.parse(fs.get(arquivo)!).objetivo.itens.map((i: { texto: string }) => i.texto)).toEqual(['tarefa desta sessão', 'tarefa da outra sessão'])
  // A outra sessão conclui a #2 pelo arquivo, e o próximo pedido daqui já vê.
  const de2 = JSON.parse(fs.get(arquivo)!)
  de2.objetivo.itens[1].feito = true
  fs.set(arquivo, JSON.stringify(de2))
  expect(await contextoDe($, 'segue')).toContain('2/2')
  // A outra sessão grava e esta muda logo em seguida, sem ferramenta no meio: a mudança vai por cima da outra.
  const de3 = JSON.parse(fs.get(arquivo)!)
  de3.objetivo.itens.push({ id: 3, texto: 'mais uma da outra sessão', dono: 'claude', tamanho: 'P', feito: false, nivel: 'requisito' })
  fs.set(arquivo, JSON.stringify(de3))
  await chamar({ acao: 'adicionar', itens: [{ texto: 'mais uma desta sessão' }] })
  expect(JSON.parse(fs.get(arquivo)!).objetivo.itens.map((i: { id: number }) => i.id)).toEqual([1, 2, 3, 4])
  // O mesmo pelo /objetivo do operador.
  const de4 = JSON.parse(fs.get(arquivo)!)
  de4.objetivo.itens.push({ id: 5, texto: 'quinta, da outra', dono: 'claude', tamanho: 'P', feito: false, nivel: 'requisito' })
  fs.set(arquivo, JSON.stringify(de4))
  await $.command.run({ command: 'objetivo', args: 'feito 4' } as never)
  const final = JSON.parse(fs.get(arquivo)!).objetivo.itens
  expect(final.map((i: { id: number }) => i.id)).toEqual([1, 2, 3, 4, 5])
  expect(final.find((i: { id: number }) => i.id === 4).feito).toBe(true)
  // A compactação grava o marco do objetivo: também por cima do que a outra sessão acabou de gravar.
  const de5 = JSON.parse(fs.get(arquivo)!)
  de5.objetivo.itens.push({ id: 6, texto: 'sexta, da outra', dono: 'claude', tamanho: 'P', feito: false, nivel: 'requisito' })
  de5.objetivo.marco = 999
  de5.objetivo.aviso = 'apertado'
  fs.set(arquivo, JSON.stringify(de5))
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'antes', toolUses: [] }] } as never)
  const depois = JSON.parse(fs.get(arquivo)!).objetivo
  expect(depois.itens.map((i: { id: number }) => i.id)).toEqual([1, 2, 3, 4, 5, 6])
  // E a mudança desta sessão (o marco da compactação) não se perde ao juntar (manual #3 da 0.13.1).
  expect(depois.marco).not.toBe(999)
  expect(depois.aviso).toBeNull()
  // Arquivo pela metade (a outra sessão no meio da escrita): fica a cópia desta sessão.
  fs.set(arquivo, '{ "raiz": "/proj/m", "objetivo": { "tit')
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  expect(await painel($)).toContain('Juntos')
  // Arquivo sem a raiz também não (sobrevivente #5 da 0.13.1).
  fs.set(arquivo, JSON.stringify({ objetivo: { ...de2.objetivo, titulo: 'Sem raiz' } }))
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  expect(await painel($)).not.toContain('Sem raiz')
  // Arquivo de outra pasta (raiz diferente) não é lido como o desta.
  fs.set(arquivo, JSON.stringify({ raiz: '/outra', objetivo: { ...de2.objetivo, titulo: 'Intruso' } }))
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  expect(await painel($)).not.toContain('Intruso')
  // A outra sessão encerra o objetivo: esta também fica sem (sobrevivente #1 da 0.13.1).
  fs.set(arquivo, JSON.stringify({ raiz: '/proj/m', objetivo: null }))
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  expect(await painel($)).toContain('Nenhum objetivo ativo.')
})

test('caderno: o texto longo aparece inteiro numa prévia enquanto o operador digita ou cola; enviar limpa a prévia (nota do operador, 15/10)', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  const c = comCaderno(on)
  const longo = 'um texto colado bem mais longo do que cabe numa linha do campo, com detalhes que o operador precisa conferir antes de enviar'
  const ui = await montar($)
  expect(await ui.find({ type: 'Text', text: /prévia/ } as never)).toBeUndefined()
  await ui.input({ key: 'nota-0', text: longo, kind: 'change' } as never)
  expect(await ui.find({ type: "Text", text: new RegExp(`prévia · ${longo.length} caracteres`) } as never)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: new RegExp(longo) } as never)).toBeDefined()
  // Só espaços não abre prévia.
  await ui.input({ key: 'nota-0', text: '   ', kind: 'change' } as never)
  expect(await ui.find({ type: 'Text', text: /prévia/ } as never)).toBeUndefined()
  await ui.input({ key: 'nota-0', text: longo, kind: 'change' } as never)
  await ui.input({ key: 'nota-0', text: longo } as never)
  expect(await ui.find({ type: 'Text', text: /prévia/ } as never)).toBeUndefined()
  await ui.unmount()
  expect(JSON.parse(c.texto().trim()).texto).toBe(longo)
})

test('caderno: nota entregue e sem resposta volta inteira a cada 8 passos; triada, não volta mais (sessão paralela, 15/10)', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  const c = comCaderno(on)
  await comObjetivo($)
  await $.command.run({ command: 'objetivo', args: 'nota conferir o lembrete' } as never)
  const passo = async () => JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'true' } as never))
  expect(await passo()).toContain('[caderno] Nota nova')
  for (let i = 0; i < 7; i++) expect(await passo()).not.toContain('[caderno]')
  const oitavo = await passo()
  expect(oitavo).toContain('[caderno] Lembrete: 1 nota do operador segue sem resposta')
  expect(oitavo).toContain('conferir o lembrete')
  // O intervalo recomeça a cada lembrete; nota nova no mesmo passo de um lembrete vem antes dele (sobrevivente #3 da 0.14.0).
  for (let i = 0; i < 7; i++) expect(await passo()).not.toContain('[caderno]')
  await $.command.run({ command: 'objetivo', args: 'nota chegou junto' } as never)
  const junto = await passo()
  expect(junto).toContain('Lembrete')
  expect(junto.indexOf('Nota nova') >= 0 && junto.indexOf('Nota nova') < junto.indexOf('Lembrete')).toBe(true)
  const id2 = JSON.parse(c.texto().trim().split('\n').at(-1)!).id
  await $.tool.call({ tool: TOOL, acao: 'triar', nota: id2, decisao: 'registrada', motivo: 'ok' } as never)
  // Triada, sai dos lembretes.
  const id = JSON.parse(c.texto().trim().split('\n')[0]!).id
  await $.tool.call({ tool: TOOL, acao: 'triar', nota: id, decisao: 'registrada', motivo: 'ok' } as never)
  for (let i = 0; i < 10; i++) expect(await passo()).not.toContain('[caderno]')
  // Subagente não conta passo.
  await $.command.run({ command: 'objetivo', args: 'nota outra' } as never)
  expect(await passo()).toContain('[caderno] Nota nova')
  for (let i = 0; i < 9; i++) await $.tool.call({ tool: 'Read', file_path: '/x', agentId: 'sub' } as never)
  for (let i = 0; i < 7; i++) expect(await passo()).not.toContain('Lembrete')
  expect(await passo()).toContain('Lembrete')
})

// Indicadores em pastas: um mundo de arquivos com pastas, para os testes por raiz.
const mundoIndicadores = (on: Parameters<TestBody>[1], o: { raiz?: string | null; listaFalha?: string; existeFalha?: string } = {}) => {
  if (o.raiz === null) {
    on('session.root', () => {
      throw new Error('sem raiz')
    })
    on('session.cwd', () => {
      throw new Error('sem pasta')
    })
  } else on('session.root', () => ({ value: o.raiz ?? '/proj/a' }) as never)
  mock.env(on, { HOME: '/h' })
  const ind = (fonte: string, rotulo: string, valor: number) => JSON.stringify({ versao: 1, fonte, itens: [{ id: 'i', rotulo, valor, meta: 100, texto: `${valor}%` }] })
  const fs = new Map<string, string>([
    ['/h/.claude/indicadores/global.json', ind('global', 'global', 10)],
    ['/h/.claude/indicadores/velho.json.bak', ind('velho', 'backup velho', 5)],
    ['/h/.claude/indicadores/%2Fproj%2Fa/prova-de-teste.json', ind('prova-de-teste', 'desta raiz', 20)],
    ['/h/.claude/indicadores/%2Fproj%2Fb/prova-de-teste.json', ind('prova-de-teste', 'da outra raiz', 30)],
  ])
  const pastas = new Set(['/h/.claude/indicadores', '/h/.claude/indicadores/%2Fproj%2Fa', '/h/.claude/indicadores/%2Fproj%2Fb'])
  on('fs.exists', (_$, e) => {
    if ((e as { path: string }).path === o.existeFalha) throw new Error('EACCES')
    return { value: pastas.has((e as { path: string }).path) || fs.has((e as { path: string }).path) } as never
  })
  on('fs.list', (_$, e) => {
    const d = (e as { path: string }).path
    if (d === o.listaFalha) throw new Error('EACCES')
    const p = `${d}/`
    const arquivos = [...fs.keys()].filter(k => k.startsWith(p) && !k.slice(p.length).includes('/')).map(k => ({ name: k.slice(p.length), kind: 'file' }))
    const sub = [...pastas].filter(x => x.startsWith(p) && !x.slice(p.length).includes('/')).map(x => ({ name: x.slice(p.length), kind: 'dir' }))
    return { value: [...arquivos, ...sub] } as never
  })
  on('fs.read', (_$, e) => {
    const t = fs.get((e as { path: string }).path)
    if (t === undefined) throw new Error('ENOENT')
    return { value: t } as never
  })
  on('session.usage', () => usageWith(50000))
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  return { fs, pastas }
}

test('painel: indicadores globais e os da raiz da sessão; os de outra raiz não entram (nota do operador, 15/10)', async ($, on) => {
  const m = mundoIndicadores(on)
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  let pane = await painel($)
  expect(pane).toContain('global')
  expect(pane).toContain('desta raiz')
  expect(pane).not.toContain('da outra raiz')
  // Só .json: o backup ao lado não entra (sobrevivente #2 da 0.14.1); os globais vêm antes dos do projeto (#4).
  expect(pane).not.toContain('backup vel')
  expect(pane.indexOf('global') < pane.indexOf('desta raiz')).toBe(true)
  // A pasta inteira some: os gauges saem também (#1).
  m.pastas.clear()
  m.fs.clear()
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  pane = await painel($)
  expect(pane).not.toContain('global')
  expect(pane).not.toContain('desta raiz')
})

test('painel: sem raiz, os globais aparecem uma vez só; a pasta do projeto ilegível não esconde os globais (sobreviventes #5, #6 e #7 da 0.14.1)', async ($, on) => {
  mundoIndicadores(on, { raiz: null })
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  const pane = await painel($)
  expect(pane.match(/"  global   "/g)?.length).toBe(1)
})

test('painel: lista da pasta do projeto que falha não derruba a leitura dos globais', async ($, on) => {
  mundoIndicadores(on, { listaFalha: '/h/.claude/indicadores/%2Fproj%2Fa' })
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  const pane = await painel($)
  expect(pane).toContain('global')
  expect(pane).not.toContain('desta raiz')
})

test('painel: checar a pasta do projeto que dá erro não derruba a leitura dos globais (sobrevivente #6 da 0.14.1)', async ($, on) => {
  mundoIndicadores(on, { existeFalha: '/h/.claude/indicadores/%2Fproj%2Fa' })
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  const pane = await painel($)
  expect(pane).toContain('global')
  expect(pane).not.toContain('desta raiz')
})

// Roadmap: o arquivo do projeto num mapa por caminho, gravado por acréscimo como o caderno.
const comRoadmap = (on: Parameters<TestBody>[1], o: { gravacaoFalha?: boolean } = {}) => {
  const arqs: Record<string, string> = {}
  mock.env(on, { HOME: '/h' })
  on('session.root', () => ({ value: '/proj/r' }) as never)
  on('fs.exists', (_$, e) => ({ value: (e as { path: string }).path in arqs }) as never)
  on('fs.read', (_$, e) => {
    const p = (e as { path: string }).path
    if (p in arqs) return { value: arqs[p] } as never
    throw new Error('ENOENT')
  })
  on('process.run', (_$, e) => {
    const r = e as { argv: readonly string[]; init?: { stdin?: string } }
    const alvo = r.argv[4]!
    if (o.gravacaoFalha && alvo.includes('/roadmap/')) return { value: { exitCode: 1, stdout: '', stderr: 'disco cheio', isStdoutTruncated: false, isStderrTruncated: false } } as never
    arqs[alvo] = (arqs[alvo] ?? '') + (r.init?.stdin ?? '')
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  const ARQ = '/h/.claude/roadmap/%2Fproj%2Fr.jsonl'
  return { linhas: () => (arqs[ARQ] ?? '').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)), ARQ, arquivo: (p: string) => arqs[p] ?? '' }
}
const RM = 'mcp__contexto-bar__roadmap'
const rm = async ($: Engine, a: object) => (JSON.parse(JSON.stringify(await $.tool.call({ tool: RM, ...a } as never))) as { result: string }).result
const objetivoAgora = async ($: Engine) => JSON.parse(JSON.stringify(await $.tool.call({ tool: TOOL, acao: 'ver' } as never))).result as string

test('roadmap: adicionar, mover e descartar gravam por acréscimo no arquivo do projeto; erros explicam e não gravam', async ($, on) => {
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }) as never)
  const r = comRoadmap(on)
  expect(await rm($, { acao: 'ver' })).toBe('Roadmap vazio.')
  expect(await rm($, { acao: 'adicionar', itens: [{ texto: '  ' }] })).toContain('adicionar precisa de itens com texto')
  const ok = await rm($, { acao: 'adicionar', itens: [{ texto: 'mod do herdr só leitura', horizonte: 'agora', frente: 'herdr' }, { texto: 'delegação com agente dono' }, { texto: 'adversário de outro fornecedor', horizonte: 'depois', frente: 'herdr' }] })
  expect(ok).toBe('Roadmap · 3 abertos\nagora:\n  R1 [herdr] mod do herdr só leitura\npróximo:\n  R2 delegação com agente dono\ndepois:\n  R3 [herdr] adversário de outro fornecedor')
  expect(r.linhas().map(l => [l.ev, l.autor, l.horizonte])).toEqual([['item', 'claude', 'agora'], ['item', 'claude', 'proximo'], ['item', 'claude', 'depois']])
  expect(await rm($, { acao: 'mover', ids: [2] })).toContain('mover precisa de horizonte')
  expect(await rm($, { acao: 'mover', horizonte: 'agora' })).toContain('precisa de ids')
  expect(await rm($, { acao: 'mover', ids: [2, 9], horizonte: 'agora' })).toContain('R9 não estão abertos')
  expect(r.linhas().length).toBe(3)
  expect(await rm($, { acao: 'mover', ids: [2], horizonte: 'agora' })).toContain('agora:\n  R1 [herdr] mod do herdr só leitura\n  R2 delegação com agente dono')
  expect(await rm($, { acao: 'descartar', ids: [3], motivo: ' ' })).toContain('descartar precisa do motivo')
  expect(await rm($, { acao: 'descartar', ids: [3], motivo: 'o operador decidiu outro caminho' })).toContain('descartados: R3')
  expect(r.linhas().at(-1)).toMatchObject({ ev: 'descartar', motivo: 'o operador decidiu outro caminho' })
  expect(await rm($, { acao: 'descartar', ids: [3], motivo: 'de novo' })).toContain('R3 não estão abertos')
  expect(await rm($, { acao: 'apagar', ids: [1] })).toContain('acao é uma de ver, adicionar')
  // Sem objetivo, o pedido lembra o que está em agora.
  const ctx = await contextoDe($, 'e agora?')
  expect(ctx).toContain(' · roadmap em agora: R1, R2 (já aprovado: promova com a ferramenta roadmap, acao \\"promover\\", e siga neste turno, sem pedir licença)')
})

test('roadmap: promover vira pendência do objetivo com a frente no texto; adiar tira do objetivo e guarda a origem', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }) as never)
  const r = comRoadmap(on)
  await rm($, { acao: 'adicionar', itens: [{ texto: 'estados dos outros workspaces no painel', horizonte: 'agora', frente: 'herdr' }] })
  expect(await rm($, { acao: 'promover', ids: [1] })).toContain('promover precisa de um objetivo ativo')
  await comObjetivo($)
  // Com pendência a fazer, o pedido não cobra o roadmap.
  expect(await contextoDe($, 'segue')).not.toContain('roadmap em agora')
  const p = await rm($, { acao: 'promover', ids: [1], nivel: 'bloqueante', tamanho: 'G' })
  expect(p).toContain('R1 → #4 no objetivo "Painel novo".')
  expect(p).toContain('promovidos: R1→#4')
  expect(await objetivoAgora($)).toContain('[ ] #4 (claude, G) [bloqueante] herdr: estados dos outros workspaces no painel')
  expect(await rm($, { acao: 'promover', ids: [1] })).toContain('R1 não estão abertos')
  // Adiar: #2 sai do objetivo e entra em agora, com a origem; pendência feita ou inexistente não sai.
  expect(await rm($, { acao: 'adiar', pendencias: [2, 40] })).toContain('pendências inexistentes ou já feitas: 40')
  expect(await rm($, { acao: 'adiar' })).toContain('adiar precisa de pendencias')
  const a = await rm($, { acao: 'adiar', pendencias: [2], horizonte: 'proximo', frente: 'painel' })
  expect(a).toContain('#2 saíram do objetivo e foram para próximo.')
  expect(a).toContain('próximo:\n  R2 [painel] desenhar os medidores')
  expect(a).toContain('(de #2)')
  const obj = await objetivoAgora($)
  expect(obj).not.toContain('#2 ')
  expect(obj).toContain('#3 ')
  expect(r.linhas().at(-1)).toMatchObject({ ev: 'item', de: '#2', horizonte: 'proximo', frente: 'painel' })
  await $.tool.call({ tool: TOOL, acao: 'concluir', ids: [3] } as never)
  expect(await rm($, { acao: 'adiar', pendencias: [3] })).toContain('já feitas: 3')
  // Promovido sem nível nem tamanho: requisito, M, do Claude.
  await rm($, { acao: 'adicionar', itens: [{ texto: 'sem frente', horizonte: 'agora' }] })
  await rm($, { acao: 'promover', ids: [3], dono: 'operador' })
  expect(await objetivoAgora($)).toContain('[ ] #5 (operador, M) sem frente')
})

test('roadmap: encerrar devolve as pendências abertas para agora; sem gravar, o objetivo não sai', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  const r = comRoadmap(on)
  await comObjetivo($)
  await $.tool.call({ tool: TOOL, acao: 'concluir', ids: [2] } as never)
  const fim = JSON.stringify(await $.tool.call({ tool: TOOL, acao: 'encerrar' } as never))
  expect(fim).toContain('Nenhum objetivo ativo.')
  expect(fim).toContain('As 2 pendências abertas voltaram ao roadmap, em agora.')
  expect(r.linhas().map(l => [l.de, l.horizonte, l.texto])).toEqual([
    ['#1', 'agora', 'conferir a faixa'],
    ['#3', 'agora', 'escrever os testes'],
  ])
  // Uma aberta só: o singular. E encerrar sem abertas não grava nada.
  await $.command.run({ command: 'objetivo', args: 'Outro :: x' } as never)
  await $.command.run({ command: 'objetivo', args: 'add única' } as never)
  expect(JSON.stringify(await $.command.run({ command: 'objetivo', args: 'encerrar' } as never))).toContain('A pendência aberta voltou ao roadmap, em agora.')
  expect(r.linhas().at(-1)).toMatchObject({ de: '#1', texto: 'única', autor: 'operador' })
  await $.command.run({ command: 'objetivo', args: 'Vazio :: y' } as never)
  const n = r.linhas().length
  expect(JSON.stringify(await $.tool.call({ tool: TOOL, acao: 'encerrar' } as never))).not.toContain('voltaram')
  expect(r.linhas().length).toBe(n)
})

test('roadmap: se a gravação falha, encerrar não apaga o objetivo e adiar não tira a pendência', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  comRoadmap(on, { gravacaoFalha: true })
  await comObjetivo($)
  const fim = JSON.stringify(await $.tool.call({ tool: TOOL, acao: 'encerrar' } as never))
  expect(fim).toContain('não consegui devolver as 3 pendências abertas ao roadmap; o objetivo segue ativo')
  expect(await objetivoAgora($)).toContain('Objetivo: Painel novo')
  expect(await rm($, { acao: 'adiar', pendencias: [2] })).toContain('não consegui gravar no roadmap; o objetivo ficou como estava')
  expect(await objetivoAgora($)).toContain('#2 ')
  expect(await rm($, { acao: 'adicionar', itens: [{ texto: 'x' }] })).toContain('Erro: não consegui gravar no roadmap.')
})

test('roadmap: a nota aceita com destino roadmap vira item com a origem; recusada ou para outro destino, não; não duplica', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  const r = comRoadmap(on)
  await comObjetivo($)
  await $.command.run({ command: 'objetivo', args: 'nota depois personagem com os estados do herdr' } as never)
  await $.command.run({ command: 'objetivo', args: 'nota nada a ver' } as never)
  const cad = '/h/.claude/caderno/%2Fproj%2Fr.jsonl'
  const notas = r.arquivo(cad).split('\n').filter(Boolean).map((l: string) => JSON.parse(l))
  const triar = async (a: object) => (JSON.parse(JSON.stringify(await $.tool.call({ tool: TOOL, acao: 'triar', ...a } as never))) as { result: string }).result
  expect(await triar({ nota: notas[1].id, decisao: 'recusada', motivo: 'fora', destino: 'roadmap' })).not.toContain('Entrou no roadmap')
  expect(await triar({ nota: notas[1].id, decisao: 'aceita', motivo: 'ok', destino: '#3' })).not.toContain('Entrou no roadmap')
  expect(r.linhas()).toEqual([])
  expect(await triar({ nota: notas[0].id, decisao: 'muda-plano', motivo: 'é a V3', destino: 'roadmap:proximo' })).toContain('Entrou no roadmap como R1 (próximo).')
  expect(r.linhas()[0]).toMatchObject({ ev: 'item', autor: 'operador', texto: 'personagem com os estados do herdr', horizonte: 'proximo', de: notas[0].id })
  // Triar de novo a mesma nota não cria outro item.
  expect(await triar({ nota: notas[0].id, decisao: 'aceita', motivo: 'confirmo', destino: 'roadmap' })).not.toContain('Entrou no roadmap')
  expect(r.linhas().length).toBe(1)
})

test('roadmap no painel: agora sempre, próximo e depois pelo botão; Promover só com objetivo; sem nada aberto, sem seção', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  comRoadmap(on)
  expect(await painel($)).not.toContain('ROADMAP')
  await rm($, { acao: 'adicionar', itens: [{ texto: 'abas nativas', horizonte: 'agora', frente: 'painel' }, { texto: 'mod do herdr', horizonte: 'proximo' }, { texto: 'adversário', horizonte: 'depois' }] })
  // Sem objetivo: a seção aparece, sem o botão Promover.
  let pane = await painel($)
  expect(pane).toContain('ROADMAP ')
  expect(pane).toContain('agora 1 · próximo 1 · depois 1 ▸')
  expect(pane).toContain('abas nativas')
  expect(pane).not.toContain('mod do herdr')
  expect(pane).not.toContain('Promover')
  await comObjetivo($)
  const ui = await montar($, 'objetivo')
  await ui.press({ key: 'ver-roadmap' } as never)
  expect(await ui.find({ type: 'Text', text: /mod do herdr/ } as never)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /adversário/ } as never)).toBeDefined()
  await ui.press({ key: 'promover-1' } as never)
  await ui.unmount()
  expect(await objetivoAgora($)).toContain('#4 (claude, M) painel: abas nativas')
  pane = await painel($)
  expect(pane).toContain('agora 0 · próximo 1 · depois 1 ▾')
})

test('faixa: sem objetivo ou com tudo feito, mostra o roadmap e a próxima dele; com pendência a fazer, não (16/10: a prioridade sumia ao encerrar)', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }) as never)
  comRoadmap(on)
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  await $.tool.call({ tool: 'Bash', input: { command: 'true' } } as never)
  // Sem plano: a linha diz como começar, apagada.
  const vazia = await barText($)
  expect(vazia).toContain('◎ sem objetivo ativo · roadmap vazio')
  expect(vazia).toMatch(/"dimColor":true,"wrap":"truncate"/)
  await rm($, { acao: 'adicionar', itens: [{ texto: 'mod do herdr só leitura', horizonte: 'agora', frente: 'herdr' }] })
  // O roadmap é relido no turno; a faixa lê o estado.
  await contextoDe($, 'e agora?')
  const sem = await barText($)
  expect(sem).toContain('◎ sem objetivo ativo · roadmap: agora 1 · próximo 0 · depois 0 · próxima: R1 [herdr] mod do herdr s…')
  expect(sem).toMatch(/"dimColor":false,"wrap":"truncate"/)
  await comObjetivo($)
  expect(await barText($)).not.toContain('roadmap:')
  for (const n of [1, 2, 3]) await $.tool.call({ tool: TOOL, acao: 'concluir', ids: [n] } as never)
  const feito = await barText($)
  expect(feito).toContain('  ↳ objetivo feito · roadmap: agora 1')
  expect(feito).not.toContain('sem objetivo ativo')
})

test('herdr: o painel mostra os outros workspaces do arquivo deste pane e a faixa avisa quem espera; sem HERDR_PANE_ID, nada', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  const arqs: Record<string, string> = {}
  const env: Record<string, string> = { HOME: '/h', HERDR_PANE_ID: 'w1:p1' }
  on('env.get', (_$, e) => ({ value: env[(e as { name: string }).name] }) as never)
  on('fs.exists', (_$, e) => ({ value: (e as { path: string }).path in arqs }) as never)
  on('fs.read', (_$, e) => {
    const p = (e as { path: string }).path
    if (p in arqs) return { value: arqs[p] } as never
    throw new Error('ENOENT')
  })
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  const ARQ = '/h/.claude/herdr/vizinhos/w1%3Ap1.json'
  const escrever = (estado: string) =>
    (arqs[ARQ] = JSON.stringify({ versao: 1, fonte: 'herdr', em: 'x', workspace: 'w1', vizinhos: [{ workspace: 'w2', rotulo: 'motor', estado, agentes: [{ pane: 'w2:p1', estado, titulo: 'Retomada do motor' }] }] }))
  escrever('working')
  await $.tool.call({ tool: 'Bash', input: { command: 'true' } } as never)
  const pane = await painel($)
  expect(pane).toContain('OUTROS WORKSPACES')
  expect(pane).toContain('motor')
  expect(pane).toContain('trabalhando')
  expect(pane).toContain('Retomada do motor')
  expect(await barText($)).not.toContain('esperando você')
  escrever('blocked')
  await $.tool.call({ tool: 'Bash', input: { command: 'true' } } as never)
  expect(await barText($)).toContain('◆ motor esperando você')
  expect(await painel($)).toContain('esperando você')
  // Fora do herdr (sem o pane), a seção e a linha somem.
  delete env.HERDR_PANE_ID
  await $.tool.call({ tool: 'Bash', input: { command: 'true' } } as never)
  expect(await painel($)).not.toContain('OUTROS WORKSPACES')
  expect(await barText($)).not.toContain('motor')
})

test('herdr: com HERDR_PANE_ID, o arquivo dos vizinhos é relido a cada 2 s sem turno; sem ele, nenhum timer', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  const relogio = mock.clock(on, { now: 0 })
  const arqs: Record<string, string> = {}
  const env: Record<string, string> = { HOME: '/h', HERDR_PANE_ID: 'w1:p1' }
  on('env.get', (_$, e) => ({ value: env[(e as { name: string }).name] }) as never)
  on('fs.exists', (_$, e) => ({ value: (e as { path: string }).path in arqs }) as never)
  on('fs.read', (_$, e) => {
    const p = (e as { path: string }).path
    if (p in arqs) return { value: arqs[p] } as never
    throw new Error('ENOENT')
  })
  on('session.start', () => ({ cwd: '/proj' }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  await $.session.start({ cwd: '/proj' } as never)
  await $.tool.call({ tool: 'Bash', input: { command: 'true' } } as never)
  arqs['/h/.claude/herdr/vizinhos/w1%3Ap1.json'] = JSON.stringify({ versao: 1, fonte: 'herdr', em: 'x', workspace: 'w1', vizinhos: [{ workspace: 'w2', rotulo: 'motor', estado: 'blocked', agentes: [] }] })
  await relogio.advance(1999)
  expect(await barText($)).not.toContain('motor')
  await relogio.advance(1)
  expect(await barText($)).toContain('◆ motor esperando você')
})

test('fim de turno que pede licença para trabalho aprovado é bloqueado com o motivo; na segunda vez (stop_hook_active) passa', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('classic.Stop', () => ({}) as never)
  await comObjetivo($)
  const r = JSON.parse(JSON.stringify(await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Pronto.\n\nSigo com a próxima?', background_tasks: [], session_crons: [] } as never)))
  expect(r.block).toContain('"Sigo com a próxima?"')
  expect(r.block).toContain('#2')
  const de_novo = JSON.parse(JSON.stringify(await $.classic.Stop({ stop_hook_active: true, last_assistant_message: 'Sigo?', background_tasks: [], session_crons: [] } as never)))
  expect(de_novo.block).toBeUndefined()
  const semPergunta = JSON.parse(JSON.stringify(await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Feito.', background_tasks: [], session_crons: [] } as never)))
  expect(semPergunta.block).toBeUndefined()
})

test('fim de turno: o bloqueio de outro hook vale e não é trocado pelo de licença (sobrevivente #12 da 0.17.0)', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('classic.Stop', () => ({ block: 'outro motivo' }) as never)
  await comObjetivo($)
  const r = JSON.parse(JSON.stringify(await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Sigo?', background_tasks: [], session_crons: [] } as never)))
  expect(r.block).toBe('outro motivo')
})

test('disparo: a ferramenta grava, o painel mostra o meio de cada frente e a cobrança some da linha do pedido', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }) as never)
  await $.tool.call({ tool: TOOL, acao: 'definir', titulo: 'Duas frentes', conclusao: 'x', itens: [{ texto: 'frente A', dono: 'claude' }, { texto: 'frente B', dono: 'claude' }] } as never)
  expect(await contextoDe($, 'segue')).toContain('declarar disparo: #1, #2')
  const r = JSON.stringify(await $.tool.call({ tool: TOOL, acao: 'disparo', ids: [1, 2], modo: 'paralelo', meio: 'herdr', harness: 'codex' } as never))
  expect(r).toContain('⇉ herdr·codex')
  expect(await contextoDe($, 'segue')).not.toContain('declarar disparo')
  expect(await painel($)).toContain('⇉ herdr·codex')
})

test('abas: objetivo, caderno, prova e agentes, cada uma com o seu; o objetivo só aponta o caderno com nota sem resposta', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  comCaderno(on)
  await comObjetivo($)
  const obj = await aba($, 'objetivo')
  expect(obj).toContain('FILA DO CLAUDE')
  expect(obj).not.toContain('CADERNO')
  expect(obj).not.toContain('QUEM EXECUTA')
  expect(obj).not.toContain('caderno ·')
  expect(await aba($, 'caderno')).toContain('CADERNO')
  expect(await aba($, 'caderno')).not.toContain('FILA DO CLAUDE')
  expect(await aba($, 'agentes')).toContain('QUEM EXECUTA')
  expect(await aba($, 'prova')).toContain('Nenhuma rodada do prova-de-teste nesta sessão.')
  const ui = await montar($)
  await ui.input({ key: 'nota-0', text: 'e se fosse em abas?' } as never)
  await ui.unmount()
  expect(await aba($, 'objetivo')).toContain('"✎ caderno · ","1"," sem resposta "')
})

test('aba Prova: a rodada ao vivo aparece pelo timer de 2 s, sem turno, e fica como a última no fim', async ($, on) => {
  on('session.usage', () => usageWith(50000))
  const relogio = mock.clock(on, { now: 0 })
  const arqs: Record<string, string> = {}
  mock.env(on, { HOME: '/h' })
  on('session.id', () => ({ value: 's1' }) as never)
  on('fs.exists', (_$, e) => ({ value: (e as { path: string }).path in arqs }) as never)
  on('fs.read', (_$, e) => {
    const p = (e as { path: string }).path
    if (p in arqs) return { value: arqs[p] } as never
    throw new Error('ENOENT')
  })
  on('session.start', () => ({ cwd: '/proj' }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/proj' } as never)
  const ARQ = '/h/.claude/prova-de-teste/ao-vivo/s1.json'
  const vivo = (o: object) => (arqs[ARQ] = JSON.stringify({ versao: 1, fonte: 'prova-de-teste', tarefa: 'soma', fase: 'mutantes', total: 4, feitos: 1, mortos: 1, sobreviventes: 0, naoAplicados: 0, inicio: 0, agora: 3000, ...o }))
  vivo({})
  await relogio.advance(1999)
  expect(await aba($, 'prova')).toContain('Nenhuma rodada')
  await relogio.advance(1)
  const rodando = await aba($, 'prova')
  expect(rodando).toContain('▶ RODANDO ')
  expect(rodando).toContain(' 1/4 · 1 mortos · 0 sobreviventes · 3 s')
  vivo({ fase: 'fim', feitos: 4, mortos: 3, sobreviventes: 1, estado: 'FRACO', agora: 9000 })
  await relogio.advance(2000)
  const fim = await aba($, 'prova')
  expect(fim).toContain('ÚLTIMA RODADA ')
  expect(fim).toContain('FRACO · 3 mortos · 1 sobreviventes · 9 s')
  expect(fim).toContain('"color":"warning"')
  // Arquivo quebrado no meio da escrita: fica o que estava.
  arqs[ARQ] = '{"versao":1,'
  await relogio.advance(2000)
  expect(await aba($, 'prova')).toContain('FRACO · 3 mortos')
  vivo({ fase: 'fim', estado: 'PROVADO', agora: 9000 })
  await relogio.advance(2000)
  expect(await aba($, 'prova')).toContain('"color":"success"')
})

test('abas: o operador fecha uma (Esc) e as outras fecham junto; fechar pelo próprio mod não cascateia', () => {
  expect(fecharJunto('prova', 'person')).toEqual(['objetivo', 'caderno', 'agentes'])
  expect(fecharJunto('objetivo', 'person')).toEqual(['caderno', 'prova', 'agentes'])
  expect(fecharJunto('caderno', 'plugin')).toEqual([])
  expect(fecharJunto('caderno', 'unload')).toEqual([])
  expect(fecharJunto('outro', 'person')).toEqual([])
  expect(fecharJunto('', 'person')).toEqual([])
  expect(fecharJunto('prova', undefined)).toEqual([])
})

test('abas: o hook de fechar chama o close das outras, e um close que falha não para os seguintes (sobrevivente #10 da 0.19.1)', async () => {
  const fechados: string[] = []
  const fake = { ui: { close: async ({ id }: { id: string }) => { fechados.push(id); if (id === 'caderno') throw new Error('já fechado') } } }
  // A origem como o motor a entrega: um objeto com kind (o texto solto era a suposição errada da 0.19.1).
  await fecharAsOutras(fake as never, { id: 'prova', origin: { kind: 'person' } })
  expect(fechados).toEqual(['objetivo', 'caderno', 'agentes'])
  fechados.length = 0
  await fecharAsOutras(fake as never, { id: 'prova', origin: { kind: 'plugin' } })
  expect(fechados).toEqual([])
  await fecharAsOutras(fake as never, { id: 'prova', origin: 'person' as never })
  expect(fechados).toEqual([])
})
