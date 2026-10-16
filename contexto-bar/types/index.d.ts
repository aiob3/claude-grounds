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

/** 0.18.0: como uma frente roda (ACIONAMENTO.md do herdr-vizinhos): em paralelo ou em fila, por qual meio, em qual harness. */
export type Disparo = { modo: 'paralelo' | 'fila'; meio: 'sessao' | 'subagente' | 'workflow' | 'herdr'; harness?: string }

export type GoalItem = { id: number; texto: string; dono: Owner; tamanho: Size; feito: boolean; /** Ausente nos objetivos gravados antes da 0.5.0: vale requisito. */ nivel?: Nivel; disparo?: Disparo }

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

/** 0.16.0: um workspace vizinho, como o mod herdr-vizinhos o escreve (contrato em painel.ts). */
export type EstadoHerdr = 'idle' | 'working' | 'blocked' | 'done' | 'unknown'
/** 0.19.0: a rodada do prova-de-teste como o executar a escreve enquanto roda (contrato em painel.ts). */
export type AoVivoProva = { tarefa: string; fase: 'base' | 'mutantes' | 'fim'; total: number; feitos: number; mortos: number; sobreviventes: number; naoAplicados: number; inicio: number; agora: number; copias?: number; estado?: string }
export type VizinhoHerdr = { workspace: string; rotulo: string; estado: EstadoHerdr; agentes: { pane: string; estado: EstadoHerdr; titulo: string }[] }

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

/** Roadmap (contrato em hooks/roadmap.ts): o plano além do objetivo em curso, por horizonte. */
export type Horizonte = 'agora' | 'proximo' | 'depois'
export type EventoRoadmap =
  | { v: number; ev: 'item'; id: string; em: string; autor: Owner; texto: string; horizonte: Horizonte; frente?: string; /** De onde veio: `#7` (pendência adiada), `n-...` (nota do caderno). */ de?: string }
  | { v: number; ev: 'mover'; id: string; em: string; horizonte: Horizonte }
  | { v: number; ev: 'promover'; id: string; em: string; pendencia: number; /** Quem promoveu (0.21.0); o operador promover aprova. */ por?: Owner }
  /** 0.21.0 (R18): o operador aprova a proposta (botão), ou o Claude registra a aprovação dita em mensagem, com a frase. */
  | { v: number; ev: 'aprovar'; id: string; em: string; por: Owner; citacao?: string }
  | { v: number; ev: 'descartar'; id: string; em: string; motivo: string }
/** Um item com o estado depois de todos os eventos; `n` é a ordem de entrada no arquivo (R1, R2...). */
export type ItemRoadmap = {
  n: number
  id: string
  texto: string
  horizonte: Horizonte
  frente?: string
  de?: string
  estado: 'aberto' | 'promovido' | 'descartado'
  pendencia?: number
  motivo?: string
  /** 0.21.0 (R18): quem escreveu o item. */
  autor: Owner
  /** Escrito pelo operador, vindo do objetivo (`de` #n) ou aprovado depois; o resto é proposta do Claude. */
  aprovado: boolean
}

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
      /** Passos (ferramentas da conversa principal) desta sessão, e o passo da última entrega de cada nota. */
      passos: number
      ultimaEntrega: Record<string, number>
      roadmap: ItemRoadmap[]
      /** Próximo e depois abertos no painel (agora aparece sempre). */
      verRoadmap: boolean
      /** Os outros workspaces do herdr, do arquivo deste pane; vazio fora do herdr ou sem o mod. */
      vizinhos: VizinhoHerdr[]
      /** A rodada do prova-de-teste desta sessão (o arquivo ao vivo do executar); null sem nenhuma. */
      aoVivo: AoVivoProva | null
    }
  }
}
