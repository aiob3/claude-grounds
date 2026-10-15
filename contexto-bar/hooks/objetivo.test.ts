import { expect, test } from 'claude-code/testing'

import { alinhamento, aoCarregar, aplicar, avisoJanela, comando, linhaContexto, nivelDe, ordenar, projetar, proxima, UNIDADE_PADRAO } from './objetivo'
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
