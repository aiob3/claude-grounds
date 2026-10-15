// Peças puras do painel: medidores, texto que cabe na largura, o estado do agente e os indicadores de outros mods.
import type { Atividade, Estado, Indicador } from '../types'

/** Barra de medidor com a largura exata: cheio proporcional a valor/total, nunca fora de 0..largura. */
export function medidor(valor: number, total: number, largura: number): { cheio: string; vazio: string } {
  const l = Math.max(1, Math.floor(largura))
  const frac = total > 0 && Number.isFinite(valor) ? Math.min(1, Math.max(0, valor / total)) : 0
  // Algum progresso nunca some: acima de zero mostra ao menos uma célula; abaixo do total, ao menos uma vazia.
  let n = Math.round(frac * l)
  if (frac > 0 && n === 0) n = 1
  if (frac < 1 && n === l) n = l - 1
  return { cheio: '█'.repeat(n), vazio: '░'.repeat(l - n) }
}

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
    })
  }
  return r
}

export const COR_INDICADOR = { ok: 'success', atencao: 'warning', alerta: 'error' } as const

/** O sufixo de um indicador: `28/10 ✓` com meta atingida, `3/10` abaixo dela, o valor e a unidade sem meta. */
export function sufixoIndicador(i: Indicador): string {
  if (i.meta === undefined) return `${i.valor}${i.unidade ? ` ${i.unidade}` : ''}`
  return `${i.valor}/${i.meta}${i.valor >= i.meta ? ' ✓' : ''}`
}
