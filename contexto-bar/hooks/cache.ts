// Taxa de acerto do cache de prompt da sessão, medida pelo próprio mod: a prova de que o fluxo se paga.
// Fonte: o transcript (semente, uma vez por sessão) e o uso de cada turno da conversa principal (depois).

import type { Cache } from '../types'

export type { Cache }
export type Uso = { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }

export const CACHE_VAZIO: Cache = { lidos: 0, total: 0, n: 0 }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

/** Soma o uso de uma resposta (ou de um turno inteiro, que já vem somado). */
export function somar(acc: Cache, u: Uso | null | undefined): Cache {
  if (!u) return acc
  const lidos = num(u.cache_read_input_tokens)
  const total = num(u.input_tokens) + lidos + num(u.cache_creation_input_tokens)
  if (total <= 0) return acc
  return { ...acc, lidos: acc.lidos + lidos, total: total + acc.total, n: acc.n + 1 }
}

/**
 * Soma as respostas da conversa principal de um trecho do transcript (JSONL). Ignora subagentes (isSidechain),
 * linhas sem uso e linhas quebradas; um trecho por vez dá o mesmo que o arquivo inteiro.
 */
export function doTranscript(texto: string, acc: Cache = CACHE_VAZIO): Cache {
  for (const linha of texto.split('\n')) {
    if (!linha.trim()) continue
    let d: { type?: string; isSidechain?: boolean; message?: { id?: string; usage?: Uso } }
    try {
      d = JSON.parse(linha)
    } catch {
      continue
    }
    if (d?.type !== 'assistant' || d.isSidechain || !d.message?.usage) continue
    const id = d.message.id
    if (id && id === acc.ultimoId) continue
    acc = { ...somar(acc, d.message.usage), ultimoId: id }
  }
  return acc
}

/** Percentual de acerto (0-100), ou null sem nada medido. */
export function taxa(acc: Cache | null): number | null {
  if (!acc || acc.total <= 0) return null
  return Math.round((acc.lidos / acc.total) * 100)
}

/** Caminho do transcript da sessão: a pasta do projeto com tudo que não é letra ou número trocado por "-". */
export const caminhoTranscript = (home: string, cwd: string, id: string) =>
  `${home}/.claude/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}/${id}.jsonl`
