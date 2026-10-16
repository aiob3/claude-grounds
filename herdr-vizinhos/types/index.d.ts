export type EstadoHerdr = 'idle' | 'working' | 'blocked' | 'done' | 'unknown'
export type AgenteVizinho = { pane: string; estado: EstadoHerdr; titulo: string }
export type Vizinho = { workspace: string; rotulo: string; estado: EstadoHerdr; agentes: AgenteVizinho[] }

declare module 'claude-code' {
  interface PluginState {
    /** O último estado de cada pane vizinho (para ver a mudança), os avisos ainda não entregues ao modelo e os vizinhos escritos. */
    'herdr-vizinhos': { estados: Record<string, string> | null; pendentes: string[]; vizinhos: Vizinho[] }
  }
}
