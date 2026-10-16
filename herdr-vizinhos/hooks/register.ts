// herdr-vizinhos: dentro do herdr (HERDR_ENV), lê o snapshot a cada poucos segundos, escreve os outros workspaces
// no contrato de vizinhos.ts para o painel do contexto-bar, e avisa quando um agente vizinho fica blocked ou done:
// um toast para o operador e uma linha ao modelo no próximo resultado de ferramenta ou pedido.
// Fora do herdr não registra nada: o claude-grounds funciona igual sem este mod.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { arquivoVizinhos, contextoAvisos, conteudo, estadosDe, lerSnapshot, mudancas, regraHabilitado, textoAviso } from './vizinhos'

const estados = atom({ plugin: 'herdr-vizinhos', key: 'estados' } as const, null)
const pendentes = atom({ plugin: 'herdr-vizinhos', key: 'pendentes' } as const, [])
const vizinhos = atom({ plugin: 'herdr-vizinhos', key: 'vizinhos' } as const, [])
const regraEnviada = atom({ plugin: 'herdr-vizinhos', key: 'regraEnviada' } as const, false)

/** De quanto em quanto tempo o snapshot é relido (ele responde em poucos milissegundos). */
export const INTERVALO_MS = 5000

let timer: Timer | undefined

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
    await atualizar($).catch(() => undefined)
    timer?.cancel()
    timer = $.clock.every(INTERVALO_MS, () => void atualizar($).catch(() => undefined))
    return result
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
