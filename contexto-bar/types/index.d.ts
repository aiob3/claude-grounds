export type GroupKey = 'sistema' | 'claudemd' | 'mcp' | 'skills' | 'hooks' | 'conversa' | 'livre' | 'reserva'

export type Segment = { key: GroupKey; tokens: number }

export type Snapshot = {
  /** Uso sobre a janela de compactação, 0-100. */
  percent: number
  /** Soma de todos os segmentos (inclui livre e reserva). */
  total: number
  segments: Segment[]
}

export type Owner = 'claude' | 'operador'
export type Size = 'P' | 'M' | 'G'
/** Prioridade: bloqueante trava outra pendência ou a entrega; requisito é preciso para a entrega; melhoria pode esperar. */
export type Nivel = 'bloqueante' | 'requisito' | 'melhoria'

export type GoalItem = { id: number; texto: string; dono: Owner; tamanho: Size; feito: boolean; /** Ausente nos objetivos gravados antes da 0.5.0: vale requisito. */ nivel?: Nivel }

export type Goal = {
  titulo: string
  /** O passo que encerra o objetivo. */
  conclusao: string
  origem: Owner
  itens: GoalItem[]
  /** Contexto em uso na última pendência do Claude concluída (ou na definição). */
  marco: number
  /** Tokens de janela por unidade de peso, das últimas pendências concluídas. */
  consumo: number[]
  atualizadoTurno: number
  /** Último aviso de janela dado ao modelo, para não repetir. */
  aviso: 'apertado' | 'nao-cabe' | null
}

/** Somas do cache de prompt da sessão: tokens lidos do cache, tokens de entrada no total e quantas respostas contaram. */
export type Cache = {
  lidos: number
  total: number
  n: number
  /** Id da última resposta somada do transcript: o transcript grava uma linha por bloco, todas com o mesmo uso. */
  ultimoId?: string
}

declare module 'claude-code' {
  interface PluginState {
    'contexto-bar': {
      snapshot: Snapshot | null
      objetivo: Goal | null
      turno: number
      /** Somas do cache de prompt da sessão; `parcial` quando o transcript não pôde ser lido e conta só desde o carregamento. */
      cache: { acc: Cache; parcial: boolean } | null
      /** Tamanho do último pedido (entrada sem cache + lida + gravada no cache). */
      pedido: number | null
    }
  }
}
