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

/** Um comando no segundo plano: id da tarefa, o que é, onde escreve, quando começou e a última mudança vista na saída. */
export type Tarefa = { id: string; descricao: string; saida?: string; inicio: number; mtime?: number }

export type SegundoPlano = {
  tarefas: Tarefa[]
  /** Última vez que o agente agendou a volta (ScheduleWakeup, Monitor, CronCreate). */
  voltaEm: number | null
  /** Último fim de turno da conversa principal. */
  fimTurno: number | null
  /** O Stop disse que há crons da sessão para acordá-la. */
  cronsAtivos: boolean
}

/** Estado do agente no vocabulário do herdr: idle, working, blocked, done. */
export type Estado = 'ocioso' | 'trabalhando' | 'bloqueado' | 'concluido'

export type Atividade = { estado: Estado; /** Ferramenta em curso, quando trabalhando. */ ferramenta?: string; desde: number }

/** Um número que outro mod publica em ~/.claude/indicadores/<fonte>.json para o painel mostrar. */
export type Indicador = {
  fonte: string
  id: string
  rotulo: string
  valor: number
  /** Com meta, o painel desenha um medidor até ela. */
  meta?: number
  unidade?: string
  estado?: 'ok' | 'atencao' | 'alerta'
  detalhe?: string
  /** O que vai no centro do gauge ("83%", "4,8 min"); ausente, valor/meta ou o valor. */
  texto?: string
}

/** Caderno do operador (contrato em hooks/caderno.ts): nota sem compromisso, agora (deste ciclo), depois (roadmap), referência. */
export type TipoNota = 'nota' | 'agora' | 'depois' | 'referencia'
export type Decisao = 'aceita' | 'recusada' | 'muda-plano' | 'registrada'
export type EventoNota = { v: number; ev: 'nota'; id: string; em: string; autor: 'operador'; tipo: TipoNota; texto: string; /** `#12` ou a próxima pendência quando a nota foi escrita. */ ref?: string }
export type EventoTriagem = { v: number; ev: 'triagem'; id: string; em: string; autor: 'claude'; decisao: Decisao; motivo: string; /** Para onde foi: `#12`, `roadmap`... */ destino?: string; /** O melhor argumento contra a própria decisão. */ contraponto?: string }
export type Nota = EventoNota & { triagem?: EventoTriagem }

/** Quem executa: o modelo e o effort da conversa principal e os subagentes vivos. */
export type Subagente = { id: string; tipo: string; descricao: string; modelo: string; effort?: string; desde: number }
export type Executores = { principal?: { modelo: string; effort?: string }; subagentes: Subagente[] }

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
      segundoPlano: SegundoPlano | null
      atividade: Atividade | null
      /** Pendências feitas abertas no painel (recolhidas por padrão). */
      verFeitas: boolean
      indicadores: Indicador[]
      /** Espelho do painel automático do store, para o botão redesenhar. */
      painelAuto: boolean | null
      caderno: Nota[]
      /** Ids das notas já levadas ao Claude nesta sessão. */
      entregues: string[]
      tipoNota: TipoNota
      /** Conta os envios: muda a chave do campo, que volta vazio depois de cada nota. */
      envios: number
      executores: Executores
      /** O que o operador está escrevendo no caderno, para a prévia (o campo do motor é de uma linha). */
      rascunho: string
    }
  }
}
