import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Atividade, Decisao, Executores, Goal, GoalItem, GroupKey, Indicador, Nota, Segment, Snapshot, TipoNota } from '../types'
import { alinhamento, aoCarregar, aplicar, aposCompactar, avisoJanela, comando, etiqueta, linhaContexto, notaPublicacao, ordenar, projetar, proxima, resumo, usado } from './objetivo'
import type { Acao } from './objetivo'
import { CACHE_VAZIO, caminhoTranscript, doTranscript, somar, taxa } from './cache'
import { alertas, avisoAoModelo, caminhoSaida, concluirTarefa, FERRAMENTAS_DE_VOLTA, fimDeTurno, linhasDoPainel, notificacao, registrarTarefa, SP_VAZIO } from './segundo-plano'
import type { SegundoPlano } from './segundo-plano'
import { DECISOES, entrega, GLIFO_DECISAO, idade, lembrete, paraLembrar, lerCaderno, linha as linhaCaderno, novaNota, pendenciaDoCaderno, PROPOSITO, semResposta, TIPOS, triagem } from './caderno'
import { centralizar, centroIndicador, COR_INDICADOR, encurtar, ESTADOS, nomeModelo, textoAtividade, validarIndicadores } from './painel'
import { estiloDoTerminal, gauge, LARGURA_GAUGE, LINHAS_GAUGE, pedacos } from './gauge'
import type { EstiloGauge } from './gauge'

const snapshot = atom({ plugin: 'contexto-bar', key: 'snapshot' } as const, null)
const objetivo = atom({ plugin: 'contexto-bar', key: 'objetivo' } as const, null)
const turno = atom({ plugin: 'contexto-bar', key: 'turno' } as const, 0)
const cache = atom({ plugin: 'contexto-bar', key: 'cache' } as const, null)
const pedido = atom({ plugin: 'contexto-bar', key: 'pedido' } as const, null)
const segundoPlano = atom({ plugin: 'contexto-bar', key: 'segundoPlano' } as const, null)
const atividade = atom({ plugin: 'contexto-bar', key: 'atividade' } as const, null)
const verFeitas = atom({ plugin: 'contexto-bar', key: 'verFeitas' } as const, false)
const indicadores = atom({ plugin: 'contexto-bar', key: 'indicadores' } as const, [])
const autoEspelho = atom({ plugin: 'contexto-bar', key: 'painelAuto' } as const, null)
const caderno = atom({ plugin: 'contexto-bar', key: 'caderno' } as const, [])
const entregues = atom({ plugin: 'contexto-bar', key: 'entregues' } as const, [])
const tipoNota = atom({ plugin: 'contexto-bar', key: 'tipoNota' } as const, 'nota')
const envios = atom({ plugin: 'contexto-bar', key: 'envios' } as const, 0)
const executores = atom({ plugin: 'contexto-bar', key: 'executores' } as const, { subagentes: [] })
const rascunho = atom({ plugin: 'contexto-bar', key: 'rascunho' } as const, '')
const passos = atom({ plugin: 'contexto-bar', key: 'passos' } as const, 0)
const ultimaEntrega = atom({ plugin: 'contexto-bar', key: 'ultimaEntrega' } as const, {})

export const TOOL_NAME = 'objetivo'
export const TOOL = `mcp__contexto-bar__${TOOL_NAME}`
const PANE = 'objetivo'

const TOOL_SPEC = {
  name: TOOL_NAME,
  description:
    'Objetivo da tarefa em curso, compartilhado com o operador numa barra acima do prompt. Use ao começar um pedido com etapas ' +
    '(definir: titulo, conclusao = o passo que encerra, itens com dono claude|operador, tamanho P|M|G e nivel ' +
    'bloqueante|requisito|melhoria), ao concluir cada pendência (concluir: ids), para repriorizar (priorizar: ids + nivel), ' +
    'acrescentar (adicionar), reabrir, encerrar ou ver. Bloqueante trava outra pendência ou a entrega; requisito é preciso ' +
    'para a entrega; melhoria pode esperar. A resposta traz a fila na ordem e a projeção de janela. ' +
    'Notas do caderno do operador chegam com o resultado de outras ferramentas: responda a cada uma com triar ' +
    '(nota, decisao, motivo, destino, contraponto).',
  isDeferred: false,
  inputSchema: {
    type: 'object',
    properties: {
      acao: { type: 'string', enum: ['definir', 'adicionar', 'concluir', 'reabrir', 'priorizar', 'encerrar', 'ver', 'triar'] },
      titulo: { type: 'string' },
      conclusao: { type: 'string', description: 'O passo que, feito, encerra o objetivo.' },
      itens: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            texto: { type: 'string' },
            dono: { type: 'string', enum: ['claude', 'operador'] },
            tamanho: { type: 'string', enum: ['P', 'M', 'G'] },
            nivel: { type: 'string', enum: ['bloqueante', 'requisito', 'melhoria'] },
          },
          required: ['texto'],
        },
      },
      ids: { type: 'array', items: { type: 'integer' } },
      nivel: { type: 'string', enum: ['bloqueante', 'requisito', 'melhoria'], description: 'Para priorizar.' },
      nota: { type: 'string', description: 'Para triar: o id da nota do caderno (n-...).' },
      decisao: { type: 'string', enum: ['aceita', 'recusada', 'muda-plano', 'registrada'], description: 'Para triar.' },
      motivo: { type: 'string', description: 'Para triar: o porquê, em uma frase.' },
      destino: { type: 'string', description: 'Para triar: para onde a nota foi (#id da pendência, roadmap).' },
      contraponto: { type: 'string', description: 'Para triar: o melhor argumento contra a sua decisão, em uma frase.' },
    },
    required: ['acao'],
  },
} as const

// Ordem na barra e na legenda; cada grupo tem uma cor fixa.
export const GROUPS: { key: GroupKey; label: string; color: string; char: string }[] = [
  { key: 'sistema', label: 'Sistema Claude Code', color: '#3b82f6', char: '█' }, // azul
  { key: 'claudemd', label: 'CLAUDE.md + memória', color: '#eab308', char: '█' }, // amarelo
  { key: 'mcp', label: 'MCP', color: '#a855f7', char: '█' }, // roxo
  { key: 'skills', label: 'Skills', color: '#22c55e', char: '█' }, // verde
  { key: 'hooks', label: 'Hooks', color: '#ef4444', char: '█' }, // vermelho
  { key: 'conversa', label: 'Conversa', color: '#06b6d4', char: '█' }, // ciano
  { key: 'livre', label: 'Livre', color: '#6b7280', char: '░' }, // cinza
  { key: 'reserva', label: 'Reserva (compacta aqui)', color: '#f97316', char: '▒' }, // laranja
]

/** Classifica uma linha do /context num grupo da barra. */
export function groupOf(name: string, kind: string): GroupKey | null {
  if (kind === 'deferred') return null
  if (kind === 'free') return 'livre'
  if (kind === 'buffer') return 'reserva'
  const n = name.toLowerCase()
  if (n.includes('mcp')) return 'mcp'
  if (n.includes('skill')) return 'skills'
  if (n.includes('memory')) return 'claudemd'
  if (n.includes('message')) return 'conversa'
  return 'sistema'
}

export function buildSnapshot(
  categories: readonly { name: string; tokens: number; kind: string }[],
  hookTokens: number,
): Snapshot {
  const sums: Record<GroupKey, number> = {
    sistema: 0, claudemd: 0, mcp: 0, skills: 0, hooks: 0, conversa: 0, livre: 0, reserva: 0,
  }
  for (const c of categories) {
    const g = groupOf(c.name, c.kind)
    if (g) sums[g] += c.tokens
  }
  // O texto dos hooks chega dentro das mensagens: tira de lá para não contar duas vezes.
  const hooks = Math.min(hookTokens, sums.conversa)
  sums.hooks = hooks
  sums.conversa -= hooks

  const segments: Segment[] = GROUPS.map(g => ({ key: g.key, tokens: sums[g.key] }))
  const total = segments.reduce((a, s) => a + s.tokens, 0)
  const used = total - sums.livre - sums.reserva
  return { percent: total > 0 ? Math.round((used / total) * 100) : 0, total, segments }
}

/** Quantas células cada segmento ocupa numa barra de `width` células. */
export function cellsFor(snap: Snapshot, width: number): number[] {
  const cells = snap.segments.map(s => {
    if (s.tokens <= 0 || snap.total <= 0) return 0
    return Math.max(1, Math.round((s.tokens / snap.total) * width))
  })
  // Ajusta o arredondamento no espaço livre (ou no maior segmento, se não houver livre).
  const diff = width - cells.reduce((a, b) => a + b, 0)
  const freeIdx = snap.segments.findIndex(s => s.key === 'livre')
  const fixIdx = (cells[freeIdx] ?? 0) > 0 ? freeIdx : cells.indexOf(Math.max(...cells))
  cells[fixIdx] = Math.max(0, (cells[fixIdx] ?? 0) + diff)
  return cells
}

export function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

// Lê o detalhamento do /context (estimativa local, sem custo) e guarda para a barra.
async function refresh($: EngineInterface, hookTexts: Set<string>) {
  await lerIndicadores($).catch(() => undefined)
  await lerDoCaderno($).catch(() => undefined)
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    // O tamanho do último pedido vem pronto: entrada sem cache, lida e gravada no cache, somadas.
    if (usage.context.tokens) await update($, pedido, () => usage.context.tokens ?? null)
    const b = usage.context.breakdown
    if (!b) return
    let hookChars = 0
    for (const t of hookTexts) hookChars += t.length
    const snap = buildSnapshot(b.categories, Math.round(hookChars / 4))
    await update($, snapshot, () => snap)
  } catch {
    // Sem sessão ligada ainda: tenta de novo no próximo turno.
  }
}

/** Lê ~/.claude/indicadores/*.json (o contrato em painel.ts) e guarda só o que mudou. */
async function lerIndicadores($: EngineInterface): Promise<void> {
  const home = await $.env.get('HOME')
  if (!home) return
  const pasta = `${home}/.claude/indicadores`
  const lidos: Indicador[] = []
  if (await $.fs.exists(pasta)) {
    const nomes = (await $.fs.list(pasta)).filter(f => f.kind === 'file' && f.name.endsWith('.json')).map(f => f.name).sort()
    for (const nome of nomes) {
      try {
        lidos.push(...validarIndicadores(JSON.parse(await $.fs.read(`${pasta}/${nome}`))))
      } catch {
        // Um arquivo quebrado não apaga os outros.
      }
    }
  }
  const atual = await read($, indicadores)
  if (JSON.stringify(atual) !== JSON.stringify(lidos)) await update($, indicadores, () => lidos)
}

// O caderno: ver hooks/caderno.ts (propósito e contrato). Um arquivo por projeto, só acréscimo.
async function arquivoCaderno($: EngineInterface): Promise<string | undefined> {
  const home = await $.env.get('HOME').catch(() => undefined)
  if (!home) return undefined
  await carregarObjetivo($)
  return `${home}/.claude/caderno/${encodeURIComponent(raizCarregada ?? '')}.jsonl`
}

async function lerDoCaderno($: EngineInterface): Promise<void> {
  const arquivo = await arquivoCaderno($)
  const lidas = arquivo && (await $.fs.exists(arquivo)) ? lerCaderno(await $.fs.read(arquivo)) : []
  if (JSON.stringify(await read($, caderno)) !== JSON.stringify(lidas)) await update($, caderno, () => lidas)
}

/** Acrescenta uma linha ao fim do arquivo (O_APPEND do shell: duas sessões escrevendo não se apagam). */
async function acrescentar($: EngineInterface, texto: string): Promise<boolean> {
  const arquivo = await arquivoCaderno($)
  if (!arquivo) return false
  const r = await $.process.run(['sh', '-c', 'mkdir -p "$(dirname "$1")" && cat >> "$1"', '_', arquivo], { stdin: texto }).catch(() => null)
  await lerDoCaderno($).catch(() => undefined)
  return r?.exitCode === 0
}

async function escreverNota($: EngineInterface, texto: string): Promise<void> {
  const em = new Date(await $.clock.now().catch(() => Date.now())).toISOString()
  const g = await read($, objetivo)
  const prox = g ? proxima(g) : undefined
  const n = novaNota(texto, await read($, tipoNota), em, Math.random().toString(36).slice(2, 6), prox ? `#${prox.id}` : undefined)
  if (!n) return
  if (await acrescentar($, linhaCaderno(n))) {
    await update($, envios, k => k + 1)
    await update($, rascunho, () => '')
  }
}

async function triar($: EngineInterface, a: { nota?: string; decisao?: string; motivo?: string; destino?: string; contraponto?: string }): Promise<string> {
  await lerDoCaderno($)
  const notas = await read($, caderno)
  const n = notas.find(x => x.id === a.nota)
  if (!n) return `Erro: nota ${a.nota ?? '(sem id)'} não está no caderno. Abertas: ${semResposta(notas).map(x => x.id).join(', ') || 'nenhuma'}.`
  if (!DECISOES.includes(a.decisao as Decisao)) return `Erro: decisao é uma de ${DECISOES.join(', ')}.`
  if (!a.motivo?.trim()) return 'Erro: diga o motivo em uma frase; ele aparece para o operador.'
  const em = new Date(await $.clock.now().catch(() => Date.now())).toISOString()
  if (!(await acrescentar($, linhaCaderno(triagem(n.id, a.decisao as Decisao, a.motivo, em, a.destino, a.contraponto))))) return 'Erro: não consegui gravar no caderno.'
  const resta = semResposta(await read($, caderno)).length
  return `Triagem gravada: ${n.id} ${a.decisao}${a.destino ? ` → ${a.destino}` : ''}. ${resta ? `Ainda sem resposta: ${resta}.` : 'Nenhuma nota sem resposta.'}`
}

/**
 * As notas sem resposta que o Claude ainda não recebeu nesta sessão viram texto e passam a contar como entregues; as
 * já entregues que seguem sem resposta há INTERVALO_LEMBRETE passos voltam inteiras, como lembrete.
 */
async function notasParaEntregar($: EngineInterface): Promise<string> {
  await lerDoCaderno($).catch(() => undefined)
  const ja = new Set(await read($, entregues))
  const notas = await read($, caderno)
  const novas = semResposta(notas).filter(n => !ja.has(n.id))
  const passo = await read($, passos)
  const lembrar = paraLembrar(notas, await read($, ultimaEntrega), passo)
  const marcar = [...novas, ...lembrar].map(n => n.id)
  if (!marcar.length) return ''
  if (novas.length) await update($, entregues, l => [...l, ...novas.map(n => n.id)])
  await update($, ultimaEntrega, u => ({ ...u, ...Object.fromEntries(marcar.map(id => [id, passo])) }))
  const agoraMs = await $.clock.now().catch(() => Date.now())
  return [novas.length ? entrega(novas, ja.size === 0, agoraMs) : '', lembrete(lembrar, agoraMs)].filter(Boolean).join(' ')
}

// O desenho dos gauges depende do terminal, que não muda durante a sessão: lido uma vez.
let estiloLido: EstiloGauge | undefined
async function estiloGauge($: EngineInterface): Promise<EstiloGauge> {
  if (estiloLido) return estiloLido
  // Nomes literais: o motor lista as variáveis que um mod lê.
  const forcado = (await $.env.get('CONTEXTO_BAR_GAUGE').catch(() => undefined)) ?? undefined
  const kitty = (await $.env.get('KITTY_WINDOW_ID').catch(() => undefined)) ?? undefined
  const term = (await $.env.get('TERM').catch(() => undefined)) ?? undefined
  const termProgram = (await $.env.get('TERM_PROGRAM').catch(() => undefined)) ?? undefined
  estiloLido = estiloDoTerminal({ forcado, kitty, term, termProgram })
  return estiloLido
}

// Quem executa: o modelo e o effort de cada requisição (turn.step), a conversa principal e cada subagente
// (agent.spawn dá o id, o tipo e a descrição; o fim do turno do subagente o tira).
async function registrarPasso($: EngineInterface, e: { model: string; effort?: string | number; agentId?: string }): Promise<void> {
  const effort = e.effort === undefined ? undefined : String(e.effort)
  await update($, executores, ex => {
    if (!e.agentId) return { ...ex, principal: { modelo: e.model, ...(effort ? { effort } : {}) } }
    return { ...ex, subagentes: ex.subagentes.map(s => (s.id === e.agentId ? { ...s, modelo: e.model, ...(effort ? { effort } : {}) } : s)) }
  })
}

/** Estado do agente para o cartão Agora; nunca derruba o evento observado. */
async function marcar($: EngineInterface, a: Omit<Atividade, 'desde'>): Promise<void> {
  const desde = await $.clock.now().catch(() => Date.now())
  await update($, atividade, cur => (cur && cur.estado === a.estado && cur.ferramenta === a.ferramenta ? cur : { ...a, desde })).catch(() => undefined)
}

// Ferramentas em paralelo viram uma leitura em andamento e, no máximo, mais uma logo depois.
let reading: Promise<void> | null = null
let again = false
async function refreshSoon($: EngineInterface, hookTexts: Set<string>): Promise<void> {
  if (reading) {
    again = true
    return reading
  }
  reading = (async () => {
    do {
      again = false
      await refresh($, hookTexts)
    } while (again)
  })().finally(() => {
    reading = null
  })
  return reading
}

// O objetivo vive no $.state da sessão e é gravado num arquivo por pasta de projeto: fechar a sessão ou
// reiniciar a máquina não o perde, e cada projeto retoma o seu. Não no $.store: ele é um arquivo só para
// todos os projetos, que cada sessão guarda inteiro na memória e regrava inteiro, e duas sessões abertas
// apagavam o objetivo uma da outra. A chave do store fica para migrar o que foi gravado lá.
export const chaveObjetivo = (raiz: string) => `objetivo:${raiz}`
export const arquivoObjetivo = (home: string, raiz: string) => `${home}/.claude/objetivos/${encodeURIComponent(raiz)}.json`
// Pasta cujo objetivo está no $.state agora (some num reload do módulo; aí recarrega do store).
let raizCarregada: string | undefined
// Objetivo (pasta, título e conclusão) cuja conclusão já foi ao modelo: a linha completa sai uma vez por objetivo.
let conclusaoEnviada: string | undefined

async function raizAtual($: EngineInterface): Promise<string> {
  try {
    return await $.session.root()
  } catch {
    try {
      return await $.session.cwd()
    } catch {
      return ''
    }
  }
}

// Gravar é o melhor esforço: sem HOME nem disco, o objetivo vai ao store; sem store, fica só na sessão.
async function caminhoDoObjetivo($: EngineInterface, raiz: string): Promise<string | undefined> {
  const home = await $.env.get('HOME').catch(() => undefined)
  return home ? arquivoObjetivo(home, raiz) : undefined
}

async function lerDoStore($: EngineInterface, raiz: string): Promise<Goal | null> {
  try {
    return ((await $.store.get(chaveObjetivo(raiz))) ?? null) as Goal | null
  } catch {
    return null
  }
}

async function lerSalvo($: EngineInterface, raiz: string): Promise<Goal | null> {
  const arquivo = await caminhoDoObjetivo($, raiz)
  if (!arquivo) return lerDoStore($, raiz)
  try {
    if (await $.fs.exists(arquivo)) {
      // O arquivo existe: vale ele, mesmo dizendo "sem objetivo" (encerrado), e o store não é mais lido.
      const salvo = JSON.parse(await $.fs.read(arquivo)) as { raiz?: string; objetivo?: Goal | null }
      return salvo.raiz === raiz ? (salvo.objetivo ?? null) : null
    }
  } catch {
    return null
  }
  // Ainda sem arquivo: o que estava no store passa para ele e sai do store.
  const antigo = await lerDoStore($, raiz)
  if (antigo && (await escreverArquivo($, arquivo, raiz, antigo))) await $.store.delete(chaveObjetivo(raiz)).catch(() => undefined)
  return antigo
}

async function escreverArquivo($: EngineInterface, arquivo: string, raiz: string, g: Goal | null): Promise<boolean> {
  try {
    const texto = `${JSON.stringify({ raiz, objetivo: g }, null, 2)}\n`
    await $.fs.write(arquivo, texto)
    textoVisto = texto
    return true
  } catch {
    return false
  }
}

// Cache de prompt: o transcript dá a semente uma vez por sessão (ou ao carregar o mod numa sessão em curso);
// depois cada turno da conversa principal soma o seu uso, sem reler o arquivo. Um transcript acima do limite de
// leitura (4 MiB) não semeia: a conta vale desde o carregamento e o painel diz que é parcial.
const LIMITE_LEITURA = 4 * 1024 * 1024
async function semearCache($: EngineInterface): Promise<void> {
  if (await read($, cache)) return
  let semente = { acc: CACHE_VAZIO, parcial: false }
  try {
    const home = await $.env.get('HOME')
    const id = await $.session.id()
    if (home && id) {
      const pastas = [...new Set([await $.session.cwd().catch(() => ''), await raizAtual($)])].filter(Boolean)
      const arquivo = (await Promise.all(pastas.map(async d => ((await $.fs.exists(caminhoTranscript(home, d, id))) ? caminhoTranscript(home, d, id) : '')))).find(Boolean)
      if (arquivo) {
        const st = await $.fs.stat(arquivo)
        semente = st.size > LIMITE_LEITURA ? { acc: CACHE_VAZIO, parcial: true } : { acc: doTranscript(await $.fs.read(arquivo)), parcial: false }
      }
    }
  } catch {
    semente = { acc: CACHE_VAZIO, parcial: true }
  }
  await update($, cache, c => c ?? semente)
}

// Segundo plano: só observa e nunca trava. Um erro aqui fica aqui, sem chegar à chamada observada.
const agora = ($: EngineInterface) => $.clock.now().catch(() => Date.now())
async function mudarSegundoPlano($: EngineInterface, fn: (sp: SegundoPlano) => SegundoPlano): Promise<void> {
  await update($, segundoPlano, sp => fn(sp ?? SP_VAZIO)).catch(() => undefined)
}

/** Relê a hora da última escrita de cada saída em curso (um stat por tarefa, sem ler o arquivo). */
async function olharSaidas($: EngineInterface): Promise<void> {
  const sp = await read($, segundoPlano)
  if (!sp?.tarefas.some(t => t.saida)) return
  const vistos = new Map<string, number>()
  for (const t of sp.tarefas) {
    if (!t.saida) continue
    const st = await $.fs.stat(t.saida).catch(() => undefined)
    if (st) vistos.set(t.id, st.mtimeMs)
  }
  await mudarSegundoPlano($, cur => ({ ...cur, tarefas: cur.tarefas.map(t => (vistos.has(t.id) ? { ...t, mtime: vistos.get(t.id) } : t)) }))
}

/** O que a chamada da conversa principal diz do segundo plano: tarefa nova, volta agendada, tarefa parada. */
async function observarChamada($: EngineInterface, e: { tool: string; [k: string]: unknown }, result: { result?: unknown; text?: string }): Promise<void> {
  const quando = await agora($)
  const r = (result.result ?? {}) as { backgroundTaskId?: string; backgroundEndsWithFinalResponse?: true }
  if (e.tool === 'Bash' && r.backgroundTaskId && !r.backgroundEndsWithFinalResponse) {
    const descricao = String(e.description || e.command || r.backgroundTaskId).trim()
    await mudarSegundoPlano($, sp => registrarTarefa(sp, { id: r.backgroundTaskId!, descricao, saida: caminhoSaida(result.text), inicio: quando }))
  } else if (FERRAMENTAS_DE_VOLTA.includes(e.tool)) {
    await mudarSegundoPlano($, sp => ({ ...sp, voltaEm: quando }))
  } else if (e.tool === 'TaskStop' && (e.task_id ?? e.shell_id) != null) {
    // O id em qualquer forma: um TaskStop legítimo nunca é ignorado pelo tipo (sobrevivente #13 da 0.10.0).
    await mudarSegundoPlano($, sp => concluirTarefa(sp, String(e.task_id ?? e.shell_id)))
  }
}

/** O aviso do segundo plano para a linha do próximo pedido; vazio sem alerta. */
async function avisoSegundoPlano($: EngineInterface): Promise<string> {
  await olharSaidas($).catch(() => undefined)
  const sp = await read($, segundoPlano)
  return sp ? avisoAoModelo(alertas(sp, await agora($))) : ''
}

// Painel automático: com objetivo ativo, cada pedido abre (ou mantém) o painel. Liga por padrão.
const CHAVE_AUTO = 'painel-auto'
async function painelAuto($: EngineInterface): Promise<boolean> {
  const espelho = await read($, autoEspelho).catch(() => null)
  if (espelho !== null) return espelho
  try {
    return (await $.store.get(CHAVE_AUTO)) !== false
  } catch {
    return true
  }
}

async function mudarAuto($: EngineInterface, ligado: boolean): Promise<void> {
  await $.store.set(CHAVE_AUTO, ligado).catch(() => undefined)
  await update($, autoEspelho, () => ligado)
}

async function abrirPainel($: EngineInterface) {
  return $.ui.open({ id: PANE, title: 'Objetivo', closeOnEscape: true, columns: 48 })
}

/** Traz para a sessão o objetivo gravado da pasta atual, se a sessão ainda não o tem. */
async function carregarObjetivo($: EngineInterface): Promise<void> {
  const raiz = await raizAtual($)
  if (raiz === raizCarregada) return
  const primeiraCarga = raizCarregada === undefined
  raizCarregada = raiz
  const r = aoCarregar(primeiraCarga, await lerSalvo($, raiz), await read($, objetivo), usado(await read($, snapshot)), await read($, turno))
  if (r.gravar) await gravarObjetivo($, () => r.goal)
  else await update($, objetivo, () => r.goal)
}

// Duas sessões na mesma pasta dividem o arquivo do objetivo. O arquivo é a fonte da verdade: antes de mudar,
// a sessão relê o que outra gravou e aplica a mudança por cima; depois de cada ferramenta e a cada pedido, relê
// para mostrar o que mudou lá. Sem isso, cada sessão regravava a sua cópia inteira e apagava a outra.
let textoVisto: string | undefined
async function doArquivoAgora($: EngineInterface): Promise<void> {
  const raiz = raizCarregada
  if (raiz === undefined) return
  const arquivo = await caminhoDoObjetivo($, raiz)
  if (!arquivo || !(await $.fs.exists(arquivo).catch(() => false))) return
  const texto = await $.fs.read(arquivo).catch(() => undefined)
  if (texto === undefined || texto === textoVisto) return
  try {
    const salvo = JSON.parse(texto) as { raiz?: string; objetivo?: Goal | null }
    if (salvo.raiz !== raiz) return
    textoVisto = texto
    await update($, objetivo, () => salvo.objetivo ?? null)
  } catch {
    // Arquivo pela metade (outra sessão gravando): fica a cópia da sessão até a próxima leitura.
  }
}

/** Muda o objetivo da sessão e grava o resultado na chave da pasta. */
async function gravarObjetivo($: EngineInterface, fn: (g: Goal | null) => Goal | null): Promise<void> {
  await carregarObjetivo($)
  await doArquivoAgora($).catch(() => undefined)
  await update($, objetivo, fn)
  const g = await read($, objetivo)
  const raiz = raizCarregada ?? ''
  const arquivo = await caminhoDoObjetivo($, raiz)
  if (arquivo && (await escreverArquivo($, arquivo, raiz, g))) return
  const chave = chaveObjetivo(raiz)
  try {
    if (g) await $.store.set(chave, g)
    else await $.store.delete(chave)
  } catch {
    // Sem store: fica só na sessão.
  }
}

/** Aplica uma ação ao objetivo e devolve o resumo (ou o erro). */
async function mudarObjetivo($: EngineInterface, a: Acao, origem: 'claude' | 'operador'): Promise<{ texto: string; erro: boolean }> {
  await carregarObjetivo($)
  await doArquivoAgora($).catch(() => undefined)
  const snap = await read($, snapshot)
  const atual = await read($, objetivo)
  const n = await read($, turno)
  const r = aplicar(atual, a, origem, usado(snap), n)
  if (r.erro) return { texto: `Erro: ${r.erro}\n${resumo(atual, snap)}`, erro: true }
  await gravarObjetivo($, () => r.goal)
  const checagem = r.goal && (a.acao === 'definir' || a.acao === 'adicionar') ? `\n${alinhamento(r.goal)}` : ''
  return { texto: resumo(r.goal, snap) + checagem, erro: false }
}

/** Texto de aviso de janela, quando a projeção piorou desde o último aviso. */
async function checarAviso($: EngineInterface): Promise<string | undefined> {
  const g = await read($, objetivo)
  if (!g) return undefined
  const { nivel, texto } = avisoJanela(g, await read($, snapshot))
  if (nivel !== g.aviso) await gravarObjetivo($, cur => (cur ? { ...cur, aviso: nivel } : cur))
  return texto
}

export const register: Register = on => {
  // Texto injetado por hooks na janela atual, sem repetir o mesmo bloco.
  const hookTexts = new Set<string>()

  on('session.start', async ($, e, next) => {
    await $.tool.register(TOOL_SPEC)
    await $.command.register({
      name: 'objetivo',
      description: 'Objetivo em curso: sem argumento abre o painel; <texto> [:: passo que conclui] define; feito <ids>; bloqueante|requisito|melhoria <ids>; meu <texto>; nota [ideia|agora|depois|referencia] [#id] <texto>; auto on|off; encerrar',
      argumentHint: '[texto :: conclui | feito 1 2 | bloqueante 3 | meu texto | encerrar]',
    })
    const result = await next(e)
    await refresh($, hookTexts)
    await carregarObjetivo($)
    await semearCache($)
    return result
  })

  // A ferramenta do objetivo: o modelo define e atualiza; a resposta é o estado com a projeção.
  on('tool.call', { tool: TOOL as never }, async ($, e) => {
    if ((e as { acao?: string }).acao === 'triar') {
      const r = await triar($, e as never)
      return { result: r } as never
    }
    const r = await mudarObjetivo($, e as unknown as Acao, 'claude')
    return { result: r.texto } as never
  })

  // Cada prompt leva ao modelo uma linha com o objetivo e as pendências (o operador não a vê).
  on('prompt.submit', async ($, e, next) => {
    if (e.command) return next(e)
    await marcar($, { estado: 'trabalhando' })
    // A notificação de fim de uma tarefa limpa o alerta dela.
    const nota = e.origin?.kind === 'task-notification' || e.text.includes('<task-notification>') ? notificacao(e.text) : null
    if (nota) await mudarSegundoPlano($, sp => concluirTarefa(sp, nota.id))
    // Um /cd muda a pasta do projeto: a linha passa a ser a do objetivo dela.
    await carregarObjetivo($)
    await doArquivoAgora($).catch(() => undefined)
    const atual = await read($, objetivo)
    // Pedido do operador: ver o objetivo desde o início da atividade, sem esperar o fim do ciclo.
    if (atual && (await painelAuto($))) await abrirPainel($).catch(() => undefined)
    // A conclusão vai uma vez por objetivo (recém-definido ou início de sessão); depois, só a linha curta.
    const chave = atual ? `${raizCarregada}\n${atual.titulo}\n${atual.conclusao}` : undefined
    const completa = chave !== undefined && chave !== conclusaoEnviada
    if (chave !== undefined) conclusaoEnviada = chave
    const linhas = [linhaContexto(atual, await read($, snapshot), TOOL, completa) + (await avisoSegundoPlano($).catch(() => '')) + pendenciaDoCaderno(await read($, caderno))]
    const doCaderno = await notasParaEntregar($).catch(() => '')
    if (doCaderno) linhas.push(doCaderno)
    const aviso = await checarAviso($)
    if (aviso) linhas.push(aviso)
    return next({ ...e, context: [...(e.context ?? []), ...linhas] })
  })

  on('command.run', { command: 'objetivo' }, async ($, e) => {
    // /objetivo nota [ideia|agora|depois|referencia] [#id] texto: o caderno por comando (superfícies sem campo, atalho).
    const mNota = /^nota\s+([\s\S]+)$/i.exec(e.args.trim())
    if (mNota) {
      const [primeira, ...resto] = mNota[1]!.trim().split(/\s+/)
      const t = TIPOS.find(x => x.tipo === primeira || x.rotulo === primeira)
      if (t) await update($, tipoNota, () => t.tipo)
      const antes = (await read($, caderno)).length
      await escreverNota($, t ? resto.join(' ') : mNota[1]!)
      const gravou = (await read($, caderno)).length > antes
      return { text: gravou ? 'Nota no caderno: o Claude recebe junto do resultado da próxima ferramenta e responde a ela.' : 'Nota vazia ou caderno indisponível: nada gravado.' }
    }
    const c = comando(e.args)
    if (c === 'auto-on' || c === 'auto-off') {
      await mudarAuto($, c === 'auto-on')
      return {
        text:
          c === 'auto-on'
            ? 'Painel do objetivo: abre sozinho a cada pedido enquanto houver objetivo ativo.'
            : 'Painel do objetivo: não abre mais sozinho; use /objetivo para abrir. /objetivo auto on volta.',
      }
    }
    if (c === 'painel') {
      const r = await abrirPainel($)
      return { text: r.isPlaced ? 'Painel do objetivo aberto (Esc fecha).' : resumo(await read($, objetivo), await read($, snapshot)) }
    }
    const r = await mudarObjetivo($, c, 'operador')
    return { text: r.texto }
  })

  on('prompt.attachment', async ($, e, next) => {
    if (e.origin.kind === 'hook' && !e.agentId) hookTexts.add(e.text)
    return next(e)
  })

  // Evento de stream: o hook é um gerador; observa o modelo e o effort e repassa a resposta inteira.
  on('turn.step', async function* ($, e, next) {
    await registrarPasso($, e).catch(() => undefined)
    return yield* next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r?.agentId) {
      const desde = await $.clock.now().catch(() => Date.now())
      const sub = { id: r.agentId, tipo: e.subagentType, descricao: e.description, modelo: r.model, desde }
      await update($, executores, ex => ({ ...ex, subagentes: [...ex.subagentes.filter(s => s.id !== sub.id), sub] })).catch(() => undefined)
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) await update($, executores, ex => ({ ...ex, subagentes: ex.subagentes.filter(s => s.id !== e.agentId) })).catch(() => undefined)
    await update($, turno, n => n + 1)
    if (!e.agentId) await marcar($, { estado: 'concluido' })
    if (!e.agentId) {
      // Sem semente ainda, o transcript já traz este turno: semeia em vez de somar, para não contar duas vezes.
      const uso = result.usage ?? e.usage
      if (!(await read($, cache))) await semearCache($)
      else if (uso) await update($, cache, c => (c ? { ...c, acc: somar(c.acc, uso) } : c))
    }
    if (!e.agentId) {
      const quando = await agora($)
      await mudarSegundoPlano($, sp => fimDeTurno(sp, quando))
    }
    await refresh($, hookTexts)
    return result
  })

  // O Stop clássico diz o que ainda roda e se há crons para acordar a sessão: a fonte certa no fim do turno.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (!e.agent_id) {
      const quando = await agora($)
      await mudarSegundoPlano($, sp => fimDeTurno(sp, quando, e.background_tasks, e.session_crons?.length))
    }
    return result
  })

  // Quase tempo real: relê depois de cada ferramenta da conversa principal (estimativa local, sem custo).
  on('tool.call', async ($, e, next) => {
    if (!e.agentId) await marcar($, { estado: 'trabalhando', ferramenta: e.tool as string })
    if (!e.agentId) await update($, passos, n => n + 1).catch(() => undefined)
    const result = await next(e)
    if (!e.agentId) await marcar($, { estado: 'trabalhando' })
    if (e.agentId || (e.tool as string) === TOOL) return result
    await refreshSoon($, hookTexts)
    await doArquivoAgora($).catch(() => undefined)
    if (result.deny !== undefined || result.isError) return result
    await observarChamada($, e as never, result).catch(() => undefined)
    // No meio do turno: se a projeção piorou, o aviso chega junto do resultado da ferramenta.
    const notas = [await checarAviso($), await notasParaEntregar($).catch(() => '')]
    // Publicar com a verificação aberta: a nota vem com o resultado (o mod não tem como falar antes da chamada).
    if ((e.tool as string) === 'Bash') notas.push(notaPublicacao(await read($, objetivo), String((e as { command?: unknown }).command ?? '')))
    const ctx = notas.filter((n): n is string => !!n)
    return ctx.length ? { ...result, context: [...(result.context ?? []), ...ctx] } : result
  })

  // A compactação descarta o texto que os hooks tinham injetado; a estimativa de Hooks recomeça do zero.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId && e.trigger !== 'precompute' && !result.skip) {
      hookTexts.clear()
      await refresh($, hookTexts)
      const uso = usado(await read($, snapshot))
      await gravarObjetivo($, g => aposCompactar(g, uso))
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    if (e.props.hasSurvey || snap === null) return next(e)
    const goal = await read($, objetivo)
    const agora = await read($, turno)
    const pc = taxa((await read($, cache))?.acc ?? null)

    const { Box, Text } = $.ui.resolve(e)
    const suffix = ` ${snap.percent}%`
    // O acerto do cache vai no fim da linha da barra só se couber sem quebrar; o detalhe fica no painel.
    const cabeCache = pc !== null && e.props.bodyColumns - suffix.length - ` · cache ${pc}%`.length - 2 >= 10
    const extra = cabeCache ? ` · cache ${pc}%` : ''
    const width = Math.max(10, e.props.bodyColumns - suffix.length - extra.length - 2)
    const cells = cellsFor(snap, width)
    const pctColor = snap.percent >= 80 ? 'error' : snap.percent >= 60 ? 'warning' : 'text'

    return (
      <Box flexDirection="column">
        <Text>
          [
          {GROUPS.map((g, i) =>
            (cells[i] ?? 0) > 0 ? (
              <Text key={g.key} color={g.color}>
                {g.char.repeat(cells[i] ?? 0)}
              </Text>
            ) : null,
          )}
          ]
          <Text color={pctColor} weight="bold">
            {suffix}
          </Text>
          {extra ? <Text color="subtle">{extra}</Text> : null}
        </Text>
        <Text wrap="wrap">
          {GROUPS.map((g, i) => (
            <Text key={g.key} color={g.color}>
              {g.char === '█' ? '■' : g.char} {g.label} {fmtTokens(snap.segments[i]?.tokens ?? 0)}
              {'  '}
            </Text>
          ))}
        </Text>
        {goal ? <GoalBand goal={goal} snap={snap} agora={agora} Text={Text} /> : null}
      </Box>
    )
  })

  // O painel, de cima para baixo: medidores, o cartão Agora, a vez do operador com botões, a fila do Claude e as
  // feitas recolhidas. O texto longo de cada pendência aparece inteiro com o ponteiro em cima (hover).
  // Acoplado ao lado da conversa no modo tela cheia; acima do prompt fora dele.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elementos = $.ui.resolve(e)
    const { Box, Text, Button } = elementos
    // O celular não tem campo de texto: lá a nota vai pelo /objetivo nota <texto>.
    const Input = e.surface !== 'mobile' && 'Input' in elementos ? elementos.Input : undefined
    const largura = Math.max(30, (e.props as { bodyColumns?: number }).bodyColumns ?? 48)
    const goal = await read($, objetivo)
    const snap = await read($, snapshot)
    const sp = await read($, segundoPlano)
    const pc = taxa((await read($, cache))?.acc ?? null)
    const inds = await read($, indicadores)
    const ativ = await read($, atividade)
    const feitasAbertas = await read($, verFeitas)
    const auto = await painelAuto($)
    const p = goal ? projetar(goal, snap) : null

    // Gauges em arco, lado a lado (braille no Kitty, Ghostty e foot; caixa nos outros): o número no meio, o rótulo
    // embaixo, o detalhe com o ponteiro em cima. Quebram para a linha de baixo quando o painel é estreito.
    const estilo = e.surface === 'terminal' ? await estiloGauge($) : 'caixa'
    const desenharGauge = (id: string, rotulo: string, frac: number, centro: string, cor: string, detalhe?: string) => (
      <Box key={`g-${id}`} flexDirection="column" width={LARGURA_GAUGE}>
        {gauge(frac, centro, estilo).map((linha, l) => (
          <Text key={`g-${id}-${l}`}>
            {pedacos(linha).map((pd, k) => (
              <Text key={`g-${id}-${l}-${k}`} color={pd.cheio === true ? cor : pd.cheio === false ? 'inactive' : l === LINHAS_GAUGE - 1 ? cor : undefined} weight={pd.cheio === null && l === LINHAS_GAUGE - 1 && pd.texto.trim() ? 'bold' : undefined}>
                {pd.texto}
              </Text>
            ))}
          </Text>
        ))}
        <Text dimColor>{centralizar(rotulo, LARGURA_GAUGE)}</Text>
        {detalhe ? (
          <Box display="none" hover={{ display: 'flex' }}>
            <Text dimColor wrap="wrap">
              {detalhe}
            </Text>
          </Box>
        ) : null}
      </Box>
    )
    const gauges = [
      p && p.total ? desenharGauge('pend', 'pendências', p.feitas / p.total, `${p.feitas}/${p.total}`, 'claude', `Claude ${p.abertasClaude} · você ${p.abertasOperador}`) : null,
      snap
        ? desenharGauge('jan', 'janela', snap.percent / 100, `${snap.percent}%`, snap.percent >= 80 ? 'error' : snap.percent >= 60 ? 'warning' : 'success', p ? `${ESTADO[p.estado]} · precisa ~${fmtTokens(p.necessario)} de ${fmtTokens(p.livre)}` : undefined)
        : null,
      ...inds.map(i =>
        desenharGauge(`${i.fonte}-${i.id}`, i.rotulo, i.meta ? i.valor / i.meta : 0, centroIndicador(i), i.estado ? COR_INDICADOR[i.estado] : 'claude', i.detalhe),
      ),
    ].filter(Boolean)
    const medidores = gauges.length ? (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
        {gauges}
      </Box>
    ) : null

    // Uma pendência numa linha; o resto do texto aparece embaixo com o ponteiro em cima.
    const linhaItem = (i: GoalItem, glifo: string, cor: string | undefined, reserva: number, botao?: RenderChildren) => {
      const prefixo = `${glifo} #${i.id} `
      const { curto, resto } = encurtar(i.texto, largura - prefixo.length - reserva)
      return (
        <Box key={`i-${i.id}`} flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor={i.feito || i.nivel === 'melhoria'}>
              <Text color={cor}>{glifo}</Text> #{i.id} {curto}
            </Text>
            {botao ?? null}
          </Box>
          {resto ? (
            <Box display="none" hover={{ display: 'flex' }} paddingLeft={prefixo.length}>
              <Text dimColor wrap="wrap">
                …{resto}
              </Text>
            </Box>
          ) : null}
        </Box>
      )
    }

    const est = ativ?.estado ?? 'ocioso'
    const ex = await read($, executores)
    const quem = ex.principal ? `${nomeModelo(ex.principal.modelo)}${ex.principal.effort ? ` · effort ${ex.principal.effort}` : ''}` : ''
    const subs = ex.subagentes
    const agoraCard = (
      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text weight="bold">AGORA </Text>
          <Text color={ESTADOS[est].cor}>
            {ESTADOS[est].glifo} {textoAtividade(ativ)}
          </Text>
        </Text>
        {quem || subs.length ? (
          <Box key="quem" flexDirection="column">
            <Text dimColor>
              {quem}
              {subs.length ? `${quem ? ' · ' : ''}${subs.length} ${subs.length === 1 ? 'subagente' : 'subagentes'}` : ''}
            </Text>
            {subs.length ? (
              <Box display="none" hover={{ display: 'flex' }} flexDirection="column" paddingLeft={2}>
                {subs.map(s => (
                  <Text key={`sub-${s.id}`} wrap="wrap">
                    <Text color="claude">●</Text> {s.tipo} <Text dimColor>({nomeModelo(s.modelo)}{s.effort ? `, ${s.effort}` : ''})</Text> {s.descricao}
                  </Text>
                ))}
              </Box>
            ) : null}
          </Box>
        ) : null}
        {goal ? (
          (() => {
            const prox = proxima(goal)
            if (!prox) return <Text color="success">tudo feito: encerrar ou definir o próximo objetivo</Text>
            const cor = prox.nivel === 'bloqueante' ? 'error' : prox.dono === 'operador' ? 'warning' : 'claude'
            return (
              <Box flexDirection="column">
                <Text color={cor} weight="bold" wrap="wrap">
                  ▣ #{prox.id} {prox.texto}
                </Text>
                <Text dimColor>
                  {'  '}
                  {prox.dono === 'operador' ? 'sua vez' : 'Claude'} · {prox.tamanho} · {prox.nivel ?? 'requisito'}
                </Text>
              </Box>
            )
          })()
        ) : null}
      </Box>
    )

    // O caderno: a porta do operador durante a execução (propósito e contrato em caderno.ts).
    const notas = await read($, caderno)
    const tipo = await read($, tipoNota)
    const regra = TIPOS.find(t => t.tipo === tipo) ?? TIPOS[0]!
    const linhaNota = (n: Nota) => {
      const d = GLIFO_DECISAO[n.triagem?.decisao ?? 'aguardando']
      const prefixo = `${d.glifo} ${n.tipo} `
      const { curto } = encurtar(n.texto, largura - prefixo.length)
      return (
        <Box key={`nota-${n.id}`} flexDirection="column">
          <Text>
            <Text color={d.cor}>{d.glifo}</Text>
            <Text dimColor> {n.tipo} </Text>
            {curto}
          </Text>
          <Box display="none" hover={{ display: 'flex' }} paddingLeft={2} flexDirection="column">
            <Text dimColor wrap="wrap">
              {n.texto}
              {n.ref ? ` (sobre ${n.ref})` : ''}
            </Text>
            <Text color={d.cor} wrap="wrap">
              {n.triagem ? `${d.rotulo}: ${n.triagem.motivo}${n.triagem.destino ? ` → ${n.triagem.destino}` : ''}` : 'aguardando a resposta do Claude'}
            </Text>
            {n.triagem?.contraponto ? (
              <Text dimColor wrap="wrap">
                contra: {n.triagem.contraponto}
              </Text>
            ) : null}
          </Box>
        </Box>
      )
    }
    const abertasCaderno = semResposta(notas).length
    const ultimaNota = notas[notas.length - 1]
    const rascunhoAtual = await read($, rascunho)
    const agoraMs = await $.clock.now().catch(() => Date.now())
    const cadernoBloco = (
      <Box flexDirection="column" marginTop={1}>
        <Box key="caderno-titulo" flexDirection="column">
          <Text>
            <Text color="claude" weight="bold">
              CADERNO
            </Text>
            <Text dimColor>{abertasCaderno ? ` · ${abertasCaderno} sem resposta` : ' · o que você pensar durante a execução'}</Text>
          </Text>
          <Box display="none" hover={{ display: 'flex' }}>
            <Text dimColor wrap="wrap">
              {PROPOSITO_OPERADOR}
            </Text>
          </Box>
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="claude" borderDimColor paddingX={1}>
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Text dimColor>tipo</Text>
            {TIPOS.map((t, i) => (
              <Button
                key={`tipo-${t.tipo}`}
                hotkey={String(i + 1)}
                variant={t.tipo === tipo ? 'primary' : 'secondary'}
                label={t.tipo === tipo ? `● ${t.rotulo}` : t.rotulo}
                onPress={() => void update($, tipoNota, () => t.tipo)}
              />
            ))}
          </Box>
          <Text dimColor wrap="wrap">
            {regra.regra}
          </Text>
          {Input ? (
            <Input
              key={`nota-${await read($, envios)}`}
              placeholder="✎ escreva aqui; #id no começo liga a uma pendência"
              submitLabel="enviar ao Claude"
              onInput={(v: string) => void update($, rascunho, () => v)}
              onSubmit={(v: string) => void escreverNota($, v)}
            />
          ) : (
            <Text dimColor>/objetivo nota [tipo] [#id] texto</Text>
          )}
          {/* O campo do motor é de uma linha: o texto longo (digitado ou colado) aparece inteiro aqui. Nota do operador, 15/10. */}
          {rascunhoAtual.trim() ? (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>prévia · {rascunhoAtual.length} caracteres</Text>
              <Text wrap="wrap">{rascunhoAtual}</Text>
            </Box>
          ) : null}
          <Text dimColor wrap="wrap">
            {Input ? 'clique no campo (ou ctrl+x tab) · Enter envia · Esc volta ao prompt' : 'o celular não tem campo: use o comando acima'}
          </Text>
          {ultimaNota ? (
            <Text color={ultimaNota.triagem ? 'success' : 'warning'} wrap="wrap">
              {ultimaNota.triagem ? `✔ última nota respondida: ${GLIFO_DECISAO[ultimaNota.triagem.decisao].rotulo}` : `◌ última nota enviada ${idade(ultimaNota.em, agoraMs)}: chega ao Claude na próxima ferramenta`}
            </Text>
          ) : null}
        </Box>
        {notas
          .slice(-NOTAS_NO_PAINEL)
          .reverse()
          .map(linhaNota)}
      </Box>
    )

    const rodape = (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row">
          <Button key="auto" plain label={`auto ${auto ? 'ligado' : 'desligado'}`} onPress={() => void mudarAuto($, !auto)} />
          {p && p.abertasClaude ? (
            <Text dimColor>
              {' '}
              · ~{fmtTokens(p.unidade)}/un{p.comHistorico ? '' : '*'} · precisa ~{fmtTokens(p.necessario)} de {fmtTokens(p.livre)}
            </Text>
          ) : null}
        </Box>
        <LinhaCache c={await read($, cache)} req={await read($, pedido)} Text={Text} />
        {(sp ? linhasDoPainel(sp, await agora($)) : []).map(l => (
          <Text key={l} color={l.endsWith('em curso') ? 'subtle' : 'warning'} wrap="wrap">
            {l}
          </Text>
        ))}
      </Box>
    )

    if (!goal) {
      return (
        <Box flexDirection="column">
          {medidores}
          {agoraCard}
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Nenhum objetivo ativo.</Text>
            <Text dimColor>/objetivo texto :: passo que conclui</Text>
          </Box>
          {cadernoBloco}
          {rodape}
        </Box>
      )
    }

    const prox = proxima(goal)
    const suaVez = ordenar(goal.itens.filter(i => i.dono === 'operador' && !i.feito))
    const fila = ordenar(goal.itens.filter(i => i.dono === 'claude' && !i.feito && i.id !== prox?.id))
    const feitas = goal.itens.filter(i => i.feito)
    const conc = goal.conclusao ? encurtar(`conclui: ${goal.conclusao}`, largura) : null
    return (
      <Box flexDirection="column">
        <Box key="titulo" flexDirection="column">
          <Text weight="bold" wrap="wrap">
            ◎ {goal.titulo}
          </Text>
          {conc ? <Text dimColor>{conc.curto}</Text> : null}
          {conc?.resto ? (
            <Box display="none" hover={{ display: 'flex' }}>
              <Text dimColor wrap="wrap">
                …{conc.resto}
              </Text>
            </Box>
          ) : null}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {medidores}
        </Box>
        {agoraCard}
        {suaVez.length ? (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              <Text color="warning" weight="bold">
                SUA VEZ
              </Text>
              <Text dimColor> · {suaVez.length}</Text>
            </Text>
            {suaVez.map(i =>
              linhaItem(i, '○', 'warning', BOTAO, <Button key={`feito-${i.id}`} label="Feito" onPress={() => void mudarObjetivo($, { acao: 'concluir', ids: [i.id] } as Acao, 'operador')} />),
            )}
          </Box>
        ) : null}
        {cadernoBloco}
        {fila.length ? (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              <Text weight="bold">FILA DO CLAUDE</Text>
              <Text dimColor> · {fila.length}</Text>
            </Text>
            {fila.map(i => linhaItem(i, i.nivel === 'melhoria' ? '·' : '●', COR_NIVEL[i.nivel ?? 'requisito'], 0))}
          </Box>
        ) : null}
        {feitas.length ? (
          <Box flexDirection="column" marginTop={1}>
            <Button key="feitas" plain label={`✔ ${feitas.length} ${feitas.length === 1 ? 'feita' : 'feitas'} ${feitasAbertas ? '▾' : '▸'}`} onPress={() => void update($, verFeitas, v => !v)} />
            {feitasAbertas ? feitas.map(i => linhaItem(i, '✔', 'success', 0)) : null}
          </Box>
        ) : null}
        {rodape}
      </Box>
    )
  })
}

// O que o operador lê ao passar o ponteiro no título do caderno.
const PROPOSITO_OPERADOR =
  'Para o que você pensar durante a execução, sem interromper: ideias, decisões para agora ou para depois, ' +
  'referências. Não é a fila do ciclo. Chega ao Claude junto do resultado da próxima ferramenta, e ele responde a ' +
  'cada nota: aceita, recusa com motivo, muda o plano ou registra.'
const NOTAS_NO_PAINEL = 4

// Colunas do botão "[ Feito ]" ao lado das pendências do operador.
const BOTAO = 10
const CURTO = { cabe: 'cabe', apertado: 'apertado', 'nao-cabe': 'não cabe', 'sem-dados': 'sem dados' } as const
const COR_NIVEL = { bloqueante: 'error', requisito: 'text', melhoria: 'subtle' } as const

const ESTADO = { cabe: 'cabe na janela', apertado: 'apertado', 'nao-cabe': 'não cabe', 'sem-dados': 'sem dados' } as const
const COR_ESTADO = { cabe: 'success', apertado: 'warning', 'nao-cabe': 'error', 'sem-dados': 'text' } as const

/** Segunda camada da banda: objetivo, progresso, de quem é a vez e a projeção de janela. */
function GoalBand({ goal, snap, agora, Text }: { goal: Goal; snap: Snapshot; agora: number; Text: any }) {
  const p = projetar(goal, snap)
  const parado = agora - goal.atualizadoTurno
  const prox = proxima(goal)
  // A próxima é a própria caixa dela na barra de passos, em destaque: sem texto a mais na banda.
  const corProx = prox?.nivel === 'bloqueante' ? 'error' : prox?.dono === 'operador' ? 'warning' : 'claude'
  return (
    <Text wrap="wrap">
      <Text weight="bold">◎ {goal.titulo}</Text>
      {goal.conclusao ? <Text dimColor> · conclui: {goal.conclusao}</Text> : null}
      {'  '}
      {goal.itens.length ? (
        <Text>
          [
          {goal.itens.map(i =>
            i.id === prox?.id ? (
              <Text key={String(i.id)} color={corProx} weight="bold">
                ▣
              </Text>
            ) : i.feito ? (
              '■'
            ) : (
              '□'
            ),
          )}
          ]{' '}
        </Text>
      ) : null}
      {p.feitas}/{p.total}
      {p.abertasClaude ? ` · Claude ${p.abertasClaude}` : ''}
      {p.abertasOperador ? <Text color="warning"> · sua vez {p.abertasOperador}</Text> : null}
      {p.abertasClaude ? (
        <Text color={COR_ESTADO[p.estado]}>
          {' '}· ~{fmtTokens(p.unidade)}/un{p.comHistorico ? '' : '*'} · {ESTADO[p.estado]}
        </Text>
      ) : null}
      {parado >= 3 ? <Text dimColor> · sem atualização há {parado} turnos</Text> : null}
    </Text>
  )
}

/** No painel: acerto do cache da sessão e tamanho do último pedido, medidos pelo mod. */
function LinhaCache({ c, req, Text }: { c: { acc: { lidos: number; total: number; n: number }; parcial: boolean } | null; req: number | null; Text: any }) {
  const pc = taxa(c?.acc ?? null)
  if (pc === null && !req) return null
  return (
    <Text color="subtle" wrap="wrap">
      {pc !== null ? `cache ${pc}% (${fmtTokens(c!.acc.lidos)} de ${fmtTokens(c!.acc.total)} lidos${c!.parcial ? ', desde o carregamento' : ''})` : ''}
      {pc !== null && req ? ' · ' : ''}
      {req ? `último pedido ${fmtTokens(req)}` : ''}
    </Text>
  )
}
