// O roadmap: o que está planejado além do objetivo em curso. O objetivo é o ciclo de agora e morre no encerrar;
// o roadmap guarda o plano aprovado entre um objetivo e outro, para que nada que o operador aprovou fique só numa
// conversa (o plano do herdr de 15/10 ficou numa linha de melhoria e sumiu do ciclo). Horizonte pelo compromisso:
// agora (entra no próximo objetivo), próximo (o que vem depois dele), depois (quer chegar lá, sem data).
// Frente agrupa o que é de um mesmo assunto (herdr, painel, prova).
//
// Contrato (versão 1): ~/.claude/roadmap/<raiz do projeto, encodeURIComponent>.jsonl, uma linha JSON por evento,
// só acréscimo, como o caderno. Eventos: `item` (entra), `mover` (muda de horizonte), `promover` (vira a pendência
// #n do objetivo), `descartar` (sai, com o motivo). O número R1, R2... é a ordem em que o item entrou no arquivo,
// estável porque nada é reescrito. Quem lê ignora o que não conhece.

import type { EventoRoadmap, Horizonte, ItemRoadmap, Owner } from '../types'

export const VERSAO_ROADMAP = 1

export const HORIZONTES: { h: Horizonte; rotulo: string }[] = [
  { h: 'agora', rotulo: 'agora' },
  { h: 'proximo', rotulo: 'próximo' },
  { h: 'depois', rotulo: 'depois' },
]
const NOMES = HORIZONTES.map(x => x.h)
export const ehHorizonte = (h: unknown): h is Horizonte => NOMES.includes(h as Horizonte)

export const linha = (ev: EventoRoadmap) => `${JSON.stringify(ev)}\n`

export function novoItem(texto: string, horizonte: Horizonte, em: string, sufixo: string, autor: Owner, frente?: string, de?: string): EventoRoadmap | null {
  const t = texto.replace(/\s+/g, ' ').trim()
  if (!t) return null
  const f = frente?.trim()
  return {
    v: VERSAO_ROADMAP,
    ev: 'item',
    id: `r-${em.replace(/\D/g, '').slice(0, 14)}-${sufixo}`,
    em,
    autor,
    texto: t,
    horizonte,
    ...(f ? { frente: f } : {}),
    ...(de ? { de } : {}),
  }
}

/** Os itens do arquivo na ordem de entrada, com o estado depois de todos os eventos. Tolerante a lixo. */
export function lerRoadmap(texto: string): ItemRoadmap[] {
  const itens = new Map<string, ItemRoadmap>()
  for (const bruta of texto.split('\n')) {
    if (!bruta.trim()) continue
    let o: Record<string, unknown>
    try {
      o = JSON.parse(bruta)
    } catch {
      continue
    }
    if (!o || typeof o !== 'object' || typeof o.v !== 'number' || o.v < 1 || typeof o.id !== 'string' || !o.id) continue
    if (o.ev === 'item') {
      if (typeof o.texto !== 'string' || !o.texto.trim() || itens.has(o.id)) continue
      itens.set(o.id, {
        n: itens.size + 1,
        id: o.id,
        texto: o.texto,
        // Horizonte desconhecido (de uma versão nova) vale depois: fica no plano sem cobrar agora.
        horizonte: ehHorizonte(o.horizonte) ? o.horizonte : 'depois',
        ...(typeof o.frente === 'string' && o.frente ? { frente: o.frente } : {}),
        ...(typeof o.de === 'string' && o.de ? { de: o.de } : {}),
        estado: 'aberto',
      })
      continue
    }
    const it = itens.get(o.id)
    if (!it || it.estado !== 'aberto') continue
    if (o.ev === 'mover' && ehHorizonte(o.horizonte)) it.horizonte = o.horizonte
    else if (o.ev === 'promover' && Number.isInteger(o.pendencia)) {
      it.estado = 'promovido'
      it.pendencia = o.pendencia as number
    } else if (o.ev === 'descartar' && typeof o.motivo === 'string' && o.motivo.trim()) {
      it.estado = 'descartado'
      it.motivo = o.motivo
    }
  }
  return [...itens.values()]
}

export const abertos = (itens: ItemRoadmap[]) => itens.filter(i => i.estado === 'aberto')
export const doHorizonte = (itens: ItemRoadmap[], h: Horizonte) => abertos(itens).filter(i => i.horizonte === h)
const rotulo = (h: Horizonte) => HORIZONTES.find(x => x.h === h)!.rotulo
const comFrente = (i: ItemRoadmap) => `${i.frente ? `[${i.frente}] ` : ''}${i.texto}`

/** Resposta da ferramenta: os abertos por horizonte, e o que já saiu, numa linha. */
export function resumoRoadmap(itens: ItemRoadmap[]): string {
  const abertosHoje = abertos(itens)
  if (!itens.length) return 'Roadmap vazio.'
  const blocos = HORIZONTES.map(({ h }) => {
    const doH = abertosHoje.filter(i => i.horizonte === h)
    return doH.length ? [`${rotulo(h)}:`, ...doH.map(i => `  R${i.n} ${comFrente(i)}${i.de ? ` (de ${i.de})` : ''}`)].join('\n') : ''
  }).filter(Boolean)
  const promovidos = itens.filter(i => i.estado === 'promovido')
  const descartados = itens.filter(i => i.estado === 'descartado')
  const saidos = [
    promovidos.length ? `promovidos: ${promovidos.map(i => `R${i.n}→#${i.pendencia}`).join(', ')}` : '',
    descartados.length ? `descartados: ${descartados.map(i => `R${i.n}`).join(', ')}` : '',
  ].filter(Boolean)
  return [`Roadmap · ${abertosHoje.length} abertos`, ...blocos, ...(saidos.length ? [saidos.join(' · ')] : [])].join('\n')
}

/**
 * Sufixo da linha de cada pedido, só quando não há o que fazer no objetivo (nenhum ativo ou tudo feito): o que o
 * roadmap tem em agora, para o próximo objetivo sair do plano e não do zero.
 */
export function lembreteRoadmap(itens: ItemRoadmap[], semPendencia: boolean): string {
  if (!semPendencia) return ''
  const agora = doHorizonte(itens, 'agora')
  if (!agora.length) return ''
  return ` · roadmap em agora: ${agora.map(i => `R${i.n}`).join(', ')} (promova com a ferramenta roadmap, acao "promover")`
}

/** De onde vem o horizonte num destino de triagem: `roadmap`, `roadmap:agora`, `roadmap proximo`... */
export function destinoRoadmap(destino: string | undefined): Horizonte | null {
  const m = /^\s*roadmap\b[\s:/-]*(\S+)?/i.exec(destino ?? '')
  if (!m) return null
  const h = (m[1] ?? '').toLowerCase().replace('próximo', 'proximo')
  return ehHorizonte(h) ? h : 'depois'
}
