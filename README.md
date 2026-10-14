<p align="center"><img src="assets/capa.svg" alt="claude-grounds: On what grounds?" width="100%"></p>

<p align="center"><a href="https://github.com/aiob3/claude-grounds/actions/workflows/testes.yml"><img alt="testes" src="https://github.com/aiob3/claude-grounds/actions/workflows/testes.yml/badge.svg"></a> <img alt="Claude Code: mods" src="https://img.shields.io/badge/Claude_Code-mods-2a78d6?style=flat-square"> <img alt="hooks para configurar: nenhum" src="https://img.shields.io/badge/hooks_para_configurar-nenhum-0f7a3d?style=flat-square"> <img alt="falhas reais achadas: 45" src="https://img.shields.io/badge/falhas_reais_achadas-45-0f7a3d?style=flat-square"> <img alt="licença: MIT" src="https://img.shields.io/badge/licença-MIT-52514e?style=flat-square"></p>

claude-grounds são dois mods para o Claude Code. O `contexto-bar` mantém o objetivo da tarefa à vista e guardado,
para você e para o agente, de uma sessão para outra. O `prova-de-teste` não deixa um teste novo virar "pronto" sem
antes enfrentar mutantes escolhidos por um modelo que nunca viu esse teste. Os dois se instalam com um comando e
trazem os próprios eventos, ferramentas e telas: não há hook para escrever nem `settings.json` para editar.

## O que muda no dia a dia

- O agente declara o objetivo e as pendências, e você acompanha numa faixa acima do prompt e num painel ao lado.
- O objetivo fica gravado por projeto. Fechar a sessão, reiniciar a máquina ou abrir outra sessão em paralelo não
  apaga nada: na próxima vez, ele volta inteiro.
- A cada pedido, o agente recebe uma linha com o objetivo e o que falta. Ninguém precisa reexplicar onde parou.
- A barra mostra o progresso e estima quanto da janela de contexto o restante vai custar, aprendendo com as
  entregas já feitas. Se não couber, o agente é avisado antes da compactação, e a estimativa se refaz depois dela.
- A fila é compartilhada: cada pendência tem dono, e a faixa mostra quantas abertas são suas ("sua vez").
- Um teste novo passa por mutantes às cegas numa cópia do repositório, e o relatório mostra o que sobreviveu.
- O agente não consegue registrar um resultado melhor que o executado sem justificar, por escrito, cada mutante que
  sobreviveu.

## contexto-bar: o objetivo que não se perde

<p align="center"><img src="assets/demo/faixa.webp" alt="A faixa do contexto-bar em quatro momentos da mesma sessão: 0/5, 1/5, 3/5 e 5/5" width="100%"></p>

Quatro momentos da mesma sessão, recortados da gravação. A primeira linha divide a janela de contexto por origem
(sistema, CLAUDE.md e memória, MCP, skills, hooks, conversa, espaço livre e a reserva da compactação). A segunda
mostra o objetivo e o progresso, que sobe de 0/5 para 5/5 à medida que o agente conclui as pendências. A terceira é
a projeção: começa na estimativa padrão de 6k tokens por unidade (o asterisco) e, depois das primeiras entregas,
passa a usar a média medida na própria sessão, 3,4k.

<table>
<tr>
<td width="44%"><img src="assets/demo/painel.webp" alt="Painel do objetivo com as cinco pendências concluídas"></td>
<td>

**Memória por projeto.** Cada pasta de projeto tem o seu arquivo em `~/.claude/objetivos/`. Duas sessões em projetos
diferentes não se sobrescrevem.

**Atualização pelos dois lados.** O agente usa a ferramenta `objetivo` (definir, concluir, adicionar, priorizar,
reabrir, encerrar). Você usa `/objetivo`. A fila fica ordenada por prioridade: bloqueante, requisito, melhoria.

**Projeção da janela.** Cada pendência tem um tamanho (P vale 1 unidade, M vale 2, G vale 4). O consumo real de
cada entrega entra na média, e a soma do que falta é comparada com o espaço livre: cabe, apertado ou não cabe.

**Painel automático.** Com um objetivo ativo, o painel abre a cada pedido (`/objetivo auto off` desliga).

</td>
</tr>
</table>

Um trecho do arquivo que guardou o objetivo da sessão acima. Ele continua lá depois que a sessão termina:

```json
{
  "raiz": "~/Work/claude-grounds-demo",
  "objetivo": {
    "titulo": "Corrigir mediana([10, 9, 2]) → 9",
    "itens": [
      { "id": 2, "dono": "claude", "tamanho": "P", "nivel": "bloqueante", "feito": true },
      { "id": 4, "dono": "claude", "tamanho": "M", "nivel": "requisito", "feito": true }
    ],
    "consumo": [7545, 1335, 1232, 1369]
  }
}
```

| Você digita | O que acontece |
|---|---|
| `/objetivo` | abre o painel |
| `/objetivo Migrar o login :: testes verdes em produção` | define o objetivo e o passo que o encerra |
| `/objetivo feito 2 3` | conclui as pendências 2 e 3 |
| `/objetivo bloqueante 4` | sobe a pendência 4 para o topo da fila |
| `/objetivo meu revisar o contrato` | acrescenta uma pendência sua |
| `/objetivo encerrar` | encerra o objetivo do projeto |

## prova-de-teste: "pronto" com evidência

<p align="center"><img src="assets/demo/sessao.webp" alt="Sessão real do Claude Code corrigindo um bug com os dois mods, acelerada" width="100%"></p>

A mesma sessão, acelerada. O pedido era corrigir `mediana([10, 9, 2])`, que devolvia 2 em vez de 9 porque `sort()`
ordenava os números como texto. O projeto está em [claude-grounds-demo](https://github.com/aiob3/claude-grounds-demo)
para quem quiser repetir.

| | |
|---|---|
| <img src="assets/demo/01.webp" alt="Objetivo definido"> 1. O agente declara o objetivo e a faixa passa a acompanhar. | <img src="assets/demo/02.webp" alt="Red first"> 2. Red first: o teste novo falha antes da correção, 2 em vez de 9. |
| <img src="assets/demo/03.webp" alt="Correção e executar"> 3. Com o comparador numérico, o agente chama `executar`. | <img src="assets/demo/04.webp" alt="Estado FRACO e reforço"> 4. FRACO: um sobrevivente era falha real. O teste é reforçado e a mesma lista roda de novo. |
| <img src="assets/demo/05.webp" alt="Registro com equivalente falso"> 5. O agente alegou que um sobrevivente era equivalente. Não era: com lista par, `mediana([1,2,3,4])` dá 3 e o mutante dá 2. O log ganhou uma correção, e o `registrar` passou a exigir a justificativa de cada sobrevivente. | <img src="assets/demo/06.webp" alt="Painel do objetivo"> 6. O objetivo fechado em 5 de 5, com o painel aberto ao lado. |

<p align="center"><img src="assets/ciclo.svg" alt="Objetivo, execução isolada, mutantes cegos, testes e registro" width="100%"></p>

O `executar` copia o repositório para uma pasta temporária, pede os mutantes a um modelo sem ferramentas e sem
histórico, roda a linha de base, aplica um mutante por vez, roda os testes e restaura. O original não é tocado. O
`registrar` só aceita os números dessa execução, e um estado melhor que o executado exige a justificativa de cada
sobrevivente, gravada no log.

## Construído com ele mesmo

<p align="center"><img src="assets/linha-do-tempo.svg" alt="Linha do tempo das rodadas de calibração do instrumento" width="100%"></p>

Os dois mods foram escritos sob o próprio método: cada versão passou por uma rodada de mutantes escolhidos às cegas
antes de ser publicada, e o instrumento achou defeitos em si mesmo pelo caminho. Um mutante que não carregava contado
como morto, um caminho devolvido pelo modelo que fazia 18 mutantes não serem aplicados, um helper de teste tomado por
teste. A demo gravada acrescentou o último da lista: o `registrar` aceitava um estado melhor que o executado sem
justificativa.

<p align="center"><img src="assets/rodadas.svg" alt="45 falhas reais de teste encontradas" width="100%"></p>

As garantias de honestidade são mecânicas, não promessas:

- O log só cresce. Uma correção entra como linha nova e a original fica onde está.
- O `registrar` só aceita os números da última execução. Numa sessão real, ele recusou um registro de 13 mutantes
  mortos quando a execução tinha matado 10.
- Calibração não conta como medição. Rodada que acha defeito do instrumento, ou que o altera, fica fora da conta que
  decide se o método será promovido ([critérios e estado atual](CRITERIOS.md)).
- Os números deste README saem do log a cada publicação, por um gerador que barra termos privados.

## Sem hooks para configurar

Hooks do Claude Code são comandos de shell que você liga a eventos no `settings.json`. Funcionam bem para bloquear
ou anotar uma ação, mas cada um é um script solto, sem tela, sem estado próprio e sem ferramenta que o agente possa
chamar. Os dois mods trazem tudo isso dentro do pacote:

| | Hooks no `settings.json` | Os mods do claude-grounds |
|---|---|---|
| Instalar | editar o arquivo e escrever os scripts | `claude plugin install` |
| O agente pode chamar | nada | `objetivo`, `executar`, `registrar`, `mutantes` |
| Estado e memória | o script guarda onde conseguir | objetivo por projeto, última execução, log |
| Na tela | texto no terminal | faixa acima do prompt e painel lateral |
| Verificar o comportamento | à mão | `claude plugin test` em cada versão (CI neste repositório) |

## Instalar

```sh
claude plugin marketplace add aiob3/claude-grounds
claude plugin install contexto-bar@claude-grounds
claude plugin install prova-de-teste@claude-grounds
```

| Mod | Versão | Papel |
|---|---|---|
| [`contexto-bar`](contexto-bar/) | 0.7.0 | faixa de contexto, objetivo por projeto, painel e projeção da janela |
| [`prova-de-teste`](prova-de-teste/) | 0.6.0 | rodada de mutantes às cegas numa cópia isolada, relatório e log |

O log do `prova-de-teste` vai para `PROVA_DE_TESTE_LOG` ou, sem essa variável, para
`~/.claude/prova-de-teste/EXP-001-log.md`.

## Primeiros cinco minutos

```sh
git clone https://github.com/aiob3/claude-grounds-demo && cd claude-grounds-demo
claude
```

Cole o pedido da gravação: *"Bug: mediana([10, 9, 2]) devolve 2, mas o certo é 9. Corrija em src/estatistica.js.
Antes de mexer, defina o objetivo da tarefa. Escreva o teste que pega o bug e mostre ele falhando antes da correção
(red first). Depois da correção, prove o teste com a ferramenta executar do prova-de-teste e registre a rodada."*

Você deve ver a faixa com o objetivo, o teste falhando, o relatório do `executar` e o painel no fim. Feche a sessão,
abra outra na mesma pasta e digite `/objetivo`: o objetivo continua lá.

## Limites e próximos passos

- O `prova-de-teste` acha o comando de teste por convenção (`claude plugin test`, `npm test`, `pytest`). Para outro
  executor, passe `comando` ao `executar`.
- A equivalência de um sobrevivente continua sendo julgada pelo agente. O mod exige a justificativa e a grava no
  log, para auditoria, mas não a prova.
- A projeção da janela é uma estimativa: a média das últimas 8 entregas por unidade de tamanho.
- Os mods usam o runtime de plugins do Claude Code e foram testados na versão 2.1.300.

Em aberto: chegar a 10 medições com o instrumento parado (0 até agora) antes de decidir se o método
vira critério; guardar o histórico de consumo por projeto, independente do objetivo; observar se a média por
unidade se estabiliza entre sessões.

## Avaliar

[Critérios e estado](CRITERIOS.md) · [Log das rodadas](log/EXP-001-log.md) · [Diário](DIARIO.md) · [Protocolo](prova-de-teste/PROTOCOLO.md)

<details>
<summary><b>De onde vem o nome</b></summary>

No modelo de argumentação de Toulmin, *grounds* é a evidência que sustenta uma afirmação:

| Toulmin | Aqui |
|---|---|
| *claim* | "a tarefa está feita", declarada no objetivo (`contexto-bar`) |
| *grounds* | red first e o relatório com cada mutante (`prova-de-teste`) |
| *rebuttal* | mutantes escolhidos às cegas por um modelo que não viu os testes |
| *qualifier* | o estado: PROVADO, PROVADO-PARCIAL, FRACO ou NÃO VERIFICADO |
</details>

<details>
<summary><b>O método de teste em cinco passos</b></summary>

1. Red first: o teste novo falha antes da correção, ou com a linha central da implementação quebrada.
2. Pelo menos um mutante em cada categoria que se aplique ao diff (borda ou vazio, empate ou ordem, null ou
   inválido, condição invertida), aplicados um por vez, com a restauração conferida.
3. Os mutantes vêm de um modelo sem ferramentas e sem histórico, que recebe só o diff do código-fonte.
4. Cada sobrevivente é reforçado até morrer, ou justificado em uma linha como equivalente. Fora do escopo não é
   equivalência.
5. O relatório lista cada mutante e termina com o estado.
</details>

<details>
<summary><b>Recursos do runtime de plugins usados</b></summary>

- `$.model.complete`: um modelo isolado, sem ferramentas e sem o histórico da sessão, garante a escolha às cegas.
- `$.tool.register`: as ferramentas `objetivo`, `executar`, `registrar` e `mutantes`.
- `$.ui`: a faixa acima do prompt e o painel lateral.
- Eventos `prompt.submit`, `tool.call`, `turn.complete` e `session.compact`: a linha do objetivo a cada pedido, a
  faixa atualizada depois de cada ferramenta e a estimativa refeita depois da compactação.
- `$.fs`: o objetivo de cada projeto num arquivo próprio.
- `claude plugin test` e `claude plugin validate` em cada versão e no CI.
</details>

---

Projeto independente e não oficial, sem afiliação com a Anthropic nem endosso dela. Licença MIT.
Referências: "Mutation testing is AWESOME" (Matt Pocock); *Practical Mutation Testing at Scale* (Google);
*Mutation-Guided LLM-based Test Generation at Meta* (arXiv 2501.12862).
