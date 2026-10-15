import { expect, test } from 'claude-code/testing'

import { alertas, avisoAoModelo, caminhoSaida, concluirTarefa, fimDeTurno, linhasDoPainel, notificacao, registrarTarefa, SP_VAZIO } from './segundo-plano'

const MIN = 60000
const t0 = 1_000_000
const tarefa = (id: string, extra: object = {}) => ({ id, descricao: `tarefa ${id}`, saida: `/tmp/t/${id}.output`, inicio: t0, ...extra })

test('segundo plano: lê a notificação e o arquivo de saída no formato real do Claude Code', () => {
  const real =
    '<task-notification>\n<task-id>bvaa17wnb</task-id>\n<tool-use-id>toolu_01</tool-use-id>\n<output-file>/tmp/x/tasks/bvaa17wnb.output</output-file>\n<status>completed</status>\n<summary>ok</summary>'
  expect(notificacao(real)).toEqual({ id: 'bvaa17wnb', status: 'completed' })
  expect(notificacao('<task-id>b1</task-id>')).toEqual({ id: 'b1', status: '' })
  expect(notificacao('texto qualquer')).toBe(null)
  const resultado = 'Command running in background with ID: bpvv3jzhi. Output is being written to: /tmp/c/-home-u-Work/0a/tasks/bpvv3jzhi.output. You will be notified when it completes.'
  expect(caminhoSaida(resultado)).toBe('/tmp/c/-home-u-Work/0a/tasks/bpvv3jzhi.output')
  expect(caminhoSaida('sem caminho')).toBe(undefined)
  expect(caminhoSaida(undefined)).toBe(undefined)
})

test('segundo plano: saída parada há 5 min ou mais alerta; a contagem parte da última escrita, nunca antes do início', () => {
  const sp = registrarTarefa(SP_VAZIO, tarefa('b1'))
  expect(alertas(sp, t0 + 4 * MIN + 59999)).toEqual([])
  expect(alertas(sp, t0 + 5 * MIN)[0]?.semSaidaMin).toBe(5)
  const escreveu = registrarTarefa(SP_VAZIO, tarefa('b1', { mtime: t0 + 10 * MIN }))
  expect(alertas(escreveu, t0 + 12 * MIN)).toEqual([])
  expect(alertas(escreveu, t0 + 15 * MIN)[0]?.semSaidaMin).toBe(5)
  // mtime anterior ao início (arquivo reaproveitado) não infla a conta; sem arquivo de saída não há o que medir.
  expect(alertas(registrarTarefa(SP_VAZIO, tarefa('b1', { mtime: 0 })), t0 + 6 * MIN)[0]?.semSaidaMin).toBe(6)
  expect(alertas(registrarTarefa(SP_VAZIO, tarefa('b1', { saida: undefined })), t0 + 60 * MIN)).toEqual([])
})

test('segundo plano: sem volta só depois que o turno acabou; volta agendada depois da tarefa ou cron da sessão cala', () => {
  const sp = registrarTarefa(SP_VAZIO, tarefa('b1', { saida: undefined }))
  expect(alertas(sp, t0 + MIN)).toEqual([])
  const fim = fimDeTurno(sp, t0 + MIN)
  expect(alertas(fim, t0 + MIN)).toEqual([{ tarefa: fim.tarefas[0]!, semSaidaMin: null, semVolta: true }])
  expect(alertas({ ...fim, voltaEm: t0 }, t0 + MIN)).toEqual([])
  expect(alertas({ ...fim, voltaEm: t0 - 1 }, t0 + MIN).length).toBe(1)
  expect(alertas(fimDeTurno(sp, t0 + MIN, undefined, 1), t0 + MIN)).toEqual([])
  // Turno que acabou antes da tarefa começar não conta.
  expect(alertas({ ...sp, fimTurno: t0 - 1 }, t0 + MIN)).toEqual([])
})

test('segundo plano: o Stop tira o que já acabou; ids de outra família não calam o alerta; a conclusão limpa', () => {
  const sp = registrarTarefa(registrarTarefa(SP_VAZIO, tarefa('b1')), tarefa('b2'))
  expect(fimDeTurno(sp, t0, [{ id: 'b2', type: 'shell' }]).tarefas.map(t => t.id)).toEqual(['b2'])
  expect(fimDeTurno(sp, t0, []).tarefas).toEqual([])
  expect(fimDeTurno(sp, t0, [{ id: 'outro', type: 'shell' }]).tarefas.length).toBe(2)
  expect(fimDeTurno(sp, t0, [{ id: 'ag', type: 'subagent' }]).tarefas).toEqual([])
  expect(fimDeTurno(sp, t0).tarefas.length).toBe(2)
  expect(fimDeTurno({ ...sp, cronsAtivos: true }, t0).cronsAtivos).toBe(true)
  expect(fimDeTurno({ ...sp, cronsAtivos: true }, t0, undefined, 0).cronsAtivos).toBe(false)
  expect(concluirTarefa(sp, 'b1').tarefas.map(t => t.id)).toEqual(['b2'])
  expect(concluirTarefa(sp, 'nada')).toBe(sp)
  expect(registrarTarefa(sp, tarefa('b1', { descricao: 'de novo' })).tarefas.filter(t => t.id === 'b1').map(t => t.descricao)).toEqual(['de novo'])
})

test('segundo plano: o aviso ao modelo é curto e o painel tem uma linha por tarefa', () => {
  const sp = fimDeTurno(registrarTarefa(SP_VAZIO, tarefa('b1', { descricao: 'verificação longa da camada com captura de tela inteira' })), t0)
  const agora = t0 + 12 * MIN
  expect(avisoAoModelo(alertas(sp, agora))).toBe(' · ⚠ tarefa em segundo plano sem saída há 12 min, sem volta agendada')
  expect(avisoAoModelo(alertas({ ...sp, voltaEm: t0 }, agora))).toBe(' · ⚠ tarefa em segundo plano sem saída há 12 min')
  expect(avisoAoModelo(alertas(sp, t0 + MIN))).toBe(' · ⚠ tarefa em segundo plano sem volta agendada')
  expect(avisoAoModelo(alertas(registrarTarefa(sp, tarefa('b2')), agora))).toContain('(+1)')
  expect(avisoAoModelo([])).toBe('')
  // Duas tarefas: o aviso cita a mais antiga e conta a outra (sobrevivente #7 da 0.10.0).
  const duas = registrarTarefa(sp, tarefa('b2', { inicio: t0 + MIN }))
  expect(avisoAoModelo(alertas(duas, agora))).toBe(' · ⚠ tarefa em segundo plano sem saída há 12 min, sem volta agendada (+1)')
  // Registrar de novo a mesma tarefa a leva para o fim, sem duplicar (sobrevivente #8 da 0.10.0).
  expect(registrarTarefa(duas, tarefa('b1', { inicio: t0 })).tarefas.map(t => t.id)).toEqual(['b2', 'b1'])
  expect(linhasDoPainel(sp, agora)).toEqual(['segundo plano: verificação longa da camada com captura… · sem saída há 12 min · nada agendado para voltar'])
  expect(linhasDoPainel({ ...sp, voltaEm: t0 }, t0 + MIN)).toEqual(['segundo plano: verificação longa da camada com captura… · em curso'])
})
