import { expect, test } from 'claude-code/testing'

import { alinhamento, aoCarregar, aplicar, avisoJanela, comando, linhaContexto, nivelDe, notaPublicacao, ordenar, projetar, proxima, publica, UNIDADE_PADRAO, verificacaoAberta, pedeLicenca, bloqueioDeLicenca } from './objetivo'
import type { Snapshot } from '../types'

const snapCom = (livre: number): Snapshot => ({
  percent: 50,
  total: 200000,
  segments: [
    { key: 'conversa', tokens: 100000 },
    { key: 'livre', tokens: livre },
    { key: 'reserva', tokens: 33000 },
  ],
})

const definido = () =>
  aplicar(
    null,
    {
      acao: 'definir',
      titulo: 'Barra permanente',
      conclusao: '/reload-plugins mostra a versão instalada',
      itens: [
        { texto: 'instalar', tamanho: 'P' },
        { texto: 'testar', tamanho: 'M' },
        { texto: 'rodar /reload-plugins', dono: 'operador' },
      ],
    },
    'claude',
    40000,
    1,
  ).goal!

test('definir numera os itens e separa os donos', () => {
  const g = definido()
  expect(g.itens.map(i => i.id)).toEqual([1, 2, 3])
  expect(g.itens[2]!.dono).toBe('operador')
  const p = projetar(g, snapCom(100000))
  expect(p.abertasClaude).toBe(2)
  expect(p.abertasOperador).toBe(1)
  expect(p.necessario).toBe(3 * UNIDADE_PADRAO)
  expect(p.estado).toBe('cabe')
})

test('concluir mede o contexto gasto por unidade de peso e a média passa a valer com 2 amostras', () => {
  let g = definido()
  g = aplicar(g, { acao: 'concluir', ids: [1] }, 'claude', 50000, 2).goal! // P: 10k por unidade
  expect(g.consumo).toEqual([10000])
  g = aplicar(g, { acao: 'adicionar', itens: [{ texto: 'extra', tamanho: 'P' }] }, 'claude', 50000, 2).goal!
  g = aplicar(g, { acao: 'concluir', ids: [4] }, 'claude', 70000, 3).goal! // P: 20k
  const p = projetar(g, snapCom(100000))
  expect(p.comHistorico).toBe(true)
  expect(p.unidade).toBe(15000)
  expect(p.necessario).toBe(30000) // falta 'testar' (M = 2 unidades)
})

test('ids inexistentes e objetivo ausente viram erro, sem mudar o estado', () => {
  const g = definido()
  expect(aplicar(g, { acao: 'concluir', ids: [9] }, 'claude', 0, 1).erro).toContain('9')
  expect(aplicar(null, { acao: 'concluir', ids: [1] }, 'claude', 0, 1).erro).toContain('nenhum objetivo')
})

test('o aviso de janela sai uma vez por nível', () => {
  const g = definido()
  const primeiro = avisoJanela(g, snapCom(15000))
  expect(primeiro.nivel).toBe('nao-cabe')
  expect(primeiro.texto).toContain('Aviso de janela')
  expect(avisoJanela({ ...g, aviso: 'nao-cabe' }, snapCom(15000)).texto).toBe(undefined)
  expect(avisoJanela(g, snapCom(100000)).nivel).toBe(null)
})

test('a linha de contexto é curta: progresso, próxima com dono e janela, sem listas nem conclusão; completa só quando pedida', () => {
  const linha = linhaContexto(definido(), snapCom(100000), 'TOOL')
  expect(linha).toContain('[objetivo] Barra permanente · 0/3 · próxima #1 instalar (claude) · janela cabe')
  expect(linha).not.toContain('testar')
  expect(linha).not.toContain('rodar /reload-plugins')
  expect(linha).not.toContain('mostra a versão instalada')
  expect(linha.length).toBeLessThan(160)
  // Recém-definido (ou início de sessão): a conclusão uma vez e como marcar, mas ainda sem as listas.
  const completa = linhaContexto(definido(), snapCom(100000), 'TOOL', true)
  expect(completa.split('mostra a versão instalada').length).toBe(2)
  expect(completa).toContain('acao "ver"')
  expect(completa).not.toContain('rodar /reload-plugins')
  // Texto longo da próxima sai cortado; sem dados de janela, a janela some; tudo feito não tem próxima.
  const longo = aplicar(null, { acao: 'definir', titulo: 'T', itens: [{ texto: 'x'.repeat(200) }] }, 'claude', 0, 1).goal!
  expect(linhaContexto(longo, null, 'TOOL')).toContain(`#1 ${'x'.repeat(59)}… (claude)`)
  expect(linhaContexto(longo, null, 'TOOL')).not.toContain('janela')
  // Exatamente 60 caracteres ainda cabem inteiros, sem reticências (sobrevivente #2 da rodada da 0.9.0).
  const sessenta = aplicar(null, { acao: 'definir', titulo: 'T', itens: [{ texto: 'y'.repeat(60) }] }, 'claude', 0, 1).goal!
  expect(linhaContexto(sessenta, null, 'TOOL')).toContain(`#1 ${'y'.repeat(60)} (claude)`)
  const feito = aplicar(longo, { acao: 'concluir', ids: [1] }, 'claude', 0, 2).goal!
  expect(linhaContexto(feito, null, 'TOOL')).toContain('1/1 · tudo feito')
  expect(linhaContexto(null, null, 'TOOL')).toContain('Nenhum objetivo ativo')
})

test('o comando do operador', () => {
  expect(comando('')).toBe('painel')
  expect(comando('feito 1 3')).toEqual({ acao: 'concluir', ids: [1, 3] })
  expect(comando('meu revisar o ADR')).toEqual({ acao: 'adicionar', itens: [{ texto: 'revisar o ADR', dono: 'operador' }] })
  expect(comando('Migrar vault :: merge em main')).toEqual({ acao: 'definir', titulo: 'Migrar vault', conclusao: 'merge em main' })
  expect(comando('encerrar')).toEqual({ acao: 'encerrar' })
  expect(comando('auto off')).toBe('auto-off')
  expect(comando('auto on')).toBe('auto-on')
  // Com mais texto, não é a chave: é um objetivo novo (sobrevivente #1 da rodada 4).
  expect(comando('auto on agora')).toEqual({ acao: 'definir', titulo: 'auto on agora', conclusao: undefined })
  // Só on e off são a chave (sobrevivente #9 da 3ª execução da rodada 4).
  expect(comando('auto xyz')).toEqual({ acao: 'definir', titulo: 'auto xyz', conclusao: undefined })
})

test('ao carregar: reload com o objetivo só na sessão o mantém e grava; /cd vale o do store, recomeçando turno e aviso', () => {
  const g = { ...definido(), atualizadoTurno: 30, aviso: 'nao-cabe' as const, marco: 99 }
  expect(aoCarregar(true, null, g, 1000, 0)).toEqual({ goal: g, gravar: true })
  const deOutra = aoCarregar(false, g, null, 1000, 5)
  expect(deOutra.gravar).toBe(false)
  expect(deOutra.goal).toEqual({ ...g, marco: 1000, atualizadoTurno: 5, aviso: null })
  // /cd para uma pasta sem objetivo: o da pasta anterior não vem junto.
  expect(aoCarregar(false, null, g, 1000, 5)).toEqual({ goal: null, gravar: false })
  // Sessão nova com objetivo gravado: o do store vence o que estiver na sessão.
  expect(aoCarregar(true, g, null, 0, 0).goal?.titulo).toBe(g.titulo)
})

test('prioridade: sem nível vale requisito; priorizar muda o nível; a ordem é bloqueante, requisito, melhoria e depois o id', () => {
  let g = aplicar(
    null,
    {
      acao: 'definir',
      titulo: 'Entrega',
      itens: [
        { texto: 'polir textos', nivel: 'melhoria' },
        { texto: 'escrever módulo' },
        { texto: 'liberar acesso', dono: 'operador', nivel: 'bloqueante' },
        { texto: 'testar' },
      ],
    },
    'claude',
    0,
    1,
  ).goal!
  expect(g.itens.map(nivelDe)).toEqual(['melhoria', 'requisito', 'bloqueante', 'requisito'])
  expect(ordenar(g.itens).map(i => i.id)).toEqual([3, 2, 4, 1])
  // Um objetivo gravado antes da 0.5.0 não tem nível: conta como requisito.
  expect(nivelDe({ id: 9, texto: 'x', dono: 'claude', tamanho: 'P', feito: false })).toBe('requisito')

  g = aplicar(g, { acao: 'priorizar', ids: [4], nivel: 'bloqueante' }, 'claude', 0, 2).goal!
  expect(ordenar(g.itens).map(i => i.id)).toEqual([3, 4, 2, 1])
  expect(aplicar(g, { acao: 'priorizar', ids: [4] }, 'claude', 0, 2).erro).toContain('nivel')

  // A próxima é a primeira aberta na ordem, de qualquer dono; feitas saem da fila.
  expect(proxima(g)?.id).toBe(3)
  g = aplicar(g, { acao: 'concluir', ids: [3] }, 'operador', 0, 3).goal!
  expect(proxima(g)?.id).toBe(4)

  // A linha ao modelo segue a ordem e marca só o que não é requisito.
  const linha = linhaContexto(g, null, 'TOOL')
  expect(linha).toContain('próxima #4 [bloqueante] testar (claude)')
  expect(linha).not.toContain('escrever módulo')
})

test('o operador reprioriza pelo /objetivo', () => {
  expect(comando('bloqueante 3 4')).toEqual({ acao: 'priorizar', ids: [3, 4], nivel: 'bloqueante' })
  expect(comando('melhoria 2')).toEqual({ acao: 'priorizar', ids: [2], nivel: 'melhoria' })
  expect(comando('requisito 1')).toEqual({ acao: 'priorizar', ids: [1], nivel: 'requisito' })
})

test('bordas da prioridade: empate fora de ordem, tudo feito, nível inválido ou null', () => {
  const item = (id: number, nivel?: unknown) => ({ id, texto: `t${id}`, dono: 'claude' as const, tamanho: 'P' as const, feito: false, nivel: nivel as never })
  // Empate de nível: desempata pelo id mesmo quando a lista chega fora de ordem.
  expect(ordenar([item(3), item(1, 'bloqueante'), item(2)]).map(i => i.id)).toEqual([1, 2, 3])
  expect(ordenar([])).toEqual([])
  // Tudo feito: não há próxima.
  let g = aplicar(null, { acao: 'definir', titulo: 'x', itens: [{ texto: 'a' }, { texto: 'b' }] }, 'claude', 0, 1).goal!
  g = aplicar(g, { acao: 'concluir', ids: [1, 2] }, 'claude', 0, 2).goal!
  expect(proxima(g)).toBe(undefined)
  // Nível fora dos três (o modelo pode mandar outro) vira requisito; null de um JSON editado também.
  const inval = aplicar(null, { acao: 'definir', titulo: 'x', itens: [{ texto: 'a', nivel: 'urgente' as never }] }, 'claude', 0, 1).goal!
  expect(nivelDe(inval.itens[0]!)).toBe('requisito')
  expect(nivelDe(item(5, null))).toBe('requisito')
})

test('alinhamento: a conclusão é o efeito, e a linha de cada pedido pergunta se a próxima ação aproxima dele (lançamento do claude-grounds)', () => {
  const g = definido()
  expect(alinhamento(g)).toContain('"/reload-plugins mostra a versão instalada"')
  expect(alinhamento(g)).toContain('mostra que o efeito aconteceu')
  expect(alinhamento({ ...g, conclusao: '' })).toContain('sem conclusão')
  expect(linhaContexto(g, snapCom(100000), 'TOOL')).toContain('antes de agir: isso aproxima da conclusão?')
  expect(linhaContexto({ ...g, conclusao: '' }, snapCom(100000), 'TOOL')).not.toContain('antes de agir')
  // Só espaços conta como vazia; ausente não derruba (rodada 11, #1 #2 #5).
  expect(alinhamento({ ...g, conclusao: '   ' })).toContain('sem conclusão')
  expect(alinhamento({ ...g, conclusao: undefined as never })).toContain('sem conclusão')
  expect(linhaContexto({ ...g, conclusao: '   ' }, snapCom(100000), 'TOOL')).not.toContain('antes de agir')
})

test('publicar: a lista curta pega o que publica e deixa passar o resto', () => {
  for (const c of ['git push origin main', 'cd x && git push', 'npm publish --access public', 'gh release create v1', 'npm run deploy', './deploy.sh prod', 'bin/publicar camada', 'promover', 'rsync -a out/ host:/srv', 'scp a host:', 'cp -r dist/ output/espelhos/site', 'mv a.html /data/output/espelhos/a.html && ls'])
    expect([c, publica(c)]).toEqual([c, true])
  for (const c of ['git status', 'git pushd', 'cat docs/deploy.md', 'grep deployment x', 'cp output/espelhos/a.html /tmp/a.html', 'ls output/espelhos/', 'npm test', 'echo republicar', 'python3 rsync_helper.py'])
    expect([c, publica(c)]).toEqual([c, false])
})

test('publicar: o texto que o comando só carrega não conta (heredoc, string com espaço); caminho entre aspas conta', () => {
  expect(publica("python3 - <<'EOF'\nexpect(notaPublicacao(g, 'git push')).toBe(x)\nEOF")).toBe(false)
  expect(publica('cat > nota.md <<EOF\nrodar git push depois\nEOF\ngit status')).toBe(false)
  expect(publica('python3 -c "import os; os.system(\'git push\')"')).toBe(false)
  expect(publica('echo "vou fazer deploy amanhã"')).toBe(false)
  expect(publica('cp camada.json "output/espelhos/site--ao-vivo/camada.json"')).toBe(true)
  expect(publica("cat x <<EOF\ntexto\nEOF\ngit push origin main")).toBe(true)
  expect(publica('git push')).toBe(true)
})

test('publicar: a nota sai com pendência do Claude aberta que é bloqueante ou de verificar/provar/capturar; nunca por pendência do operador ou feita', () => {
  const g = aplicar(null, { acao: 'definir', titulo: 'Camada', itens: [{ texto: 'escrever camada' }, { texto: 'Verificação da camada no ar', tamanho: 'P' }, { texto: 'conferir no celular', dono: 'operador', nivel: 'bloqueante' }] }, 'claude', 0, 1).goal!
  expect(verificacaoAberta(g)?.id).toBe(2)
  expect(notaPublicacao(g, 'git push')).toBe('[objetivo] esta ação publica e a pendência #2 "Verificação da camada no ar" está aberta: conclua a verificação antes, ou diga ao operador por que não')
  expect(notaPublicacao(g, 'git status')).toBe(undefined)
  const feito = aplicar(g, { acao: 'concluir', ids: [2] }, 'claude', 0, 2).goal!
  expect(verificacaoAberta(feito)).toBe(undefined)
  expect(notaPublicacao(feito, 'git push')).toBe(undefined)
  const bloq = aplicar(feito, { acao: 'priorizar', ids: [1], nivel: 'bloqueante' }, 'claude', 0, 3).goal!
  expect(verificacaoAberta(bloq)?.id).toBe(1)
  for (const t of ['provar o ciclo', 'captura da tela']) {
    const h = aplicar(null, { acao: 'definir', titulo: 'T', itens: [{ texto: t }] }, 'claude', 0, 1).goal!
    expect(verificacaoAberta(h)?.id).toBe(1)
  }
  expect(notaPublicacao(null, 'git push')).toBe(undefined)
  // Com duas abertas, a nota cita a de maior prioridade, não a primeira da lista (sobrevivente #6 da 0.10.0).
  const duas = aplicar(null, { acao: 'definir', titulo: 'D', itens: [{ texto: 'verificar o rodapé' }, { texto: 'provar a camada', nivel: 'bloqueante' }] }, 'claude', 0, 1).goal!
  expect(verificacaoAberta(duas)?.id).toBe(2)
})

test('pede licença: a última frase da resposta pergunta se segue; pergunta de conteúdo ou no meio do texto não conta (16/10: "Sigo?" com R9 e R10 já aprovados)', () => {
  expect(pedeLicenca('Fiz tudo.\n\nO próximo passo é R9 e R10. Sigo?')).toBe('Sigo?')
  expect(pedeLicenca('Pronto.\n\nQuer que eu promova os dois e comece?')).toBe('Quer que eu promova os dois e comece?')
  expect(pedeLicenca('Feito. Posso seguir com a #3?  ')).toBe('Posso seguir com a #3?')
  expect(pedeLicenca('Feito.\n\nDevo continuar?')).toBe('Devo continuar?')
  expect(pedeLicenca('Feito.\n\nProssigo com a Fase 2?')).toBe('Prossigo com a Fase 2?')
  expect(pedeLicenca('Feito. Deseja que eu abra o objetivo?')).toBe('Deseja que eu abra o objetivo?')
  expect(pedeLicenca('Se não disser nada em contrário, sigo com R9 e R10 no próximo turno.')).toBe('Se não disser nada em contrário, sigo com R9 e R10 no próximo turno.')
  // Não é pedido de licença: pergunta de conteúdo, pergunta no meio, resposta sem pergunta.
  expect(pedeLicenca('Qual dos dois nomes você prefere?')).toBeUndefined()
  expect(pedeLicenca('Sigo? Sim: já comecei e terminei a #2.')).toBeUndefined()
  expect(pedeLicenca('Tudo feito. Nada é seu.')).toBeUndefined()
  expect(pedeLicenca('')).toBeUndefined()
  // A pergunta citada no meio da frase não é o fim da resposta (sobrevivente #13).
  expect(pedeLicenca('Ele perguntou "sigo?" e eu segui.')).toBeUndefined()
})

test('bloqueio de licença: só com trabalho já aprovado do Claude (a próxima do objetivo ou o roadmap em agora); diz qual e manda seguir', () => {
  const g = aplicar(null, { acao: 'definir', titulo: 'T', itens: [{ texto: 'a', dono: 'claude' }, { texto: 'b', dono: 'operador' }] }, 'claude', 0, 0).goal!
  const r = bloqueioDeLicenca('Feito. Sigo?', g, [])
  expect(r).toContain('"Sigo?"')
  expect(r).toContain('#1 a')
  expect(r).toContain('AskUserQuestion')
  // A próxima é do operador: perguntar a ele é legítimo.
  const vezDele = aplicar(g, { acao: 'concluir', ids: [1] }, 'claude', 0, 0).goal!
  expect(bloqueioDeLicenca('Feito. Sigo?', vezDele, [])).toBeUndefined()
  // Sem objetivo, ou com tudo feito: o roadmap em agora é o trabalho aprovado.
  const agora = [{ n: 9, id: 'r9', texto: 'modo habilitado', horizonte: 'agora' as const, estado: 'aberto' as const }, { n: 4, id: 'r4', texto: 'abas', horizonte: 'proximo' as const, estado: 'aberto' as const }]
  expect(bloqueioDeLicenca('Sigo com R9?', null, agora)).toContain('R9 modo habilitado')
  expect(bloqueioDeLicenca('Sigo com R9?', null, agora)).not.toContain('R4')
  const feito = aplicar(vezDele, { acao: 'concluir', ids: [2] }, 'claude', 0, 0).goal!
  expect(bloqueioDeLicenca('Sigo com R9?', feito, agora)).toContain('R9')
  // Nada aprovado: perguntar é legítimo.
  expect(bloqueioDeLicenca('Sigo?', null, [agora[1]!])).toBeUndefined()
  expect(bloqueioDeLicenca('Sigo?', feito, [])).toBeUndefined()
  // Sem pedido de licença, nada.
  expect(bloqueioDeLicenca('Feito.', g, agora)).toBeUndefined()
  // A minha que vem primeiro é a da ordem de execução (bloqueante antes), não a que entrou antes (sobrevivente #4).
  const ordem = aplicar(null, { acao: 'definir', titulo: 'T', itens: [{ texto: 'pode esperar', dono: 'claude', nivel: 'melhoria' }, { texto: 'trava', dono: 'claude', nivel: 'bloqueante' }] }, 'claude', 0, 0).goal!
  expect(bloqueioDeLicenca('Sigo?', ordem, [])).toContain('#2 trava')
  // Os de agora na ordem do roadmap; promovido não é mais de agora (sobreviventes #5 e #7).
  const dois = [agora[0]!, { n: 10, id: 'r10', texto: 'disparo', horizonte: 'agora' as const, estado: 'aberto' as const }]
  expect(bloqueioDeLicenca('Sigo?', null, dois)).toContain('R9 modo habilitado; R10 disparo')
  expect(bloqueioDeLicenca('Sigo?', null, [{ ...agora[0]!, estado: 'promovido' as const, pendencia: 1 }])).toBeUndefined()
})
