import { expect, test } from 'claude-code/testing'

import { REGRA_CURTA, REGRA_HABILITADO, regraHabilitado, arquivoVizinhos, contextoAvisos, conteudo, estadosDe, lerSnapshot, mudancas, textoAviso } from './vizinhos'

const agente = (pane: string, ws: string, estado: string, titulo = '') => ({ pane_id: pane, workspace_id: ws, agent_status: estado, terminal_title_stripped: titulo })
const snap = (workspaces: object[], agents: object[]) => JSON.stringify({ id: 'x', result: { snapshot: { workspaces, agents } } })

test('snapshot: os outros workspaces com o estado do herdr e os agentes deles; o desta sessão fica de fora', () => {
  const t = snap(
    [
      { workspace_id: 'w1', label: 'mods', agent_status: 'working' },
      { workspace_id: 'w2', label: ' motor ', agent_status: 'blocked' },
      { workspace_id: 'w3', label: '', agent_status: 'idle' },
    ],
    [agente('w1:p1', 'w1', 'working'), agente('w2:p1', 'w2', 'blocked', ' Retomada '), agente('w2:p2', 'w2', 'esquisito')],
  )
  expect(lerSnapshot(t, 'w1')).toEqual([
    { workspace: 'w2', rotulo: 'motor', estado: 'blocked', agentes: [{ pane: 'w2:p1', estado: 'blocked', titulo: 'Retomada' }, { pane: 'w2:p2', estado: 'unknown', titulo: '' }] },
    { workspace: 'w3', rotulo: 'w3', estado: 'idle', agentes: [] },
  ])
  // Sem o agregado do herdr, o que mais pede o operador vence.
  const sem = snap([{ workspace_id: 'w2', label: 'm' }], [agente('a', 'w2', 'working'), agente('b', 'w2', 'done'), agente('c', 'w2', 'idle')])
  expect(lerSnapshot(sem, 'w1')![0]!.estado).toBe('done')
  const bloq = snap([{ workspace_id: 'w2', label: 'm' }], [agente('a', 'w2', 'done'), agente('b', 'w2', 'blocked')])
  expect(lerSnapshot(bloq, 'w1')![0]!.estado).toBe('blocked')
  expect(lerSnapshot(snap([{ workspace_id: 'w2', label: 'm' }], []), 'w1')![0]!.estado).toBe('unknown')
  // Agregado do herdr fora do vocabulário (versão nova): vale o dos agentes (sobrevivente #9).
  expect(lerSnapshot(snap([{ workspace_id: 'w2', label: 'm', agent_status: 'pensando' }], [agente('a', 'w2', 'done')]), 'w1')![0]!.estado).toBe('done')
  // Agente sem pane ou workspace sem id não entram; sem a lista de agentes, os workspaces vêm vazios.
  expect(lerSnapshot(snap([{ workspace_id: 'w2', label: 'm' }, { label: 'sem id' }], [{ workspace_id: 'w2', agent_status: 'idle' }]), 'w1')).toEqual([{ workspace: 'w2', rotulo: 'm', estado: 'unknown', agentes: [] }])
  expect(lerSnapshot(JSON.stringify({ result: { snapshot: { workspaces: [{ workspace_id: 'w2', label: 'm', agent_status: 'idle' }] } } }), 'w1')).toEqual([{ workspace: 'w2', rotulo: 'm', estado: 'idle', agentes: [] }])
  // O que não é snapshot: null, sem quebrar.
  expect(lerSnapshot('não é json', 'w1')).toBeNull()
  expect(lerSnapshot('{"result":{}}', 'w1')).toBeNull()
  expect(lerSnapshot('{"result":{"snapshot":{"workspaces":{}}}}', 'w1')).toBeNull()
})

test('mudanças: só o que acabou de ficar blocked ou done; a primeira leitura não avisa', () => {
  const vs = lerSnapshot(snap([{ workspace_id: 'w2', label: 'motor' }], [agente('w2:p1', 'w2', 'blocked'), agente('w2:p2', 'w2', 'done'), agente('w2:p3', 'w2', 'working')]), 'w1')!
  expect(mudancas(null, vs)).toEqual([])
  expect(mudancas({ 'w2:p1': 'working', 'w2:p2': 'done', 'w2:p3': 'idle' }, vs)).toEqual([{ rotulo: 'motor', pane: 'w2:p1', estado: 'blocked' }])
  // Pane que não estava na leitura anterior e já chega parado avisa.
  expect(mudancas({}, vs).map(m => m.pane)).toEqual(['w2:p1', 'w2:p2'])
  expect(estadosDe(vs)).toEqual({ 'w2:p1': 'blocked', 'w2:p2': 'done', 'w2:p3': 'working' })
})

test('avisos: frase curta por mudança; ao modelo, com a regra de não agir na sessão do outro', () => {
  expect(textoAviso({ rotulo: 'motor', pane: 'w2:p1', estado: 'blocked' })).toBe('motor (w2:p1) está esperando o operador')
  expect(textoAviso({ rotulo: 'motor', pane: 'w2:p1', estado: 'done' })).toBe('motor (w2:p1) terminou')
  expect(contextoAvisos([])).toBeUndefined()
  expect(contextoAvisos(['a', 'b'])).toBe('[herdr] a; b. A sessão de outro workspace é do operador: avise-o, não responda nem aja nela.')
})

test('contrato: um arquivo por pane, versão 1', () => {
  expect(arquivoVizinhos('/h', 'w5:p1')).toBe('/h/.claude/herdr/vizinhos/w5%3Ap1.json')
  expect(JSON.parse(conteudo('2026-10-16T00:00:00.000Z', 'w5', []))).toEqual({ versao: 1, fonte: 'herdr', em: '2026-10-16T00:00:00.000Z', workspace: 'w5', vizinhos: [] })
})

test('modo habilitado: a regra inteira na primeira vez, a curta depois; as duas nomeiam o disparo por frente', () => {
  expect(regraHabilitado(true)).toBe(REGRA_HABILITADO)
  expect(regraHabilitado(false)).toBe(REGRA_CURTA)
  expect(REGRA_HABILITADO).toContain('workspace = projeto, tab = frente, pane = perfil de agente')
  expect(REGRA_HABILITADO).toContain('paralelo ou fila')
  expect(REGRA_HABILITADO).toContain('codex')
  expect(REGRA_HABILITADO).toContain('Frente delegada a um pane leva briefing (ferramenta briefing')
  expect(REGRA_CURTA.length).toBeLessThan(140)
  expect(REGRA_CURTA).toContain('paralelo ou fila, meio e harness')
})
