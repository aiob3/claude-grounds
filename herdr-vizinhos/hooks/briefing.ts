// O briefing por frente (ACIONAMENTO.md, etapa 2): o que o agente delegado precisa para trabalhar sem a conversa de
// quem o criou. Fica num arquivo da pasta da frente, em Markdown sem ferramenta nenhuma, porque quem lê pode ser
// outro harness (codex, gemini). As seções têm títulos fixos: quem delegou relê o arquivo e confere o escopo do que
// voltou (os arquivos tocados contra "Arquivos" e "O que não tocar"), que é a base da pendência com agente como dono.
//
// Contrato (versão 1): <pasta da frente>/.herdr/frentes/<slug da frente>.md; a 2ª linha é o comentário
// `<!-- herdr-briefing v1 · ... -->`. A pasta .herdr leva um .gitignore com `*`: o briefing não entra no diff.

export const VERSAO_BRIEFING = 1

export type Briefing = {
  frente: string
  objetivo: string
  /** Os arquivos ou pastas (terminadas em /, ou com * e **) que a frente pode mudar; vazio = qualquer um fora de naoTocar. */
  arquivos: string[]
  feito: string
  naoTocar: string[]
  pendencia?: number
  harness?: string
}

const SECOES = { objetivo: 'Objetivo', arquivos: 'Arquivos', feito: 'O que conta como feito', naoTocar: 'O que não tocar' } as const

/** O nome do arquivo da frente: minúsculo, sem acento, só letras, números e hífen. */
export function slug(frente: string): string {
  return frente
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export const pastaDosBriefings = (pasta: string) => `${pasta.replace(/\/+$/, '')}/.herdr/frentes`
export const arquivoBriefing = (pasta: string, frente: string) => `${pastaDosBriefings(pasta)}/${slug(frente)}.md`
export const GITIGNORE_HERDR = '*\n'

/** O que falta para o briefing valer: sem objetivo ou sem o que conta como feito, o agente delegado não sabe quando parar. */
export function faltas(b: Partial<Briefing>): string[] {
  const f: string[] = []
  if (!b.frente?.trim() || !slug(b.frente)) f.push('frente')
  if (!b.objetivo?.trim()) f.push('objetivo')
  if (!b.feito?.trim()) f.push('feito')
  return f
}

const lista = (xs: string[], vazio: string) => (xs.length ? xs.map(x => `- \`${x}\``).join('\n') : vazio)

/** O texto do arquivo. */
export function textoBriefing(b: Briefing, em: string): string {
  const meta = [`herdr-briefing v${VERSAO_BRIEFING}`, em, ...(b.pendencia ? [`pendência #${b.pendencia}`] : []), ...(b.harness ? [`harness ${b.harness}`] : [])]
  return [
    `# Frente: ${b.frente.trim()}`,
    `<!-- ${meta.join(' · ')} -->`,
    '',
    `## ${SECOES.objetivo}`,
    '',
    b.objetivo.trim(),
    '',
    `## ${SECOES.arquivos}`,
    '',
    lista(b.arquivos, 'Qualquer arquivo da pasta, fora dos de "O que não tocar".'),
    '',
    `## ${SECOES.feito}`,
    '',
    b.feito.trim(),
    '',
    `## ${SECOES.naoTocar}`,
    '',
    lista(b.naoTocar, 'Nada além do que está fora de "Arquivos".'),
    '',
    '## Ao terminar',
    '',
    'Pare com o resultado na árvore de trabalho, sem commit. Quem delegou confere o escopo (os arquivos tocados contra as duas listas acima) e roda a prova.',
    '',
  ].join('\n')
}

/** O briefing de volta, do arquivo; null quando não é um briefing desta versão. */
export function lerBriefing(texto: string): Briefing | null {
  const linhas = texto.split('\n')
  const frente = /^# Frente: (.+)$/.exec(linhas[0] ?? '')?.[1]?.trim()
  const meta = /^<!-- herdr-briefing v(\d+)(.*)-->$/.exec(linhas[1] ?? '')
  if (!frente || !meta || Number(meta[1]) !== VERSAO_BRIEFING) return null
  const secoes = new Map<string, string[]>()
  let atual: string | undefined
  for (const l of linhas.slice(2)) {
    const h = /^## (.+)$/.exec(l)
    if (h) secoes.set((atual = h[1]!.trim()), [])
    else if (atual) secoes.get(atual)!.push(l)
  }
  const corpo = (s: string) => (secoes.get(s) ?? []).join('\n').trim()
  const itens = (s: string) => (secoes.get(s) ?? []).flatMap(l => /^- `(.+)`$/.exec(l.trim())?.[1] ?? [])
  const pendencia = /pendência #(\d+)/.exec(meta[2]!)?.[1]
  const harness = /harness (\S+)/.exec(meta[2]!)?.[1]
  return {
    frente,
    objetivo: corpo(SECOES.objetivo),
    arquivos: itens(SECOES.arquivos),
    feito: corpo(SECOES.feito),
    naoTocar: itens(SECOES.naoTocar),
    ...(pendencia ? { pendencia: Number(pendencia) } : {}),
    ...(harness ? { harness } : {}),
  }
}

/** Um padrão da lista contra um caminho: igual, a pasta (terminada em /) e o que há nela, `*` dentro de um nível, `**` em qualquer. */
export function casa(padrao: string, caminho: string): boolean {
  const p = padrao.trim().replace(/^\.\//, '')
  if (!p) return false
  if (p.endsWith('/')) return caminho.startsWith(p)
  if (!p.includes('*')) return caminho === p || caminho.startsWith(`${p}/`)
  const re = p
    .split('**')
    .map(parte => parte.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
    .join('.*')
  return new RegExp(`^${re}$`).test(caminho)
}

/** Os arquivos tocados que saem do escopo: os proibidos (em naoTocar) e os de fora (não estão em arquivos, quando há lista). */
export function foraDoEscopo(tocados: string[], b: Pick<Briefing, 'arquivos' | 'naoTocar'>): { proibidos: string[]; fora: string[] } {
  const proibidos = tocados.filter(t => b.naoTocar.some(p => casa(p, t)))
  const fora = b.arquivos.length ? tocados.filter(t => !proibidos.includes(t) && !b.arquivos.some(p => casa(p, t))) : []
  return { proibidos, fora }
}

/**
 * Os arquivos tocados, relativos à pasta da frente: os do `git diff --name-only --relative HEAD` (mudados, apagados, no
 * índice) e os de `git ls-files -o --exclude-standard` (novos). O status sairia relativo à raiz do repositório e
 * resumiria a pasta nova num nome só. A pasta .herdr fica de fora.
 */
export function tocadosDe(diff: string, novos: string): string[] {
  const todos = `${diff}\n${novos}`.split('\n').map(l => l.trim()).filter(Boolean)
  return [...new Set(todos)].filter(c => !c.startsWith('.herdr/'))
}

/** A instrução curta para o pane: o caminho do briefing e o que fazer ao terminar. */
export const promptDoPane = (caminho: string) => `Leia ${caminho} e trabalhe só nessa frente. Ao terminar, pare com o resultado na árvore, sem commit.`

/** O resultado da conferência, em texto para o modelo. */
export function textoConferencia(b: Briefing, tocados: string[], f: { proibidos: string[]; fora: string[] }): string {
  const cabeca = `Frente "${b.frente}": ${tocados.length} arquivo${tocados.length === 1 ? '' : 's'} tocado${tocados.length === 1 ? '' : 's'}`
  if (!f.proibidos.length && !f.fora.length) return `${cabeca}, todos no escopo. Feito quando: ${b.feito}`
  return [
    `${cabeca}; FORA DO ESCOPO:`,
    ...f.proibidos.map(t => `  ✘ ${t} (em "O que não tocar")`),
    ...f.fora.map(t => `  ✘ ${t} (fora de "Arquivos")`),
    'A frente não está feita: desfaça ou justifique cada um antes da prova.',
  ].join('\n')
}
