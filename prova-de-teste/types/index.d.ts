export type Categoria = 'borda/vazio' | 'empate/ordem' | 'null/inválido' | 'condição invertida' | 'livre'

export type Mutante = { arquivo: string; linha: number; categoria: Categoria; mutacao: string }

/** A última lista escolhida às cegas: o que foi enviado e o que voltou. */
export type Escolha = {
  /** Raiz do repositório de onde saiu o diff. */
  raiz: string
  base: string
  modelo: string
  /** Arquivos-fonte cujo diff foi enviado ao modelo. */
  enviados: string[]
  /** Arquivos de teste retirados do diff antes do envio. */
  excluidos: string[]
  /** Arquivos que não são código (docs, dotfiles, lockfiles), fora do envio. */
  naoCodigo?: string[]
  /** Aviso de envio dominado por arquivos fora do git. */
  avisoNovos?: string
  /** 0.9.0: a resposta bateu no teto de tokens e a última linha saiu. */
  avisoCorte?: string
  mutantes: Mutante[]
  /** 0.7.0: linhas adicionadas ou removidas no diff do código-fonte enviado. */
  linhasDoDiff?: number
  /** Categorias que o modelo declarou não aplicáveis, com o motivo. */
  naoAplicaveis: string[]
}

/** Os números da última rodada que o próprio mod executou: o registrar só aceita estes. */
export type ExecucaoFeita = {
  tarefa: string
  aplicados: number
  mortos: number
  sobreviventes: number
  estado: string
  quando: string
  /** v1.2: versão do mod que executou, e se o diff mexia no próprio mod. */
  versao?: string
  alteraInstrumento?: boolean
  /** 0.6.0: o teto do estado com os sobreviventes justificados, e quais sobreviveram. */
  estadoSeEquivalentes?: string
  sobreviventesN?: number[]
  /** 0.7.0: o resumo do custo da rodada (base, por mutante, repositório, diff), que vai ao log. */
  custo?: string
}

declare module 'claude-code' {
  interface PluginState {
    'prova-de-teste': { avisadoTurno: number; ultima: Escolha | null; execucao: ExecucaoFeita | null }
  }
}
