// Peças puras do painel: medidores, texto que cabe na largura, o estado do agente e os indicadores de outros mods.
import type { Atividade, Estado, Indicador } from '../types'

/** Corta o texto em `max` colunas com reticências; devolve o pedaço que coube e o resto (para o hover). */
export function encurtar(texto: string, max: number): { curto: string; resto: string } {
  const t = texto.replace(/\s+/g, ' ').trim()
  const m = Math.max(2, Math.floor(max))
  if (t.length <= m) return { curto: t, resto: '' }
  return { curto: `${t.slice(0, m - 1)}…`, resto: t.slice(m - 1) }
}

// O vocabulário é o do herdr (idle, working, blocked, done): o mesmo estado vale para esta sessão e,
// quando o painel mostrar outros workspaces, para os agentes deles.
export const ESTADOS: Record<Estado, { rotulo: string; cor: string; glifo: string }> = {
  ocioso: { rotulo: 'ocioso', cor: 'subtle', glifo: '○' },
  trabalhando: { rotulo: 'trabalhando', cor: 'claude', glifo: '●' },
  bloqueado: { rotulo: 'esperando você', cor: 'warning', glifo: '◆' },
  concluido: { rotulo: 'concluído', cor: 'success', glifo: '✔' },
}

export function textoAtividade(a: Atividade | null): string {
  if (!a) return ESTADOS.ocioso.rotulo
  const base = ESTADOS[a.estado].rotulo
  return a.estado === 'trabalhando' && a.ferramenta ? `${base} · ${nomeFerramenta(a.ferramenta)}` : base
}

/** Centraliza o texto em `largura` colunas, cortando com reticências quando não cabe. */
export function centralizar(texto: string, largura: number): string {
  const t = texto.length > largura ? `${texto.slice(0, largura - 1)}…` : texto
  const esq = Math.floor((largura - t.length) / 2)
  return ' '.repeat(esq) + t + ' '.repeat(largura - t.length - esq)
}

/** `claude-opus-5-5` vira `Opus 5.5`; `claude-haiku-4-5-20251001`, `Haiku 4.5`; alias e outros nomes ficam como vieram. */
export function nomeModelo(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[.*\])?$/.exec(id)
  if (!m) return id
  return `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

/** `mcp__servidor__ferramenta` vira `servidor·ferramenta`; o resto fica como veio. */
export function nomeFerramenta(t: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(t)
  return m ? `${m[1]}·${m[2]}` : t
}

// Indicadores: o contrato entre mods. Cada mod que tem um número a mostrar escreve
// ~/.claude/indicadores/<fonte>.json = { versao: 1, fonte, itens: Indicador[] }, e o painel os lê.
// Arquivo e não $.state: vale entre sessões e workspaces, e nenhum mod depende de outro estar instalado.
export const VERSAO_INDICADORES = 1
const ESTADOS_INDICADOR = ['ok', 'atencao', 'alerta'] as const

/** Os indicadores válidos de um arquivo; o que não segue o contrato fica de fora, sem derrubar o resto. */
export function validarIndicadores(json: unknown): Indicador[] {
  if (!json || typeof json !== 'object') return []
  const j = json as { versao?: unknown; fonte?: unknown; itens?: unknown }
  if (j.versao !== VERSAO_INDICADORES || typeof j.fonte !== 'string' || !Array.isArray(j.itens)) return []
  const fonte = j.fonte
  const r: Indicador[] = []
  for (const x of j.itens as unknown[]) {
    if (!x || typeof x !== 'object') continue
    const i = x as Record<string, unknown>
    if (typeof i.id !== 'string' || !i.id || typeof i.rotulo !== 'string' || !i.rotulo) continue
    if (typeof i.valor !== 'number' || !Number.isFinite(i.valor)) continue
    r.push({
      fonte,
      id: i.id,
      rotulo: i.rotulo,
      valor: i.valor,
      ...(typeof i.meta === 'number' && Number.isFinite(i.meta) && i.meta > 0 ? { meta: i.meta } : {}),
      ...(typeof i.unidade === 'string' ? { unidade: i.unidade } : {}),
      ...(ESTADOS_INDICADOR.includes(i.estado as never) ? { estado: i.estado as Indicador['estado'] } : {}),
      ...(typeof i.detalhe === 'string' ? { detalhe: i.detalhe } : {}),
      ...(typeof i.texto === 'string' && i.texto.trim() ? { texto: i.texto.trim() } : {}),
    })
  }
  return r
}

export const COR_INDICADOR = { ok: 'success', atencao: 'warning', alerta: 'error' } as const

/** O centro do gauge de um indicador: o texto que a fonte mandou; sem ele, valor/meta, ou o valor. */
export function centroIndicador(i: Indicador): string {
  return i.texto ?? (i.meta !== undefined ? `${i.valor}/${i.meta}` : `${i.valor}`)
}
