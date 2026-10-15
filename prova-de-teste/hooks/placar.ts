// O log do EXP-001 lido com as mesmas regras do gerador do público (publico/gerar.py: classe, vigentes), para o
// painel e o README não discordarem. Daqui sai a efetividade do ciclo, um indicador do contexto-bar.

const LINHA = /^\d{4}-\d{2}-\d{2} \|/

/** (instrumento, 'medição' | 'calibração') de uma linha v1.2; undefined nas v1.0/v1.1. */
export function classe(linha: string): { instrumento: string; tipo: 'medição' | 'calibração' } | undefined {
  const m = /\| instrumento: ([^|]+) \| (medição|calibração)/.exec(linha)
  return m ? { instrumento: m[1]!.trim(), tipo: m[2] as 'medição' | 'calibração' } : undefined
}

/** As linhas que valem: uma CORREÇÃO da linha anterior substitui a linha classificada que veio antes dela. */
export function vigentes(linhas: string[]): string[] {
  const r: string[] = []
  for (const l of linhas) {
    if (l.includes('CORREÇÃO da linha anterior')) {
      for (let i = r.length - 1; i >= 0; i--) {
        if (classe(r[i]!)) {
          r.splice(i, 1)
          break
        }
      }
    }
    r.push(l)
  }
  return r
}

// Efetividade do ciclo (pedido do operador em 15/10/2026, no lugar do placar do EXP-001, que passou da meta):
// - 1ª passada: dos mutantes da primeira lista às cegas de cada tarefa, quantos os testes já matam. Mede a qualidade
//   do que o Claude escreve antes do adversário; não depende do tamanho do repositório, e quem escolhe os mutantes é
//   outro modelo, sem ver os testes.
// - até provar: o tempo de todas as rodadas de uma tarefa até o PROVADO. É o tempo do ciclo.
// Os dois comparam as últimas JANELA tarefas provadas com as JANELA anteriores.
export const JANELA = 5

export type Tarefa = { nome: string; rodadas: number; aplicados1: number; mortos1: number; tempo: number; provada: boolean }

/** O nome da tarefa: o que vem antes do primeiro ":" (contexto-bar 0.12.0, motor, publico). */
const nomeDe = (l: string) => (l.split('|')[1] ?? '').split(':')[0]!.trim()

/**
 * As tarefas do log: as rodadas com o mesmo nome formam uma tarefa até o PROVADO, mesmo intercaladas com as de
 * outra sessão que grava no mesmo log. Só linhas v1.2 com contagem de mutantes; a CORREÇÃO substitui a que corrige.
 */
export function tarefas(log: string): Tarefa[] {
  const r: Tarefa[] = []
  for (const l of vigentes(log.split('\n').filter(x => LINHA.test(x)))) {
    const m = /\| mutantes: (\d+)\/(\d+)\/\d+ \|/.exec(l)
    if (!m || !classe(l) || l.includes('CORREÇÃO da linha anterior')) continue
    const campos = l.split('|').map(c => c.trim())
    const tempo = /^\d+(\.\d+)?$/.test(campos[6] ?? '') ? Number(campos[6]) : 0
    const nome = nomeDe(l)
    const atual = r.findLast(t => t.nome === nome && !t.provada)
    if (atual) {
      atual.rodadas++
      atual.tempo += tempo
      atual.provada = campos[5] === 'PROVADO'
    } else {
      r.push({ nome, rodadas: 1, aplicados1: Number(m[1]), mortos1: Number(m[2]), tempo, provada: campos[5] === 'PROVADO' })
    }
  }
  return r
}

export type Efetividade = {
  n: number
  primeira: number | null
  primeiraAntes: number | null
  tempo: number | null
  tempoAntes: number | null
  rodadas: number | null
  rodadasAntes: number | null
}

function janela(ts: Tarefa[]): { primeira: number | null; tempo: number | null; rodadas: number | null } {
  if (!ts.length) return { primeira: null, tempo: null, rodadas: null }
  const apl = ts.reduce((a, t) => a + t.aplicados1, 0)
  return {
    primeira: apl ? ts.reduce((a, t) => a + t.mortos1, 0) / apl : null,
    tempo: ts.reduce((a, t) => a + t.tempo, 0) / ts.length,
    rodadas: ts.reduce((a, t) => a + t.rodadas, 0) / ts.length,
  }
}

export function efetividade(log: string, n = JANELA): Efetividade {
  const provadas = tarefas(log).filter(t => t.provada)
  const agora = janela(provadas.slice(-n))
  const antes = janela(provadas.slice(-2 * n, -n))
  return { n: Math.min(n, provadas.length), primeira: agora.primeira, primeiraAntes: antes.primeira, tempo: agora.tempo, tempoAntes: antes.tempo, rodadas: agora.rodadas, rodadasAntes: antes.rodadas }
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const min = (s: number) => `${(s / 60).toFixed(1).replace('.', ',')} min`
const dec = (x: number) => x.toFixed(1).replace('.', ',')

/** O arquivo de indicadores (contrato do contexto-bar, versão 1, com o campo opcional `texto` para o centro). */
export function indicadoresDeEfetividade(e: Efetividade): string {
  const itens: Record<string, unknown>[] = []
  if (e.primeira !== null) {
    const melhor = e.primeiraAntes === null || e.primeira >= e.primeiraAntes
    itens.push({
      id: 'primeira-passada',
      rotulo: '1ª passada',
      valor: Math.round(e.primeira * 100),
      meta: 100,
      unidade: '%',
      texto: pct(e.primeira),
      estado: melhor ? 'ok' : 'atencao',
      detalhe:
        `mutantes que os testes já matam na 1ª lista às cegas, últimas ${e.n} tarefas: ${pct(e.primeira)}` +
        `${e.primeiraAntes !== null ? ` (antes ${pct(e.primeiraAntes)})` : ''}` +
        `${e.rodadas !== null ? ` · rodadas até provar ${dec(e.rodadas)}${e.rodadasAntes !== null ? ` (antes ${dec(e.rodadasAntes)})` : ''}` : ''}`,
    })
  }
  if (e.tempo !== null) {
    const base = e.tempoAntes
    const delta = base ? Math.round(((e.tempo - base) / base) * 100) : null
    itens.push({
      id: 'ate-provar',
      rotulo: 'até provar',
      valor: Math.round(e.tempo),
      // A meta é o tempo das tarefas anteriores: o arco cheio é gastar o mesmo; menos arco, ciclo mais curto.
      ...(base ? { meta: Math.round(base) } : {}),
      unidade: 's',
      texto: min(e.tempo),
      estado: base === null || e.tempo <= base ? 'ok' : 'atencao',
      detalhe:
        `tempo das rodadas até o PROVADO, média das últimas ${e.n} tarefas: ${min(e.tempo)}` +
        `${base ? ` (antes ${min(base)}, ${delta! > 0 ? '+' : ''}${delta}%)` : ''}`,
    })
  }
  return `${JSON.stringify({ versao: 1, fonte: 'prova-de-teste', itens }, null, 2)}\n`
}
