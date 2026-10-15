// O caderno do operador: a porta por onde quem conduz o trabalho fala com o Claude durante a execução, sem
// interromper. Não é a iteração do ciclo (o objetivo e as pendências que o Claude executa): é entrada externa a
// ele. Cada nota funciona como um advisor e um adversário: um contraponto ao raciocínio do Claude, que precisa
// ser avaliado contra o plano e respondido (aceita, recusada com motivo, muda o plano, ou só registrada).
//
// Contrato (versão 1): ~/.claude/caderno/<raiz do projeto, encodeURIComponent>.jsonl, uma linha JSON por evento,
// só acréscimo. Evento `nota` (do operador) e `triagem` (do Claude), ligados pelo `id`. Nada é reescrito: a nota
// e a resposta ficam como foram dadas. Quem lê ignora campos que não conhece e linhas que não entende, para que
// versões novas, outras sessões e outros agentes (via herdr) escrevam no mesmo arquivo sem quebrar ninguém.
import type { Decisao, EventoNota, EventoTriagem, Nota, TipoNota } from '../types'

export const VERSAO_CADERNO = 1

// A regra de uma linha, pelo compromisso (GTD, Kanban upstream, Shape Up): vai ser feito neste ciclo? → agora.
// Quero que chegue lá, mas não neste ciclo → depois (roadmap). Nem isso → nota. Link, busca ou imagem a serviço de
// algo → referência. Na dúvida, nota: o Claude propõe o tipo na triagem. A força sobre o Claude vem do tipo: nota
// informa sem mudar o rumo; agora entra na fila sem abandonar o que está em curso; depois só é registrada.
export const TIPOS: { tipo: TipoNota; rotulo: string; regra: string }[] = [
  { tipo: 'nota', rotulo: 'nota', regra: 'observação, ideia ou dúvida: o Claude avalia e responde, sem mudar de rumo' },
  { tipo: 'agora', rotulo: 'agora', regra: 'vai ser feito neste ciclo: entra na fila sem largar o que está em curso' },
  { tipo: 'depois', rotulo: 'depois', regra: 'quero que chegue lá, mas não neste ciclo: vai ao roadmap' },
  { tipo: 'referencia', rotulo: 'referência', regra: 'link, busca ou imagem a serviço de uma pendência (#id) ou do trabalho atual' },
]
const NOMES_TIPO = TIPOS.map(t => t.tipo)
export const DECISOES: Decisao[] = ['aceita', 'recusada', 'muda-plano', 'registrada']

export const PROPOSITO =
  'Caderno do operador: entrada de quem conduz o trabalho, fora da iteração do ciclo. Cada nota é um advisor e um ' +
  'adversário do seu raciocínio. Antes de decidir: contradiz uma premissa sua? muda a prioridade? revela um risco ' +
  'que você não via? dá para verificar já (se dá, verifique)? qual o melhor argumento contra a nota, e contra a sua ' +
  'decisão? Aceitar só porque veio do operador é tão errado quanto recusar só porque o plano já estava feito. ' +
  'Responda com acao "triar" (nota, decisao aceita|recusada|muda-plano|registrada, motivo verificável, destino, contraponto).'

/** `#12 texto` liga a nota à pendência 12; sem prefixo, à próxima pendência no momento da escrita. */
export function novaNota(texto: string, tipo: TipoNota, em: string, sufixo: string, refPadrao?: string): EventoNota | null {
  const t = texto.replace(/\s+/g, ' ').trim()
  const m = /^#(\d+)\b\s*(.*)$/.exec(t)
  const corpo = (m ? m[2]! : t).trim()
  if (!corpo) return null
  const ref = m ? `#${m[1]}` : refPadrao
  return { v: VERSAO_CADERNO, ev: 'nota', id: `n-${em.replace(/\D/g, '').slice(0, 14)}-${sufixo}`, em, autor: 'operador', tipo, texto: corpo, ...(ref ? { ref } : {}) }
}

export function triagem(id: string, decisao: Decisao, motivo: string, em: string, destino?: string, contraponto?: string): EventoTriagem {
  return {
    v: VERSAO_CADERNO,
    ev: 'triagem',
    id,
    em,
    autor: 'claude',
    decisao,
    motivo: motivo.trim(),
    ...(destino?.trim() ? { destino: destino.trim() } : {}),
    ...(contraponto?.trim() ? { contraponto: contraponto.trim() } : {}),
  }
}

export const linha = (ev: EventoNota | EventoTriagem) => `${JSON.stringify(ev)}\n`

/** As notas do arquivo, na ordem em que foram escritas, cada uma com a triagem mais recente. Tolerante a lixo. */
export function lerCaderno(texto: string): Nota[] {
  const notas = new Map<string, Nota>()
  for (const bruta of texto.split('\n')) {
    if (!bruta.trim()) continue
    let o: Record<string, unknown>
    try {
      o = JSON.parse(bruta)
    } catch {
      continue
    }
    if (!o || typeof o !== 'object' || typeof o.v !== 'number' || o.v < 1 || typeof o.id !== 'string' || !o.id) continue
    if (o.ev === 'nota') {
      if (typeof o.texto !== 'string' || !o.texto || notas.has(o.id)) continue
      // 'ideia' era o nome da nota antes da pesquisa de 15/10; tipo desconhecido (de uma versão nova) também vira nota.
      const tipo = NOMES_TIPO.includes(o.tipo as TipoNota) ? (o.tipo as TipoNota) : 'nota'
      notas.set(o.id, {
        v: o.v,
        ev: 'nota',
        id: o.id,
        em: typeof o.em === 'string' ? o.em : '',
        autor: 'operador',
        tipo,
        texto: o.texto,
        ...(typeof o.ref === 'string' && o.ref ? { ref: o.ref } : {}),
      })
    } else if (o.ev === 'triagem') {
      const n = notas.get(o.id)
      if (!n || !DECISOES.includes(o.decisao as Decisao) || typeof o.motivo !== 'string') continue
      const texto = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : undefined)
      n.triagem = triagem(o.id, o.decisao as Decisao, o.motivo, texto('em') ?? '', texto('destino'), texto('contraponto'))
    }
  }
  return [...notas.values()]
}

export const semResposta = (notas: Nota[]) => notas.filter(n => !n.triagem)

/** Há quanto tempo, em palavras curtas. */
export function idade(em: string, agora: number): string {
  const ms = agora - Date.parse(em)
  if (!Number.isFinite(ms) || ms < 60000) return 'agora há pouco'
  const min = Math.round(ms / 60000)
  return min < 60 ? `há ${min} min` : `há ${Math.round(min / 60)} h`
}

/**
 * O texto que leva ao Claude as notas ainda não entregues: com a idade, o aviso de que o operador não viu o que
 * veio depois e o limite de autoridade (uma nota não responde a pergunta nem aprova ação; salvo "agora", a tarefa
 * segue). O propósito vai junto na primeira entrega da sessão.
 */
export function entrega(notas: Nota[], comProposito: boolean, agora: number): string {
  if (!notas.length) return ''
  const corpo = notas.map(n => `${n.id} (${n.tipo}${n.ref ? `, sobre ${n.ref}` : ''}, ${idade(n.em, agora)}): ${n.texto}`).join(' | ')
  const limite = 'O operador escreveu sem ver as saídas seguintes. Isto não responde a pergunta sua nem vale como aprovação; salvo "agora", continue a tarefa atual.'
  return `[caderno] ${notas.length === 1 ? 'Nota nova' : `${notas.length} notas novas`} do operador: ${corpo} — ${limite}${comProposito ? ` ${PROPOSITO}` : ' Responda com acao "triar".'}`
}

/** Sufixo da linha de cada pedido: quantas notas esperam resposta. */
export function pendenciaDoCaderno(notas: Nota[]): string {
  const n = semResposta(notas).length
  return n ? ` · caderno: ${n} sem resposta` : ''
}

export const GLIFO_DECISAO: Record<Decisao | 'aguardando', { glifo: string; cor: string; rotulo: string }> = {
  aguardando: { glifo: '◌', cor: 'warning', rotulo: 'aguardando' },
  aceita: { glifo: '✔', cor: 'success', rotulo: 'aceita' },
  recusada: { glifo: '✗', cor: 'error', rotulo: 'recusada' },
  'muda-plano': { glifo: '↻', cor: 'claude', rotulo: 'mudou o plano' },
  registrada: { glifo: '·', cor: 'subtle', rotulo: 'registrada' },
}
