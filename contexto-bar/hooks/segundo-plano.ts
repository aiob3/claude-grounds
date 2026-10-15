// Trabalho em segundo plano que ficou mudo. Nasceu de uma falha real (numa sessão paralela, 15/10/2026): uma verificação
// longa foi para o segundo plano, o turno acabou, a saída ficou em 0 bytes (stdout do Python em buffer) e o agente
// esperou 37 minutos até o operador perguntar "concluiu?". Só observa: nunca trava uma chamada.

import type { SegundoPlano, Tarefa } from '../types'

export type { SegundoPlano, Tarefa }

export const SP_VAZIO: SegundoPlano = { tarefas: [], voltaEm: null, fimTurno: null, cronsAtivos: false }
/** Minutos sem a saída mudar para a tarefa contar como muda. */
export const MINUTOS_SEM_SAIDA = 5
/** Ferramentas que trazem o agente de volta sem o operador pedir. */
export const FERRAMENTAS_DE_VOLTA = ['ScheduleWakeup', 'Monitor', 'CronCreate']

export function registrarTarefa(sp: SegundoPlano, t: Tarefa): SegundoPlano {
  return { ...sp, tarefas: [...sp.tarefas.filter(x => x.id !== t.id), t] }
}

export function concluirTarefa(sp: SegundoPlano, id: string): SegundoPlano {
  return sp.tarefas.some(t => t.id === id) ? { ...sp, tarefas: sp.tarefas.filter(t => t.id !== id) } : sp
}

/**
 * Fim do turno da conversa principal. `emCurso` é o que o Stop lista em andamento (ausente, nada se sabe): some a
 * tarefa que não está lá. Se há shells listados e nenhum id bate com os nossos, os ids não são da mesma família e
 * nada se tira, para não calar um alerta verdadeiro.
 */
export function fimDeTurno(sp: SegundoPlano, agora: number, emCurso?: readonly { id: string; type?: string }[], crons?: number): SegundoPlano {
  const ids = emCurso?.map(t => t.id)
  const desencontro = !!emCurso?.some(t => t.type === 'shell') && !sp.tarefas.some(t => ids!.includes(t.id))
  const tarefas = ids && !desencontro ? sp.tarefas.filter(t => ids.includes(t.id)) : sp.tarefas
  return { ...sp, tarefas, fimTurno: agora, cronsAtivos: crons === undefined ? sp.cronsAtivos : crons > 0 }
}

/** O id e o estado de uma notificação de tarefa (`<task-id>`, `<status>`), ou null. */
export function notificacao(texto: string): { id: string; status: string } | null {
  const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(texto)?.[1]
  if (!id) return null
  return { id, status: /<status>\s*([^<\s]+)\s*<\/status>/.exec(texto)?.[1] ?? '' }
}

/** O arquivo de saída que o resultado do Bash em segundo plano anuncia. */
export function caminhoSaida(texto: string | undefined): string | undefined {
  return texto ? /(\/[^\s'"`]+\.output)\b/.exec(texto)?.[1] : undefined
}

export type Alerta = { tarefa: Tarefa; semSaidaMin: number | null; semVolta: boolean }

/** Tarefas em curso que pedem atenção: saída parada há `minutos` ou mais, ou turno encerrado sem volta agendada. */
export function alertas(sp: SegundoPlano, agora: number, minutos = MINUTOS_SEM_SAIDA): Alerta[] {
  const r: Alerta[] = []
  for (const t of sp.tarefas) {
    const parado = t.saida ? Math.floor((agora - Math.max(t.mtime ?? t.inicio, t.inicio)) / 60000) : 0
    const semSaidaMin = parado >= minutos ? parado : null
    const voltou = sp.cronsAtivos || (sp.voltaEm !== null && sp.voltaEm >= t.inicio)
    const semVolta = !voltou && sp.fimTurno !== null && sp.fimTurno >= t.inicio
    if (semSaidaMin !== null || semVolta) r.push({ tarefa: t, semSaidaMin, semVolta })
  }
  return r
}

const curta = (t: string) => (t.length > 40 ? `${t.slice(0, 39)}…` : t)

/** O pedaço da linha ao modelo: curto, só com o primeiro alerta (e quantos mais houver). */
export function avisoAoModelo(a: Alerta[]): string {
  const p = a[0]
  if (!p) return ''
  const partes = [p.semSaidaMin !== null ? `sem saída há ${p.semSaidaMin} min` : '', p.semVolta ? 'sem volta agendada' : ''].filter(Boolean)
  return ` · ⚠ tarefa em segundo plano ${partes.join(', ')}${a.length > 1 ? ` (+${a.length - 1})` : ''}`
}

/** Uma linha do painel por tarefa em curso. */
export function linhasDoPainel(sp: SegundoPlano, agora: number): string[] {
  const a = alertas(sp, agora)
  return sp.tarefas.map(t => {
    const al = a.find(x => x.tarefa.id === t.id)
    const partes = [al?.semSaidaMin != null ? `sem saída há ${al.semSaidaMin} min` : '', al?.semVolta ? 'nada agendado para voltar' : ''].filter(Boolean)
    return `segundo plano: ${curta(t.descricao)} · ${partes.length ? partes.join(' · ') : 'em curso'}`
  })
}
