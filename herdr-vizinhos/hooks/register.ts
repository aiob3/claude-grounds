// herdr-vizinhos: dentro do herdr (HERDR_ENV), lê o snapshot a cada poucos segundos, escreve os outros workspaces
// no contrato de vizinhos.ts para o painel do contexto-bar, e avisa quando um agente vizinho fica blocked ou done:
// um toast para o operador e uma linha ao modelo no próximo resultado de ferramenta ou pedido.
// Dentro do herdr registra também a ferramenta briefing (briefing.ts): o arquivo de cada frente delegada e a
// conferência do escopo do que ela tocou. Fora do herdr não registra nada: o claude-grounds funciona igual sem este mod.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Briefing } from './briefing'
import { arquivoBriefing, faltas, foraDoEscopo, GITIGNORE_HERDR, lerBriefing, pastaDosBriefings, promptDoPane, textoBriefing, textoConferencia, tocadosDe } from './briefing'
import { arquivoVizinhos, contextoAvisos, conteudo, estadosDe, lerSnapshot, mudancas, regraHabilitado, textoAviso } from './vizinhos'

const estados = atom({ plugin: 'herdr-vizinhos', key: 'estados' } as const, null)
const pendentes = atom({ plugin: 'herdr-vizinhos', key: 'pendentes' } as const, [])
const vizinhos = atom({ plugin: 'herdr-vizinhos', key: 'vizinhos' } as const, [])
const regraEnviada = atom({ plugin: 'herdr-vizinhos', key: 'regraEnviada' } as const, false)

/** De quanto em quanto tempo o snapshot é relido (ele responde em poucos milissegundos). */
export const INTERVALO_MS = 5000

let timer: Timer | undefined

export const TOOL_BRIEFING = 'mcp__herdr-vizinhos__briefing'

const SPEC_BRIEFING = {
  name: 'briefing',
  description:
    'Briefing por frente (herdr-vizinhos/ACIONAMENTO.md, etapa 2). escrever: grava <pasta>/.herdr/frentes/<frente>.md com objetivo, arquivos, ' +
    'o que conta como feito e o que não tocar, e devolve a instrução curta para o pane (o agente delegado lê o arquivo, não a conversa). ' +
    'ler: devolve o briefing. conferir: os arquivos tocados na pasta (git diff HEAD e os novos) contra "Arquivos" e "O que não tocar"; ' +
    'rode antes da prova da frente.',
  isDeferred: false,
  inputSchema: {
    type: 'object',
    properties: {
      acao: { type: 'string', enum: ['escrever', 'ler', 'conferir'] },
      frente: { type: 'string', description: 'Nome da frente (vira o nome do arquivo).' },
      pasta: { type: 'string', description: 'Pasta da frente, onde o agente delegado trabalha (padrão: a da sessão).' },
      objetivo: { type: 'string', description: 'Para escrever: o que a frente entrega, em uma ou duas frases.' },
      arquivos: { type: 'array', items: { type: 'string' }, description: 'Para escrever: arquivos ou pastas (terminadas em /, ou com * e **) que a frente pode mudar; relativos à pasta.' },
      feito: { type: 'string', description: 'Para escrever: o que conta como feito (o teste que passa, o efeito visto).' },
      naoTocar: { type: 'array', items: { type: 'string' }, description: 'Para escrever: o que a frente não pode mudar.' },
      pendencia: { type: 'integer', description: 'Para escrever: o id da pendência do objetivo.' },
      harness: { type: 'string', description: 'Para escrever: o agente que roda a frente (claude, codex…).' },
    },
    required: ['acao', 'frente'],
  },
} as const

type ArgsBriefing = Partial<Briefing> & { acao?: string; pasta?: string }

async function briefing($: EngineInterface, a: ArgsBriefing): Promise<{ texto: string; erro: boolean }> {
  const pasta = a.pasta?.trim() || (await $.session.cwd())
  if (!a.frente?.trim()) return { texto: 'Erro: falta frente.', erro: true }
  const caminho = arquivoBriefing(pasta, a.frente)
  if (a.acao === 'escrever') {
    const f = faltas(a)
    if (f.length) return { texto: `Erro: o briefing precisa de ${f.join(', ')}.`, erro: true }
    const b: Briefing = { frente: a.frente.trim(), objetivo: a.objetivo!, arquivos: a.arquivos ?? [], feito: a.feito!, naoTocar: a.naoTocar ?? [], ...(a.pendencia ? { pendencia: a.pendencia } : {}), ...(a.harness?.trim() ? { harness: a.harness.trim() } : {}) }
    const ignore = `${pastaDosBriefings(pasta).replace(/\/frentes$/, '')}/.gitignore`
    if (!(await $.fs.exists(ignore))) await $.fs.write(ignore, GITIGNORE_HERDR)
    await $.fs.write(caminho, textoBriefing(b, new Date(await $.clock.now()).toISOString()))
    return { texto: `Briefing gravado em ${caminho}.\nInstrução para o pane: ${promptDoPane(caminho)}`, erro: false }
  }
  if (!(await $.fs.exists(caminho))) return { texto: `Erro: não há briefing da frente "${a.frente}" em ${caminho}; escreva-o antes.`, erro: true }
  const texto = await $.fs.read(caminho)
  if (a.acao === 'ler') return { texto, erro: false }
  if (a.acao !== 'conferir') return { texto: 'Erro: acao é escrever, ler ou conferir.', erro: true }
  const b = lerBriefing(texto)
  if (!b) return { texto: `Erro: ${caminho} não é um briefing v1 (o cabeçalho mudou?).`, erro: true }
  const [diff, novos] = await Promise.all([
    $.process.run(['git', 'diff', '--name-only', '--relative', 'HEAD'], { cwd: pasta }),
    $.process.run(['git', 'ls-files', '-o', '--exclude-standard'], { cwd: pasta }),
  ])
  if (diff.exitCode !== 0 || novos.exitCode !== 0) return { texto: `Erro: o git não leu ${pasta} (${(diff.stderr || novos.stderr).trim()}).`, erro: true }
  const tocados = tocadosDe(diff.stdout, novos.stdout)
  return { texto: textoConferencia(b, tocados, foraDoEscopo(tocados, b)), erro: false }
}

async function atualizar($: EngineInterface): Promise<void> {
  const [pane, ws, home, bin] = await Promise.all([$.env.get('HERDR_PANE_ID'), $.env.get('HERDR_WORKSPACE_ID'), $.env.get('HOME'), $.env.get('HERDR_BIN_PATH')])
  if (!pane || !ws || !home) return
  const r = await $.process.run([bin || 'herdr', 'api', 'snapshot'])
  if (r.exitCode !== 0) return
  const vs = lerSnapshot(r.stdout, ws)
  if (!vs) return
  const novas = mudancas(await read($, estados), vs).map(textoAviso)
  await update($, estados, () => estadosDe(vs))
  if (novas.length) {
    await update($, pendentes, p => [...p, ...novas])
    for (const t of novas) $.ui.toast(`herdr: ${t}`, { timeoutMs: 8000 })
  }
  if (JSON.stringify(await read($, vizinhos)) === JSON.stringify(vs)) return
  await update($, vizinhos, () => vs)
  await $.fs.write(arquivoVizinhos(home, pane), conteudo(new Date(await $.clock.now()).toISOString(), ws, vs))
}

/** Os avisos ainda não entregues, uma vez só. */
async function entregar($: EngineInterface): Promise<string | undefined> {
  const p = await read($, pendentes)
  if (!p.length) return undefined
  await update($, pendentes, () => [])
  return contextoAvisos(p)
}

const dentroDoHerdr = async ($: EngineInterface) => !!(await $.env.get('HERDR_ENV'))

/** Relê o herdr e devolve o aviso a entregar; uma falha aqui nunca segura a ferramenta nem o pedido. */
async function lerEEntregar($: EngineInterface): Promise<string | undefined> {
  if (!(await dentroDoHerdr($))) return undefined
  await atualizar($)
  return entregar($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || !(await dentroDoHerdr($).catch(() => false))) return result
    await $.tool.register(SPEC_BRIEFING).catch(() => undefined)
    await atualizar($).catch(() => undefined)
    timer?.cancel()
    timer = $.clock.every(INTERVALO_MS, () => void atualizar($).catch(() => undefined))
    return result
  })

  on('tool.call', { tool: TOOL_BRIEFING as never }, async ($, e) => {
    const r = await briefing($, e as never).catch(err => ({ texto: `Erro: ${err instanceof Error ? err.message : String(err)}`, erro: true }))
    return { result: r.texto, ...(r.erro ? { isError: true } : {}) } as never
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    const ctx = await lerEEntregar($).catch(() => undefined)
    return ctx ? { ...result, context: [...(result.context ?? []), ctx] } : result
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command) return next(e)
    const ctx = await lerEEntregar($).catch(() => undefined)
    const regra = await (async () => {
      if (!(await dentroDoHerdr($))) return undefined
      const inteira = !(await read($, regraEnviada))
      if (inteira) await update($, regraEnviada, () => true)
      return regraHabilitado(inteira)
    })().catch(() => undefined)
    const extra = [regra, ctx].filter((x): x is string => !!x)
    return next(extra.length ? { ...e, context: [...(e.context ?? []), ...extra] } : e)
  })

  // A compactação descarta o texto injetado: a regra inteira volta no próximo pedido.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) await update($, regraEnviada, () => false).catch(() => undefined)
    return result
  })

  // A sessão que sai leva o arquivo dela: o painel de quem ficou não mostra vizinhos de uma sessão que não existe.
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    timer?.cancel()
    timer = undefined
    if (e.agentId) return result
    const [pane, home] = await Promise.all([$.env.get('HERDR_PANE_ID'), $.env.get('HOME')]).catch(() => [undefined, undefined])
    if (pane && home) await $.process.run(['rm', '-f', arquivoVizinhos(home, pane)]).catch(() => undefined)
    return result
  })
}
