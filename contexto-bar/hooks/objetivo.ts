import type { Goal, GoalItem, ItemRoadmap, Nivel, Owner, Size, Snapshot } from '../types'

// Peso de cada tamanho na projeção; o custo por unidade vem do histórico (ou do padrão abaixo).
export const PESO: Record<Size, number> = { P: 1, M: 2, G: 4 }
// Sem histórico: tokens de janela por unidade de peso (uma pendência pequena).
export const UNIDADE_PADRAO = 6000
const AMOSTRAS = 8

// Ordem de execução: o que trava vem antes do que a entrega precisa, que vem antes do que pode esperar.
export const NIVEIS: Nivel[] = ['bloqueante', 'requisito', 'melhoria']
const ehNivel = (n: unknown): n is Nivel => NIVEIS.includes(n as Nivel)
export const nivelDe = (i: GoalItem): Nivel => i.nivel ?? 'requisito'

/** Pendências na ordem de execução: nível, depois a ordem em que entraram. */
export function ordenar(itens: GoalItem[]): GoalItem[] {
  return [...itens].sort((a, b) => NIVEIS.indexOf(nivelDe(a)) - NIVEIS.indexOf(nivelDe(b)) || a.id - b.id)
}

/** A próxima pendência a fazer, de qualquer dono. */
export function proxima(g: Goal): GoalItem | undefined {
  return ordenar(g.itens.filter(i => !i.feito))[0]
}

/** Etiqueta do nível na linha e no resumo; requisito é o comum e não leva etiqueta. */
export const etiqueta = (i: GoalItem) => (nivelDe(i) === 'requisito' ? '' : `[${nivelDe(i)}] `)

export type Acao = {
  acao: 'definir' | 'adicionar' | 'concluir' | 'reabrir' | 'priorizar' | 'encerrar' | 'ver' | 'retirar'
  titulo?: string
  conclusao?: string
  itens?: { texto: string; dono?: Owner; tamanho?: Size; nivel?: Nivel }[]
  ids?: number[]
  nivel?: Nivel
}

export type Projecao = {
  abertasClaude: number
  abertasOperador: number
  feitas: number
  total: number
  /** Tokens de janela por unidade de peso (média do histórico ou padrão). */
  unidade: number
  comHistorico: boolean
  /** Tokens estimados para as pendências do Claude que faltam. */
  necessario: number
  /** Tokens livres antes da reserva de compactação. */
  livre: number
  estado: 'cabe' | 'apertado' | 'nao-cabe' | 'sem-dados'
}

/** Tokens em uso na janela (tudo menos livre e reserva). */
export function usado(snap: Snapshot | null): number {
  if (!snap) return 0
  return snap.segments.reduce((a, s) => (s.key === 'livre' || s.key === 'reserva' ? a : a + s.tokens), 0)
}

export function livre(snap: Snapshot | null): number {
  return snap?.segments.find(s => s.key === 'livre')?.tokens ?? 0
}

function novosItens(base: number, itens: Acao['itens'], donoPadrao: Owner): GoalItem[] {
  return (itens ?? [])
    .filter(i => i.texto && i.texto.trim())
    .map((i, k) => ({
      id: base + k + 1,
      texto: i.texto.trim(),
      dono: i.dono === 'operador' ? 'operador' : i.dono === 'claude' ? 'claude' : donoPadrao,
      tamanho: i.tamanho === 'P' || i.tamanho === 'G' ? i.tamanho : 'M',
      feito: false,
      nivel: ehNivel(i.nivel) ? i.nivel : 'requisito',
    }))
}

/** Aplica uma ação ao objetivo. `uso` é o contexto em uso agora; `turno`, o contador de turnos. */
export function aplicar(
  atual: Goal | null,
  a: Acao,
  origem: Owner,
  uso: number,
  turno: number,
): { goal: Goal | null; erro?: string } {
  if (a.acao === 'ver') return { goal: atual }
  if (a.acao === 'encerrar') return { goal: null }
  if (a.acao === 'definir') {
    if (!a.titulo?.trim()) return { goal: atual, erro: 'definir precisa de titulo.' }
    return {
      goal: {
        titulo: a.titulo.trim(),
        conclusao: a.conclusao?.trim() || '',
        origem,
        itens: novosItens(0, a.itens, 'claude'),
        marco: uso,
        consumo: atual?.consumo ?? [],
        atualizadoTurno: turno,
        aviso: null,
      },
    }
  }
  if (!atual) return { goal: null, erro: 'nenhum objetivo ativo: use definir primeiro.' }
  const g: Goal = { ...atual, atualizadoTurno: turno }
  if (a.titulo?.trim()) g.titulo = a.titulo.trim()
  if (a.conclusao?.trim()) g.conclusao = a.conclusao.trim()

  if (a.acao === 'adicionar') {
    const base = g.itens.reduce((m, i) => Math.max(m, i.id), 0)
    g.itens = [...g.itens, ...novosItens(base, a.itens, 'claude')]
    return { goal: g }
  }
  const ids = new Set(a.ids ?? [])
  if (ids.size === 0) return { goal: atual, erro: `${a.acao} precisa de ids.` }
  const desconhecidos = [...ids].filter(id => !g.itens.some(i => i.id === id))
  if (desconhecidos.length) return { goal: atual, erro: `ids inexistentes: ${desconhecidos.join(', ')}.` }

  if (a.acao === 'priorizar') {
    if (!ehNivel(a.nivel)) return { goal: atual, erro: `priorizar precisa de nivel (${NIVEIS.join(' | ')}).` }
    g.itens = g.itens.map(i => (ids.has(i.id) ? { ...i, nivel: a.nivel } : i))
    return { goal: g }
  }
  // retirar: a pendência sai do objetivo (o roadmap a guarda antes, pela acao "adiar"); não é concluir.
  if (a.acao === 'retirar') {
    g.itens = g.itens.filter(i => !ids.has(i.id))
    return { goal: g }
  }
  if (a.acao === 'reabrir') {
    g.itens = g.itens.map(i => (ids.has(i.id) ? { ...i, feito: false } : i))
    return { goal: g }
  }
  // concluir: o contexto gasto desde o último marco vira uma amostra por unidade de peso.
  const fechando = g.itens.filter(i => ids.has(i.id) && !i.feito)
  const pesoClaude = fechando.filter(i => i.dono === 'claude').reduce((s, i) => s + PESO[i.tamanho], 0)
  const delta = uso - g.marco
  if (pesoClaude > 0 && delta > 0) g.consumo = [...g.consumo, Math.round(delta / pesoClaude)].slice(-AMOSTRAS)
  if (pesoClaude > 0) g.marco = uso
  g.itens = g.itens.map(i => (ids.has(i.id) ? { ...i, feito: true } : i))
  return { goal: g }
}

/**
 * O que vale ao carregar a pasta `raiz` na sessão. `salvo` é o do store; `naSessao`, o do $.state.
 * Na primeira carga (sessão nova ou reload do módulo) um objetivo que só está no $.state vale e passa
 * a ser gravado; noutra pasta (/cd) vale o do store. O que vem do store recomeça marco, turno e aviso.
 */
export function aoCarregar(
  primeiraCarga: boolean,
  salvo: Goal | null,
  naSessao: Goal | null,
  uso: number,
  turno: number,
): { goal: Goal | null; gravar: boolean } {
  if (primeiraCarga && !salvo && naSessao) return { goal: naSessao, gravar: true }
  return { goal: salvo ? { ...salvo, marco: uso, atualizadoTurno: turno, aviso: null } : null, gravar: false }
}

/** Depois de uma compactação o uso cai: o próximo delta parte do uso novo. */
export function aposCompactar(g: Goal | null, uso: number): Goal | null {
  return g ? { ...g, marco: uso, aviso: null } : g
}

export function projetar(g: Goal, snap: Snapshot | null): Projecao {
  const abertas = g.itens.filter(i => !i.feito)
  const abertasClaude = abertas.filter(i => i.dono === 'claude')
  const comHistorico = g.consumo.length >= 2
  const unidade = comHistorico ? Math.round(g.consumo.reduce((a, b) => a + b, 0) / g.consumo.length) : UNIDADE_PADRAO
  const necessario = abertasClaude.reduce((s, i) => s + PESO[i.tamanho] * unidade, 0)
  const folga = livre(snap)
  const estado = !snap
    ? 'sem-dados'
    : necessario <= folga * 0.8
      ? 'cabe'
      : necessario <= folga
        ? 'apertado'
        : 'nao-cabe'
  return {
    abertasClaude: abertasClaude.length,
    abertasOperador: abertas.length - abertasClaude.length,
    feitas: g.itens.length - abertas.length,
    total: g.itens.length,
    unidade,
    comHistorico,
    necessario,
    livre: folga,
    estado,
  }
}

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

/**
 * A checagem de alinhamento, devolvida ao definir ou acrescentar pendências: a conclusão é o efeito que se quer, e
 * cada pendência precisa aproximar dele. Nasceu de uma falha real (lançamento do claude-grounds, 14/10/2026): as
 * pendências saíram do texto do pedido (artefatos) e não do efeito, e a entrega repetiu o molde errado duas vezes.
 */
export function alinhamento(g: Goal): string {
  if (!g.conclusao?.trim()) return 'Alinhamento: sem conclusão. Antes de começar, defina o passo que encerra pelo efeito que se quer (para quem, o que muda).'
  return (
    `Alinhamento: a conclusão "${g.conclusao}" descreve o efeito que se quer, e não só um artefato entregue? ` +
    'Cada pendência aproxima dela, e pelo menos uma mostra que o efeito aconteceu? ' +
    'Se alguma saiu do texto do pedido e não do efeito, reescreva antes de começar.'
  )
}

const JANELA = { cabe: ' · janela cabe', apertado: ' · janela apertada', 'nao-cabe': ' · janela não cabe', 'sem-dados': '' } as const
const curto = (t: string) => (t.length > 60 ? `${t.slice(0, 59)}…` : t)

/**
 * Linha que acompanha cada prompt: título, progresso, a próxima com o dono e a janela. Vai em todo pedido, então
 * fica curta: as listas e a conclusão saem pela ferramenta (acao "ver") e nas respostas de definir e concluir.
 * `completa` (objetivo recém-definido ou início de sessão) acrescenta uma vez a conclusão e como marcar.
 */
export function linhaContexto(g: Goal | null, snap: Snapshot | null, tool: string, completa = false): string {
  if (!g) {
    return `[objetivo] Nenhum objetivo ativo. Se este pedido for uma tarefa com etapas, defina-o com ${tool} (acao "definir": titulo, conclusao = o passo que encerra, itens com dono claude|operador e tamanho P|M|G).`
  }
  const p = projetar(g, snap)
  const prox = proxima(g)
  const temConclusao = !!g.conclusao?.trim()
  const linha =
    `[objetivo] ${g.titulo} · ${p.feitas}/${p.total}` +
    (prox ? ` · próxima #${prox.id} ${etiqueta(prox)}${curto(prox.texto)} (${prox.dono})` : ' · tudo feito') +
    JANELA[p.estado] +
    (temConclusao ? ' · antes de agir: isso aproxima da conclusão?' : '')
  if (!completa) return linha
  return (
    linha +
    (temConclusao ? ` Conclui quando: ${g.conclusao}.` : '') +
    ` Ao concluir cada pendência, marque com ${tool} (acao "concluir", ids); a lista inteira sai com acao "ver"; ` +
    'se uma trava outra ou pode esperar, acao "priorizar" (ids, nivel); ao fechar o ciclo, diga ao operador o que ainda é dele.'
  )
}

// Comandos que publicam: o que sai daqui chega a outras pessoas. Lista curta, por palavra inteira do comando.
const PUBLICA = [
  /\bgit\s+push\b/,
  /\bnpm\s+publish\b/,
  /\bgh\s+release\b/,
  /(^|[\s;&|(])(\S*\/)?(deploy|publicar|promover)(\.sh|\.py)?(?=$|[\s;&|)])/,
  /(^|[\s;&|(])(rsync|scp)\s/,
  // cp/mv cujo destino (o último argumento) cai em output/espelhos/
  /(^|[\s;&|(])(cp|mv)\s[^;&|]*\s\S*output\/espelhos\/\S*\s*($|[;&|])/,
]
/**
 * O comando sem o texto que ele só carrega: corpo de heredoc e string entre aspas com espaço (prosa, código de
 * teste) somem; a string sem espaço (um caminho entre aspas) fica sem as aspas. Um `git push` escrito num teste
 * não é publicar (achado na própria rodada da 0.10.0).
 */
export function semTexto(comando: string): string {
  return comando
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, ' ')
    .replace(/'([^']*)'|"((?:[^"\\]|\\.)*)"/g, (_m, a?: string, b?: string) => {
      const dentro = a ?? b ?? ''
      return /\s/.test(dentro) ? ' ' : dentro
    })
}
export const publica = (comando: string) => PUBLICA.some(r => r.test(semTexto(comando)))

/** A pendência do Claude aberta que uma publicação atropelaria: bloqueante, ou de verificar, provar ou capturar. */
export function verificacaoAberta(g: Goal | null): GoalItem | undefined {
  if (!g) return undefined
  return ordenar(g.itens.filter(i => !i.feito && i.dono === 'claude')).find(i => nivelDe(i) === 'bloqueante' || /verifica|provar|captura/i.test(i.texto))
}

/** Nota ao modelo numa chamada que publica com a verificação aberta; vazia quando não é o caso. Nunca trava. */
export function notaPublicacao(g: Goal | null, comando: string): string | undefined {
  if (!publica(comando)) return undefined
  const i = verificacaoAberta(g)
  if (!i) return undefined
  return `[objetivo] esta ação publica e a pendência #${i.id} "${curto(i.texto)}" está aberta: conclua a verificação antes, ou diga ao operador por que não`
}

/** Aviso ao modelo quando a projeção piora; devolve o novo nível para não repetir. */
export function avisoJanela(g: Goal, snap: Snapshot | null): { nivel: Goal['aviso']; texto?: string } {
  const p = projetar(g, snap)
  const nivel = p.estado === 'apertado' || p.estado === 'nao-cabe' ? p.estado : null
  if (!nivel || nivel === g.aviso) return { nivel }
  const texto =
    `[objetivo] Aviso de janela: faltam ${p.abertasClaude} pendência(s) suas, ~${k(p.necessario)} tokens estimados, ` +
    `e restam ${k(p.livre)} livres antes da compactação (${nivel === 'nao-cabe' ? 'não cabe' : 'apertado'}). ` +
    `Antes de seguir: registre o estado (objetivo atualizado, notas no vault), delegue partes a subagentes ou combine com o operador uma compactação.`
  return { nivel, texto }
}

/** Resposta da ferramenta: o estado inteiro, curto. */
export function resumo(g: Goal | null, snap: Snapshot | null): string {
  if (!g) return 'Nenhum objetivo ativo.'
  const p = projetar(g, snap)
  const linhas = ordenar(g.itens).map(i => `${i.feito ? '[x]' : '[ ]'} #${i.id} (${i.dono}, ${i.tamanho}) ${etiqueta(i)}${i.texto}`)
  return [
    `Objetivo: ${g.titulo}${g.conclusao ? ` · conclui quando: ${g.conclusao}` : ''}`,
    ...linhas,
    `${p.feitas}/${p.total} feitas · Claude ${p.abertasClaude} abertas · operador ${p.abertasOperador} · ` +
      `~${k(p.unidade)}/unidade ${p.comHistorico ? '(histórico)' : '(padrão, sem histórico)'} · ` +
      `precisa ~${k(p.necessario)} · livre ${k(p.livre)} · ${p.estado}`,
  ].join('\n')
}

/** Interpreta `/objetivo <args>` do operador. */
export function comando(args: string): Acao | 'painel' | 'auto-on' | 'auto-off' {
  const t = args.trim()
  if (!t) return 'painel'
  const [cmd, ...resto] = t.split(/\s+/)
  const c = (cmd ?? '').toLowerCase()
  if (c === 'auto' && (resto[0] === 'on' || resto[0] === 'off') && resto.length === 1) return resto[0] === 'on' ? 'auto-on' : 'auto-off'
  if (c === 'encerrar' || c === 'limpar') return { acao: 'encerrar' }
  const ids = resto.map(Number).filter(n => Number.isInteger(n) && n > 0)
  if ((c === 'feito' || c === 'concluir') && ids.length) return { acao: 'concluir', ids }
  if (c === 'reabrir' && ids.length) return { acao: 'reabrir', ids }
  if (ehNivel(c) && ids.length) return { acao: 'priorizar', ids, nivel: c }
  if (c === 'meu' || c === 'minha') return { acao: 'adicionar', itens: [{ texto: resto.join(' '), dono: 'operador' }] }
  if (c === 'add' || c === 'adicionar') return { acao: 'adicionar', itens: [{ texto: resto.join(' '), dono: 'claude' }] }
  // Qualquer outro texto define um objetivo novo; "::" separa o passo que conclui.
  const [titulo, conclusao] = t.split('::').map(s => s.trim())
  return { acao: 'definir', titulo, conclusao }
}

// Pedir licença para o que já foi aprovado: o ciclo para à toa e o operador precisa voltar só para dizer "sim"
// (16/10: "Sigo com R9 e R10?" com os dois no roadmap em agora; a memória não bastou, a regra virou código).
const LICENCA =
  /(\b(sigo|prossigo|continuo|come[çc]o|posso (seguir|continuar|come[çc]ar|prosseguir)|devo (seguir|continuar|prosseguir|come[çc]ar)|quer que eu|deseja que eu|prefere que eu)\b[^?]*\?$)|(\b(sigo|prossigo|continuo)\b.*\bno pr[óo]ximo turno\b[^?]*\.?$)/i

/** A última frase da resposta, quando ela pede licença para seguir; nada quando a resposta termina de outro jeito. */
export function pedeLicenca(texto: string): string | undefined {
  const paragrafo = texto.trim().split(/\n\s*\n/).pop()?.trim() ?? ''
  const frase = paragrafo.split(/(?<=[.!?])\s+(?=\S)/).pop()?.trim() ?? ''
  return frase && LICENCA.test(frase) ? frase : undefined
}

/**
 * O motivo para não deixar o turno acabar: a resposta pede licença e há trabalho do Claude já aprovado (pendência
 * aberta dele no objetivo; sem nenhuma, o roadmap em agora). Nada aprovado, a pergunta é legítima.
 */
export function bloqueioDeLicenca(texto: string, g: Goal | null, roadmap: ItemRoadmap[]): string | undefined {
  const frase = pedeLicenca(texto)
  if (!frase) return undefined
  const minha = g ? ordenar(g.itens.filter(i => !i.feito && i.dono === 'claude'))[0] : undefined
  const agora = roadmap.filter(i => i.estado === 'aberto' && i.horizonte === 'agora')
  const aprovado = minha ? `#${minha.id} ${minha.texto}` : agora.length ? agora.map(i => `R${i.n} ${i.texto}`).join('; ') : undefined
  if (!aprovado) return undefined
  return (
    `[objetivo] Você terminou pedindo licença ("${frase}") para trabalho já aprovado: ${curto(aprovado)}. ` +
    'Não peça: siga agora (no roadmap, promova e defina o objetivo neste turno). ' +
    'Se houver uma decisão genuína do operador, pergunte pela ferramenta AskUserQuestion, não em texto no fim da resposta.'
  )
}
