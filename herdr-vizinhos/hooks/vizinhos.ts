// Os outros workspaces do herdr, vistos de dentro de uma sessão: a Fase 1 da integração (só leitura).
// O herdr já agrega o estado de cada workspace a partir dos agentes dele (idle, working, blocked, done);
// aqui só se separa o que é desta sessão, se vê a mudança e se escreve o contrato que o contexto-bar lê.
//
// Contrato (versão 1): ~/.claude/herdr/vizinhos/<pane desta sessão, encodeURIComponent>.json =
// { versao: 1, fonte: 'herdr', em, workspace, vizinhos: Vizinho[] }. Por pane, porque duas sessões na mesma
// raiz, em workspaces diferentes, têm vizinhos diferentes. Quem lê ignora o que não conhece.

export const VERSAO_VIZINHOS = 1

import type { AgenteVizinho, EstadoHerdr, Vizinho } from '../types'

const ESTADOS: EstadoHerdr[] = ['idle', 'working', 'blocked', 'done', 'unknown']
const ehEstado = (x: unknown): x is EstadoHerdr => ESTADOS.includes(x as EstadoHerdr)
// Na falta do agregado do herdr, o que mais pede o operador vence.
const PESO: Record<EstadoHerdr, number> = { blocked: 4, done: 3, working: 2, idle: 1, unknown: 0 }

/** Os workspaces que não são o desta sessão, na ordem do herdr; null quando a resposta não é um snapshot. */
export function lerSnapshot(texto: string, meuWorkspace: string): Vizinho[] | null {
  let s: { workspaces?: unknown; agents?: unknown }
  try {
    s = (JSON.parse(texto) as { result?: { snapshot?: typeof s } }).result?.snapshot ?? (null as never)
  } catch {
    return null
  }
  if (!s || !Array.isArray(s.workspaces)) return null
  const agentes = Array.isArray(s.agents) ? (s.agents as Record<string, unknown>[]) : []
  const r: Vizinho[] = []
  for (const w of s.workspaces as Record<string, unknown>[]) {
    const id = w?.workspace_id
    if (typeof id !== 'string' || !id || id === meuWorkspace) continue
    const deles: AgenteVizinho[] = agentes
      .filter(a => a?.workspace_id === id && typeof a.pane_id === 'string')
      .map(a => ({
        pane: a.pane_id as string,
        estado: ehEstado(a.agent_status) ? a.agent_status : 'unknown',
        titulo: typeof a.terminal_title_stripped === 'string' ? a.terminal_title_stripped.trim() : '',
      }))
    const agregado = deles.reduce<EstadoHerdr>((m, a) => (PESO[a.estado] > PESO[m] ? a.estado : m), 'unknown')
    r.push({
      workspace: id,
      rotulo: typeof w.label === 'string' && w.label.trim() ? w.label.trim() : id,
      estado: ehEstado(w.agent_status) ? w.agent_status : agregado,
      agentes: deles,
    })
  }
  return r
}

/** O estado de cada pane vizinho, para comparar com a próxima leitura. */
export const estadosDe = (vs: Vizinho[]): Record<string, string> => Object.fromEntries(vs.flatMap(v => v.agentes.map(a => [a.pane, a.estado])))

/**
 * Os agentes que acabaram de ficar blocked ou done. Na primeira leitura (antes null) não há aviso: o que já estava
 * parado quando a sessão abriu não é novidade.
 */
export function mudancas(antes: Record<string, string> | null, vs: Vizinho[]): { rotulo: string; pane: string; estado: 'blocked' | 'done' }[] {
  if (!antes) return []
  return vs.flatMap(v =>
    v.agentes
      .filter(a => (a.estado === 'blocked' || a.estado === 'done') && antes[a.pane] !== a.estado)
      .map(a => ({ rotulo: v.rotulo, pane: a.pane, estado: a.estado as 'blocked' | 'done' })),
  )
}

/** A frase do aviso: curta, para o toast do operador e para o modelo. */
export function textoAviso(m: { rotulo: string; pane: string; estado: 'blocked' | 'done' }): string {
  return m.estado === 'blocked'
    ? `${m.rotulo} (${m.pane}) está esperando o operador`
    : `${m.rotulo} (${m.pane}) terminou`
}

/** O que vai ao modelo: os avisos e a regra de que a sessão do outro workspace é do operador. */
export function contextoAvisos(pendentes: string[]): string | undefined {
  if (!pendentes.length) return undefined
  return `[herdr] ${pendentes.join('; ')}. A sessão de outro workspace é do operador: avise-o, não responda nem aja nela.`
}

export const arquivoVizinhos = (home: string, pane: string) => `${home}/.claude/herdr/vizinhos/${encodeURIComponent(pane)}.json`

export const conteudo = (em: string, workspace: string, vizinhos: Vizinho[]) =>
  `${JSON.stringify({ versao: VERSAO_VIZINHOS, fonte: 'herdr', em, workspace, vizinhos }, null, 2)}\n`

// Modo habilitado (ACIONAMENTO.md): dentro do herdr, todo pedido lembra o agente de pensar o trabalho em frentes e
// mostrar o disparo de cada uma. A regra inteira vai no primeiro pedido e depois de compactar; nos outros, a curta.
export const REGRA_HABILITADO =
  '[herdr] habilitado (herdr-vizinhos/ACIONAMENTO.md): planeje em frentes (workspace = projeto, tab = frente, pane = perfil de agente). ' +
  'Com duas ou mais frentes, decida e mostre no plano, por frente: paralelo ou fila, o meio (sessão, subagente, workflow ou pane do herdr) ' +
  'e o harness (claude, codex…). Frente delegada a um pane leva briefing (ferramenta briefing: escrever antes de abrir o pane, ' +
  'conferir o escopo antes da prova). A sessão de outro workspace é do operador.'
export const REGRA_CURTA = '[herdr] habilitado: plano com 2+ frentes declara, por frente, paralelo ou fila, meio e harness.'

export const regraHabilitado = (inteira: boolean) => (inteira ? REGRA_HABILITADO : REGRA_CURTA)
