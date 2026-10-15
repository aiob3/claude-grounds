// O placar do EXP-001 lido do log, com as mesmas regras do gerador do público (publico/gerar.py: classe,
// vigentes, contagem): o painel e o README não podem discordar. Vira um indicador do contexto-bar.

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

export type Placar = {
  medicoes: number
  calibracoes: number
  /** Medições com ao menos um sobrevivente real. */
  comReais: number
  tempoMedio: number | null
  estavel: boolean
  seguidas: number
  versao: string | null
}

export function placar(log: string): Placar {
  const linhas = vigentes(log.split('\n').filter(l => LINHA.test(l)))
  const medicoes = linhas.filter(l => classe(l)?.tipo === 'medição')
  // Como o float() do gerador: número inteiro ou decimal, zero incluído; "—" e campo vazio ficam de fora.
  const tempos = medicoes.map(l => l.split('|')[6]?.trim() ?? '').filter(t => /^-?\d+(\.\d+)?$/.test(t)).map(Number)
  // Estável: as 3 últimas medições na mesma versão, sem calibração dessa versão depois delas.
  let seguidas = 0
  let versao: string | null = null
  for (const l of linhas) {
    const c = classe(l)
    if (!c) continue
    if (c.tipo === 'medição' && c.instrumento === versao) seguidas++
    else if (c.tipo === 'medição') [versao, seguidas] = [c.instrumento, 1]
    else [versao, seguidas] = [null, 0]
  }
  return {
    medicoes: medicoes.length,
    calibracoes: linhas.filter(l => classe(l)?.tipo === 'calibração').length,
    comReais: medicoes.filter(l => Number(/\| reais: (\d+)/.exec(l)?.[1] ?? 0) > 0).length,
    tempoMedio: tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null,
    estavel: seguidas >= 3,
    seguidas,
    versao,
  }
}

// O critério de promoção do protocolo (seção "Critério de saída"): reais em ≥ 3 medições, tempo médio < 2 min, estável.
export const META_MEDICOES = 10
export function criterios(p: Placar): { atendidos: number; total: 3 } {
  const ok = [p.comReais >= 3, p.tempoMedio !== null && p.tempoMedio < 120, p.estavel]
  return { atendidos: ok.filter(Boolean).length, total: 3 }
}

/** O arquivo de indicadores (contrato do contexto-bar, versão 1) com o placar. */
export function indicadorDoPlacar(p: Placar): string {
  const c = criterios(p)
  const tempo = p.tempoMedio === null ? 'sem tempo' : `tempo médio ${Math.round(p.tempoMedio)} s`
  const estab = p.estavel ? `estável em ${p.versao}` : `instável (${p.seguidas} de 3 seguidas)`
  return `${JSON.stringify(
    {
      versao: 1,
      fonte: 'prova-de-teste',
      itens: [
        {
          id: 'exp-001',
          rotulo: 'EXP-001',
          valor: p.medicoes,
          meta: META_MEDICOES,
          unidade: 'medições',
          estado: p.medicoes >= META_MEDICOES && c.atendidos === c.total ? 'ok' : 'atencao',
          detalhe: `promoção: ${c.atendidos}/${c.total} critérios (reais em ${p.comReais} medições, ${tempo}, ${estab}) · ${p.calibracoes} calibrações`,
        },
      ],
    },
    null,
    2,
  )}\n`
}
