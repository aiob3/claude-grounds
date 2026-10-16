// Peças puras do painel: medidores, texto que cabe na largura, o estado do agente e os indicadores de outros mods.
import type { AoVivoProva, Atividade, Estado, EstadoHerdr, Indicador, VizinhoHerdr } from '../types'

/** Corta o texto em `max` colunas com reticências; devolve o pedaço que coube e o resto (para o hover). */
export function encurtar(texto: string, max: number): { curto: string; resto: string } {
  const t = texto.replace(/\s+/g, ' ').trim()
  const m = Math.max(2, Math.floor(max))
  if (t.length <= m) return { curto: t, resto: '' }
  return { curto: `${t.slice(0, m - 1)}…`, resto: t.slice(m - 1) }
}

// O vocabulário é o do herdr (idle, working, blocked, done): o mesmo estado vale para esta sessão e,
// quando o painel mostrar outros workspaces, para os agentes deles.
export const ESTADOS: Record<Estado, { rotulo: string; cor: string; glifo: string }> = {
  ocioso: { rotulo: 'ocioso', cor: 'subtle', glifo: '○' },
  trabalhando: { rotulo: 'trabalhando', cor: 'claude', glifo: '●' },
  bloqueado: { rotulo: 'esperando você', cor: 'warning', glifo: '◆' },
  concluido: { rotulo: 'concluído', cor: 'success', glifo: '✔' },
}

export function textoAtividade(a: Atividade | null): string {
  if (!a) return ESTADOS.ocioso.rotulo
  const base = ESTADOS[a.estado].rotulo
  return a.estado === 'trabalhando' && a.ferramenta ? `${base} · ${nomeFerramenta(a.ferramenta)}` : base
}

/** Centraliza o texto em `largura` colunas, cortando com reticências quando não cabe. */
export function centralizar(texto: string, largura: number): string {
  const t = texto.length > largura ? `${texto.slice(0, largura - 1)}…` : texto
  const esq = Math.floor((largura - t.length) / 2)
  return ' '.repeat(esq) + t + ' '.repeat(largura - t.length - esq)
}

/** `claude-opus-5-5` vira `Opus 5.5`; `claude-haiku-4-5-20251001`, `Haiku 4.5`; alias e outros nomes ficam como vieram. */
export function nomeModelo(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[.*\])?$/.exec(id)
  if (!m) return id
  return `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

/** `mcp__servidor__ferramenta` vira `servidor·ferramenta`; o resto fica como veio. */
export function nomeFerramenta(t: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(t)
  return m ? `${m[1]}·${m[2]}` : t
}

// Indicadores: o contrato entre mods. Cada mod que tem um número a mostrar escreve
// ~/.claude/indicadores/<fonte>.json = { versao: 1, fonte, itens: Indicador[] }, e o painel os lê.
// Arquivo e não $.state: vale entre sessões e workspaces, e nenhum mod depende de outro estar instalado.
export const VERSAO_INDICADORES = 1
const ESTADOS_INDICADOR = ['ok', 'atencao', 'alerta'] as const

/** Os indicadores válidos de um arquivo; o que não segue o contrato fica de fora, sem derrubar o resto. */
export function validarIndicadores(json: unknown): Indicador[] {
  if (!json || typeof json !== 'object') return []
  const j = json as { versao?: unknown; fonte?: unknown; itens?: unknown }
  if (j.versao !== VERSAO_INDICADORES || typeof j.fonte !== 'string' || !Array.isArray(j.itens)) return []
  const fonte = j.fonte
  const r: Indicador[] = []
  for (const x of j.itens as unknown[]) {
    if (!x || typeof x !== 'object') continue
    const i = x as Record<string, unknown>
    if (typeof i.id !== 'string' || !i.id || typeof i.rotulo !== 'string' || !i.rotulo) continue
    if (typeof i.valor !== 'number' || !Number.isFinite(i.valor)) continue
    r.push({
      fonte,
      id: i.id,
      rotulo: i.rotulo,
      valor: i.valor,
      ...(typeof i.meta === 'number' && Number.isFinite(i.meta) && i.meta > 0 ? { meta: i.meta } : {}),
      ...(typeof i.unidade === 'string' ? { unidade: i.unidade } : {}),
      ...(ESTADOS_INDICADOR.includes(i.estado as never) ? { estado: i.estado as Indicador['estado'] } : {}),
      ...(typeof i.detalhe === 'string' ? { detalhe: i.detalhe } : {}),
      ...(typeof i.texto === 'string' && i.texto.trim() ? { texto: i.texto.trim() } : {}),
    })
  }
  return r
}

export const COR_INDICADOR = { ok: 'success', atencao: 'warning', alerta: 'error' } as const

/** O centro do gauge de um indicador: o texto que a fonte mandou; sem ele, valor/meta, ou o valor. */
export function centroIndicador(i: Indicador): string {
  return i.texto ?? (i.meta !== undefined ? `${i.valor}/${i.meta}` : `${i.valor}`)
}

// Vizinhos: os outros workspaces do herdr, escritos pelo mod herdr-vizinhos em
// ~/.claude/herdr/vizinhos/<HERDR_PANE_ID, encodeURIComponent>.json = { versao: 1, fonte: 'herdr', em, workspace, vizinhos }.
// Sem o mod ou fora do herdr o arquivo não existe e o painel não muda: o contexto-bar não depende dele.
export const VERSAO_VIZINHOS = 1
const HERDR: Record<EstadoHerdr, Estado> = { idle: 'ocioso', working: 'trabalhando', blocked: 'bloqueado', done: 'concluido', unknown: 'ocioso' }
const ehEstadoHerdr = (x: unknown): x is EstadoHerdr => typeof x === 'string' && x in HERDR

/** O estado do herdr no vocabulário do painel (o desconhecido conta como ocioso). */
export const estadoDoHerdr = (e: EstadoHerdr): Estado => HERDR[e]

/** Os vizinhos válidos de um arquivo; o que não segue o contrato fica de fora. */
export function validarVizinhos(json: unknown): VizinhoHerdr[] {
  const j = json as { versao?: unknown; fonte?: unknown; vizinhos?: unknown } | null
  if (!j || typeof j !== 'object' || j.versao !== VERSAO_VIZINHOS || j.fonte !== 'herdr' || !Array.isArray(j.vizinhos)) return []
  const r: VizinhoHerdr[] = []
  for (const v of j.vizinhos as Record<string, unknown>[]) {
    if (!v || typeof v !== 'object' || typeof v.workspace !== 'string' || !v.workspace) continue
    const agentes = (Array.isArray(v.agentes) ? (v.agentes as Record<string, unknown>[]) : [])
      .filter(a => a && typeof a === 'object' && typeof a.pane === 'string' && a.pane)
      .map(a => ({ pane: a.pane as string, estado: ehEstadoHerdr(a.estado) ? a.estado : ('unknown' as const), titulo: typeof a.titulo === 'string' ? a.titulo : '' }))
    r.push({
      workspace: v.workspace,
      rotulo: typeof v.rotulo === 'string' && v.rotulo.trim() ? v.rotulo.trim() : v.workspace,
      estado: ehEstadoHerdr(v.estado) ? v.estado : 'unknown',
      agentes,
    })
  }
  return r
}

/** A linha da faixa: só os vizinhos que esperam o operador ou terminaram; nada quando todos seguem. */
export function faixaVizinhos(vs: VizinhoHerdr[]): string {
  return vs
    .filter(v => v.estado === 'blocked' || v.estado === 'done')
    .map(v => (v.estado === 'blocked' ? `${ESTADOS.bloqueado.glifo} ${v.rotulo} esperando você` : `${ESTADOS.concluido.glifo} ${v.rotulo} terminou`))
    .join(' · ')
}

// Ao vivo: a rodada do executar, escrita pelo prova-de-teste em ~/.claude/prova-de-teste/ao-vivo/<id da sessão>.json
// = { versao: 1, fonte: 'prova-de-teste', tarefa, fase, total, feitos, mortos, sobreviventes, naoAplicados, inicio, agora, copias?, estado? }.
const FASES = ['base', 'mutantes', 'fim'] as const
const numero = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0

/** A rodada válida do arquivo ao vivo; o que não segue o contrato é nada. */
export function validarAoVivo(json: unknown): AoVivoProva | null {
  const j = json as Record<string, unknown> | null
  if (!j || typeof j !== 'object' || j.versao !== 1 || j.fonte !== 'prova-de-teste') return null
  if (typeof j.tarefa !== 'string' || !FASES.includes(j.fase as never)) return null
  const campos = ['total', 'feitos', 'mortos', 'sobreviventes', 'naoAplicados', 'inicio', 'agora'] as const
  if (!campos.every(k => numero(j[k]))) return null
  return {
    tarefa: j.tarefa,
    fase: j.fase as AoVivoProva['fase'],
    ...(Object.fromEntries(campos.map(k => [k, j[k] as number])) as Pick<AoVivoProva, (typeof campos)[number]>),
    ...(numero(j.copias) ? { copias: j.copias as number } : {}),
    ...(typeof j.estado === 'string' && j.estado ? { estado: j.estado } : {}),
  }
}

/** A linha da rodada: a fase, a barra dos mutantes feitos, mortos e sobreviventes, o tempo e o estado no fim. */
export function linhaAoVivo(v: AoVivoProva, largura: number): string {
  const s = Math.max(0, Math.round((v.agora - v.inicio) / 1000))
  const tempo = `${s} s`
  if (v.fase === 'base') return `linha de base · ${v.total} mutantes na fila · ${tempo}`
  const contas = `${v.mortos} mortos · ${v.sobreviventes} sobreviventes`
  if (v.fase === 'fim') return `${v.estado ?? 'fim'} · ${contas}${v.naoAplicados ? ` · ${v.naoAplicados} não aplicados` : ''} · ${tempo}`
  const texto = ` ${v.feitos}/${v.total} · ${contas}${v.copias && v.copias > 1 ? ` · ${v.copias} cópias` : ''} · ${tempo}`
  const barra = Math.max(4, Math.min(20, largura - texto.length - 2))
  const cheio = v.total ? Math.round((v.feitos / v.total) * barra) : 0
  return `[${'■'.repeat(cheio)}${'·'.repeat(barra - cheio)}]${texto}`
}
