# Acionamento do herdr

Este documento diz quando e como um agente usa o herdr para dividir trabalho. O mod `herdr-vizinhos` é a primeira peça. Hoje ele mostra os outros workspaces e avisa quando um agente vizinho fica esperando o operador ou termina. As outras peças estão descritas abaixo, com o que já existe e o que falta.

## Três modos de acionamento

São três coisas diferentes, e cada uma tem o seu gatilho.

| Modo | O que faz | Quando vale |
|---|---|---|
| **Prompt** | Gera a instrução para o operador colar ou para o agente seguir uma vez. | Pedido avulso, sem herdr ligado. |
| **Habilitado** | Enquanto o herdr estiver ligado (`HERDR_ENV`), o agente considera o herdr em todo planejamento, sem precisar de lembrete. | Sessão dentro do herdr com o mod instalado. |
| **Validado** | Antes de executar, o plano mostra por que vai em paralelo ou não, e com qual meio. | Todo plano com mais de uma frente. |

O modo habilitado é o padrão dentro do herdr. O agente não pergunta se deve considerar o herdr: ele considera e mostra a decisão no plano.

## As quatro etapas

### 1. Planejamento

O plano sai em frentes, e a estrutura do herdr espelha essa divisão:

- **workspace** = projeto (um repositório, uma raiz);
- **tab** = frente de trabalho dentro do projeto;
- **pane** = um agente com um perfil definido no planejamento (quem pesquisa, quem implementa, quem revisa).

Cada frente vira uma pendência do objetivo, com dono (o próprio agente, um agente delegado ou o operador).

### 2. Prompt

Cada pane recebe um briefing próprio: o objetivo da frente, os arquivos dela, o que conta como feito e o que não pode tocar. O briefing fica num arquivo da pasta da frente, para que o agente delegado não dependa da conversa de quem o criou.

### 3. Validação do disparo

Antes de abrir panes, o plano responde a três perguntas:

1. **Paralelo ajuda?** Frentes que mexem nos mesmos arquivos ou dependem uma da outra vão em fila.
2. **Qual meio?** Um subagente ou workflow dentro da sessão, quando o trabalho é curto e o resultado volta para ela. Um pane do herdr, quando a frente é longa, precisa de um terminal próprio ou deve sobreviver à sessão que a criou.
3. **Qual harness?** O herdr inicia vários agentes de linha de comando (`claude`, `codex`, `gemini` e outros). A fila pode ir para outro harness quando isso tem motivo: outro fornecedor como adversário, custo ou uma ferramenta que só um deles tem.

A resposta entra no plano em uma linha por frente, por exemplo: "frente B: pane do herdr, codex, porque revisa o código da frente A com outro modelo".

### 4. Execução visível

O operador vê o que está rodando sem perguntar:

- **painel do objetivo:** a seção OUTROS WORKSPACES mostra cada workspace e o estado dele (ocioso, trabalhando, esperando você, concluído). Isso já existe;
- **faixa acima do prompt:** aparece só quando alguém espera o operador ou terminou. Isso já existe;
- **aviso ao agente:** a mudança chega ao modelo no próximo resultado de ferramenta, com a regra de que a sessão de outro workspace é do operador. Isso já existe;
- **pendência com agente como dono:** a frente delegada aparece na fila com o pane responsável e só é concluída quando o herdr informa que terminou e o resultado passa pela prova. Isso ainda falta (roadmap).

## O que existe e o que falta

| Peça | Estado |
|---|---|
| Ver os outros workspaces e ser avisado (etapa 4, leitura) | feito: `herdr-vizinhos` 0.1.0 |
| Modo habilitado: a regra vai em todo pedido quando o herdr está ligado (inteira no primeiro e depois de compactar) | feito: `herdr-vizinhos` 0.2.0 |
| Validação do disparo: com duas ou mais frentes do Claude, a linha do pedido cobra o disparo de cada uma até ser declarado (`objetivo`, acao `disparo`: modo, meio, harness), e o painel mostra o meio (⇉ herdr·codex) | feito: `contexto-bar` 0.18.0 |
| Briefing por frente num arquivo (etapa 2) | roadmap |
| Pendência com agente como dono (`agent wait` + prova) | roadmap (Fase 2) |
| Fila distribuída para outro harness | roadmap (Fase 3) |

## Regras que não mudam

- A sessão de outro workspace é do operador. O agente avisa e não responde por ela, mesmo quando ela está esperando.
- Fora do herdr, nenhum dos mods depende dele. O `contexto-bar` e o `prova-de-teste` funcionam igual sem o `herdr-vizinhos`.
