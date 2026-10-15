<p align="center"><img src="assets/capa.svg" alt="claude-grounds: On what grounds?" width="100%"></p>

<p align="center"><a href="README.en.md">English</a> · <b>Português</b></p>

<p align="center"><a href="https://github.com/aiob3/claude-grounds/actions/workflows/testes.yml"><img alt="testes" src="https://github.com/aiob3/claude-grounds/actions/workflows/testes.yml/badge.svg"></a> <img alt="Claude Code: mods" src="https://img.shields.io/badge/Claude_Code-mods-2a78d6?style=flat-square"> <img alt="hooks para configurar: nenhum" src="https://img.shields.io/badge/hooks_para_configurar-nenhum-0f7a3d?style=flat-square"> <img alt="falhas reais achadas: 49" src="https://img.shields.io/badge/falhas_reais_achadas-49-0f7a3d?style=flat-square"> <img alt="licença: MIT" src="https://img.shields.io/badge/licença-MIT-52514e?style=flat-square"></p>

Quando o agente do Claude Code diz "pronto, testado", como você confere? O claude-grounds transforma essa frase num
ciclo. Antes de começar, o agente declara o que é "pronto", com a prova dentro. A cada pedido, a prova pendente
volta à frente dele. A prova roda às cegas, e o objetivo só fecha quando o registro cumpre o que foi declarado. O
objetivo e a prova ficam gravados, e a próxima sessão retoma com a evidência junto.

São dois mods do Claude Code (plugins cujo código roda dentro dele, disponíveis desde a versão 2.1.287) que
funcionam em par: o `contexto-bar` guarda e mostra a afirmação, o `prova-de-teste` produz o fundamento dela. Cada um
se instala sozinho, e não há hook para configurar.

## O ciclo, numa sessão real

<p align="center"><img src="assets/demo/sessao.webp" alt="Sessão real do Claude Code percorrendo o ciclo, acelerada" width="100%"></p>

O pedido era corrigir `mediana([10, 9, 2])`, que devolvia 2 em vez de 9 porque `sort()` ordenava os números como
texto. O projeto está em [claude-grounds-demo](https://github.com/aiob3/claude-grounds-demo) para quem quiser repetir.

### 1. Declarar

<p align="center"><img src="assets/demo/01.webp" alt="O agente define o objetivo com a prova dentro" width="100%"></p>

O objetivo nasce com a prova dentro dele: ler o código, mostrar o teste falhando, corrigir, provar com o
`executar`, registrar a rodada. A conclusão declarada não é "corrigi". É "a rodada de prova registrada com os
números do relatório". Cada pendência tem dono, tamanho e prioridade. Ao declarar, o agente recebe uma checagem
de alinhamento: a conclusão descreve o efeito que se quer, e não só um artefato? Cada pendência aproxima dela? E a
cada pedido a linha do objetivo pergunta se a próxima ação serve à conclusão.

### 2. Acompanhar

<p align="center"><img src="assets/demo/faixa.webp" alt="A faixa em quatro momentos: 0/5, 1/5, 3/5 e 5/5" width="100%"></p>

A cada pedido, o agente recebe uma linha com o objetivo e o que falta, então a prova pendente fica na frente dele
até o fim. A faixa divide a janela de contexto por origem, mostra o progresso (0/5, 1/5, 3/5, 5/5 nos recortes
acima) e projeta se o restante cabe antes da compactação. A projeção aprende com a sessão: começa no padrão de 6k
tokens por item (o asterisco) e passa à média medida, 3,4k. Se não couber, o agente é avisado antes.

### 3. Provar

<table>
<tr>
<td width="50%"><img src="assets/demo/02.webp" alt="Red first: o teste falha antes da correção"></td>
<td width="50%"><img src="assets/demo/04.webp" alt="FRACO: um sobrevivente real, o teste é reforçado"></td>
</tr>
</table>

Primeiro o red first: o teste novo falha antes da correção, 2 em vez de 9. Depois da correção, o `executar` copia o
repositório para uma pasta temporária, pede mutantes a um modelo sem ferramentas e sem histórico, que só vê o diff
do código, e roda os testes contra cada um. Deu FRACO: um mutante sobreviveu porque nenhum teste via o primeiro
elemento da lista. O teste foi reforçado e a mesma lista rodou de novo. Enquanto isso, a pendência "provar" seguia
aberta na faixa.

### 4. Registrar e fechar

<table>
<tr>
<td width="56%"><img src="assets/demo/05.webp" alt="O agente registra alegando um equivalente"></td>
<td><img src="assets/demo/painel.webp" alt="Painel do objetivo em 5 de 5"></td>
</tr>
</table>

O `registrar` só aceita os números da última execução. A demo mostrou o que faltava: o agente registrou
PROVADO-PARCIAL alegando que um sobrevivente era equivalente, e não era (com lista par, `mediana([1,2,3,4])` dá 3 e
o mutante dá 2). O log ganhou uma linha de correção, e o `registrar` passou a exigir a justificativa escrita de cada
sobrevivente, gravada no log. O objetivo chega a 5/5 quando a conclusão declarada se cumpre.

### 5. Continuar

O objetivo fica num arquivo por projeto, e a prova fica no log. Fechar a sessão, reiniciar a máquina ou abrir outra
sessão em paralelo não apaga nada. Um trecho do arquivo que guardou o objetivo da sessão acima:

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

<p align="center"><img src="assets/ciclo.svg" alt="O ciclo: objetivo, execução isolada, mutantes cegos, testes e registro" width="100%"></p>

### Por que os dois juntos

Um objetivo sem prova é uma lista que o agente marca como feita sozinho. Uma prova sem objetivo é um relatório que
ninguém pediu e que se perde quando a sessão acaba. Juntos, a afirmação de "pronto" vem declarada antes, fica à
vista durante o trabalho e só fecha com fundamento registrado. Os mods não chamam um ao outro: o elo é o próprio
fluxo do agente, que recebe o objetivo a cada pedido e registra a prova no fim.

## Construído com ele mesmo

<p align="center"><img src="assets/linha-do-tempo.svg" alt="Linha do tempo das rodadas de calibração do instrumento" width="100%"></p>

Os dois mods foram escritos sob o próprio método: cada versão passou por uma rodada de mutantes escolhidos às cegas
antes de ser publicada, e o instrumento achou defeitos em si mesmo pelo caminho. Um mutante que não carregava contado
como morto, um caminho devolvido pelo modelo que fazia 18 mutantes não serem aplicados, um helper de teste tomado por
teste. A demo gravada acrescentou o último da lista: o `registrar` aceitava um estado melhor que o executado sem
justificativa.

<p align="center"><img src="assets/rodadas.svg" alt="49 falhas reais de teste encontradas" width="100%"></p>

As garantias de honestidade são mecânicas, não promessas:

- O log só cresce. Uma correção entra como linha nova e a original fica onde está.
- O `registrar` só aceita os números da última execução. Numa sessão real, ele recusou um registro de 13 mutantes
  mortos quando a execução tinha matado 10.
- Calibração não conta como medição. Rodada que acha defeito do instrumento, ou que o altera, fica fora da conta que
  decide se o método será promovido ([critérios e estado atual](CRITERIOS.md)).
- Os números deste README saem do log a cada publicação, por um gerador que barra termos privados.

## Sem hooks para configurar

Sem settings hooks para configurar e sem gate que trave o agente. A etapa que o agente costuma pular, provar o que
fez, até agora só era garantida com um gate num hook, em algum ponto do processo, travando o agente ali. Aqui ela
entra no próprio ciclo: é declarada no objetivo, volta à frente do agente a cada pedido e é a condição para fechar.
Não some, e nada trava. (Impedir ações destrutivas é outro problema, de segurança, e não é o que estes mods fazem.)

Os settings hooks do Claude Code são comandos de shell, chamadas HTTP ou prompts que você liga a eventos no
`settings.json`. Funcionam bem para bloquear ou anotar uma ação, mas rodam fora do Claude Code: não desenham na
tela, não guardam estado próprio e não dão ao agente uma ferramenta para chamar. Um mod roda dentro dele, e os dois
mods trazem tudo isso no pacote (a documentação oficial tem a [comparação completa](https://code.claude.com/docs/en/plugins/mods#compare-mods-settings-hooks-skills-and-mcp-servers)):

| | Settings hooks (`settings.json`) | Os mods do claude-grounds |
|---|---|---|
| Instalar | editar o arquivo e escrever os scripts | `claude plugin install` |
| O agente pode chamar | nada | `objetivo`, `executar`, `registrar`, `mutantes` |
| Estado e memória | o script guarda onde conseguir | objetivo por projeto, última execução, log |
| Na tela | texto no terminal | faixa acima do prompt e painel lateral |
| Verificar o comportamento | à mão | `claude plugin test` em cada versão (CI neste repositório) |

Nenhum hook dos dois mods segura uma chamada. Os handlers só observam e acrescentam uma linha de contexto, e o rigor está em
outro lugar: nas ferramentas que o agente chama porque declarou que chamaria, e num registro que recusa número
inflado e equivalente sem justificativa. O agente trabalha livre, e o "pronto" sem fundamento não passa.

## Instalar

```sh
claude plugin marketplace add aiob3/claude-grounds
claude plugin install contexto-bar@claude-grounds
claude plugin install prova-de-teste@claude-grounds
```

| Mod | Versão | Papel |
|---|---|---|
| [`contexto-bar`](contexto-bar/) | 0.8.0 | faixa de contexto, objetivo por projeto, painel e projeção da janela |
| [`prova-de-teste`](prova-de-teste/) | 0.8.1 | rodada de mutantes às cegas numa cópia isolada, relatório e log |

O log do `prova-de-teste` vai para `PROVA_DE_TESTE_LOG` ou, sem essa variável, para
`~/.claude/prova-de-teste/EXP-001-log.md`. O agente usa as ferramentas `objetivo`, `executar` e `registrar`; você usa
o `/objetivo`:

| Você digita | O que acontece |
|---|---|
| `/objetivo` | abre o painel |
| `/objetivo Migrar o login :: testes verdes em produção` | define o objetivo e o passo que o encerra |
| `/objetivo feito 2 3` | conclui as pendências 2 e 3 |
| `/objetivo bloqueante 4` | sobe a pendência 4 para o topo da fila |
| `/objetivo meu revisar o contrato` | acrescenta uma pendência sua |
| `/objetivo encerrar` | encerra o objetivo do projeto |

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
- Os mods exigem o Claude Code 2.1.287 ou mais recente (a versão em que os mods chegaram) e foram testados na
  2.1.300. Funcionam no terminal e na aba Code do app Desktop.

Em aberto: chegar a 10 medições com o instrumento parado (2 até agora) antes de decidir se o método
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
