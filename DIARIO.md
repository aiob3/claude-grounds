# Experimento: mods locais do Claude Code

Diário de um experimento operacional: usar mods (plugins locais do Claude Code) no trabalho do dia a dia e observar, versão a versão, o que eles mudam na colaboração entre operador e Claude.

- **Repositório:** um repositório privado de trabalho, instalado no escopo user a partir da pasta local
- **Mods em teste:** `contexto-bar`; `prova-de-teste` (desde 0.1.0, instrumento do EXP-001 do harness)
- **Início:** 2026-10-14

## Hipóteses

1. **Visibilidade da janela.** Mostrar acima do prompt quanto do contexto está ocupado, e por quê (sistema, memória, MCP, skills, hooks, conversa), ajuda a decidir quando compactar, delegar ou registrar o estado.
2. **Objetivo compartilhado.** Uma segunda camada com o objetivo em curso, as pendências por dono (Claude ou operador) e a projeção de janela mantém os dois alinhados em tarefas longas e deixa claro de quem é a vez.
3. **Projeção aprendida.** Medir o contexto gasto por pendência concluída, ponderado por tamanho (P=1, M=2, G=4), dá uma estimativa útil de se o resto do trabalho cabe na janela.

## O que observar

- O objetivo é definido no começo das tarefas com etapas, ou só quando o operador pede?
- As pendências são marcadas na hora em que são feitas, ou ficam atrasadas ("sem atualização há N turnos")?
- A estimativa por unidade converge? Quanto ela erra contra o consumo real?
- O aviso de janela chega a tempo de mudar uma decisão?
- O que o operador faz com o painel `/objetivo`: abre, ignora ou usa para cobrar?
- Que atrito o mod cria: ruído no contexto, tokens gastos com a linha `[objetivo]`, chamadas extras.

## Linha do tempo

### 0.1.0 a 0.3.0 (2026-10-14, madrugada e manhã)
- Barra de contexto em 8 grupos, atualizada no início do turno, depois de cada ferramenta e no fim do turno; a estimativa de Hooks zera na compactação.
- Camada de objetivo: ferramenta `objetivo` para o Claude, comando `/objetivo` para o operador (sem argumento abre o painel), linha `[objetivo]` injetada a cada prompt e aviso de janela quando a projeção piora.
- Decisão do operador: os dois definem o objetivo, e o aviso chega também ao Claude.

### Incidente (2026-10-14, 14:20)
- A interface gráfica travou durante uma sessão de desenvolvimento dos mods. Precisou reiniciar no botão.
- **Causa:** não era o mod. A janela BAR1 da GPU NVIDIA tinha só 256 MiB (Resizable BAR desligado) e esgotou ao restaurar uma sessão pesada do Chrome. Resolvido ligando Above 4G Decoding e Re-Size BAR na BIOS: BAR1 passou a 16 GiB, sem erros.
- **Lição para o experimento:** os arquivos do mod sobreviveram intactos, mas não havia controle de versão e `/home` não entra nos snapshots do sistema. Daí o repositório privado.

### 0.3.0: o que a reinicialização mostrou
- O mod continuou instalado e ativo em todas as sessões (escopo user, lido direto da pasta-fonte).
- **Mas o objetivo se perdeu:** ele vivia só no `$.state` da sessão. Um objetivo em andamento ("Ativar Resizable BAR") sumiu quando a sessão recomeçou. Isso contraria a hipótese 2 para tarefas que atravessam sessões.

### 0.4.0 (2026-10-14, tarde)
- O objetivo passa a ser gravado no `$.store` do mod (um arquivo JSON do plugin, que dura entre sessões), sob a chave `objetivo:<raiz do projeto>`.
- Ele é retomado ao abrir a sessão e a cada prompt, o que também cobre `/cd` entre projetos. Cada pasta tem o seu objetivo.
- Na sessão nova, o marco de consumo, o contador de turnos e o aviso recomeçam: eram medidas da sessão anterior.
- Gravar é melhor esforço: se o store falhar, o objetivo continua valendo na sessão.
- Pego antes de usar: o primeiro `/reload-plugins` numa sessão já aberta encontraria o store vazio e apagaria o objetivo em curso. Correção: na primeira carga, um objetivo que só existe no `$.state` vale e passa a ser gravado (função pura `aoCarregar`, com teste unitário: o kit de testes não simula reload do módulo).
- 15 testes passando, incluindo ida e volta entre duas pastas.

### 0.5.0 (2026-10-14, fim da tarde)
- Pedido do operador: um critério de continuidade para repriorizar o que já está em curso, sem burocracia. Um campo só, com três estados: **bloqueante** (trava outra pendência ou a entrega; vem primeiro), **requisito** (preciso para a entrega; é o padrão) e **melhoria** (pode esperar).
- A fila sai na ordem nível → ordem de entrada. A barra mostra a **próxima** pendência (em vermelho se for bloqueante, com "(sua)" se for do operador). A linha ao modelo segue a ordem e marca só o que não é requisito. Repriorizar: ferramenta `priorizar` (ids + nível) ou `/objetivo bloqueante 3`.
- Objetivos gravados antes da 0.5.0 não têm nível e contam como requisito.
- Primeira tarefa sob o experimento **EXP-001 Prova de Teste** do harness: 9 mutantes manuais no diff, 9 mortos, cerca de 10 s; R1 feito quebrando a linha central do `ordenar`. O relatório foi contestado pelo agente que desenhou o EXP-001: só trazia a contagem, e 9/9 escolhidos por quem escreveu os testes sugere viés de seleção. **A auditoria confirmou:** 7 mutantes das categorias empate, vazio, null e condição invertida deram 4 sobreviventes (desempate por id, "tudo feito" devolvendo um item feito, nível inválido aceito, nível null). Testes reforçados: 7/7 mortos, 18 testes. Lição: o estado real da rodada era FRACO.

### Observação lateral (2026-10-14)
- O harness global (o harness local) estava desligado nesta máquina desde a reinstalação do sistema: sem `~/.claude/CLAUDE.md` e sem os hooks dele. O operador notou que, nesta sessão, a colaboração voltou ao comportamento esperado. **Hipótese, não verificada:** as regras e as injeções do harness pesavam contra. Vale comparar sessões com e sem ele antes de religar.

## prova-de-teste

### Por que um mod e não regra em texto (2026-10-14)
- No harness, o EXP-001 é texto que o agente lê e segue: o relatório continua sendo o agente falando do próprio trabalho, o defeito que a rodada 1 expôs. Um mod percebe sozinho a tarefa com teste, isola fisicamente quem escolhe os mutantes e, na F2, aplica e roda os mutantes ele mesmo.
- Entra como **instrumento do experimento, sem bloquear**. A promoção a padrão segue o critério de saída do EXP-001 (achados reais em ≥3 tarefas, tempo médio < 2 min) e é decisão do operador.

### 0.1.0 — F1 (2026-10-14)
- Lembrete: editar um arquivo de teste (convenções JS/TS, Python, Go, Rust) injeta o protocolo uma vez por turno. Falha no lembrete nunca atrapalha a edição.
- `/prova [base]` e ferramenta `mutantes`: `git diff` do repositório (com arquivos novos), testes retirados, só o código-fonte vai a `$.model.complete`, **sem ferramentas e sem histórico**, que devolve `arquivo:linha | categoria | mutação`. O retorno diz o que foi enviado, o que foi retirado e quais categorias ficaram sem mutante.
- Ferramenta `registrar`: valida e grava a linha v1.1 no log do EXP-001, com commit no git do harness.
- Achados no próprio desenvolvimento: (1) mutações contêm `|` (como `||`), e a leitura cortava o texto; (2) o git do Omarchy usa `diff.mnemonicprefix=true` (prefixos `1/` e `2/`), o que trocaria os caminhos: o mod agora fixa o formato do diff.
- **Rodada 2 do EXP-001 (v1.1):** R1 quebrando a linha que tira os testes do envio (3 testes falharam). R2.1 por subagente que leu só o diff: 13 mutantes, **4 sobreviventes reais** (arquivo renomeado, linha em branco, n/a sem motivo, `arquivo:` sem número). Reforço: 13/13. Concentração 4/13. 134 s de ponta a ponta.
- Observação para a F2: o subagente errou o número de linha em 2 dos 13 mutantes (por 6 linhas). Aplicar por trecho, não por número, foi o que funcionou.

### 0.1.1 (2026-10-14, noite)
- Primeiro uso real pelo operador: `/prova` falhou com "~/Work não é um repositório git", mesmo depois de `/add-dir um repositório local (o mod só olhava a pasta da sessão). Num repositório, funcionou: o modelo isolado mandou 8 mutantes para um tema do Obsidian (JSON e CSS) e marcou corretamente 3 categorias como não aplicáveis. Mas o diff **não tinha teste nenhum**: mutantes sem teste não provam nada.
- Correções: `/prova [pasta] [base]` em qualquer ordem (`~`, `/`, `./`, `../`); a mensagem de erro ensina a passar a pasta; aviso quando o diff não tem teste ("não registre como rodada").
- **Rodada 3, a primeira com isolamento real** (`$.model.complete`, sem ferramentas; os 2 arquivos de teste retirados antes do envio): 17 mutantes, 7 sobreviventes no 1º passe → **4 reais** (`../` não reconhecido; aviso errado com exatamente 1 teste; sem HOME, `~/x` virava `/x`, um bug que já existia; falha ao ler HOME derrubava o comando), 2 lacunas de especificação (argumento repetido: agora vale o último) e 1 equivalente (dica de interface). Final 16/17. 135 s. Registrada pela própria ferramenta `registrar`, com commit no harness.
- Com isso: **3 tarefas com sobreviventes reais** (rodadas 1, 2 e 3), o mínimo do critério de saída; o tempo médio passa um pouco de 2 min (a decisão é do operador).

### 0.2.x — F2: o mod executa a rodada (2026-10-14, fim da tarde)
- Ferramenta `executar`: cópia isolada (`cp --reflink`), linha de base, mutantes pelo trecho, testes por plugin tocado, restauração conferida, original intocado (`git status` antes e depois), relatório v1.1 escrito pelo mod. O `registrar` passou a recusar números diferentes dos executados.
- **Rodada 4, executada pelo próprio mod sobre si, em 3 execuções.** Na 1ª, o mod falhou honestamente: caminhos curtos vindos do modelo fizeram 18 mutantes não serem aplicados, e o estado foi NÃO VERIFICADO, sem resultado inventado. Na 2ª: 17/15/2, com 2 sobreviventes reais e **1 morte falsa** (o mutante nem carregou e foi contado como morto). Na 3ª, com lista nova: 19/16/3, com 3 sobreviventes reais, um deles um **laço infinito** com trecho vazio. Todos foram reforçados. A prova de que o reforço mata os mesmos mutantes ficou para a rodada 5.
- O instrumento se corrigiu com o próprio protocolo: caminho curto, dois plugins no mesmo diff, arquivo sem teste, mutante inválido, trecho com seta, plugin na raiz.
- Pedido do operador: o painel do objetivo abre sozinho a cada pedido (contexto-bar 0.6.0).
- **Pedido do operador: recarga automática na lista de validação.** Foram 4 `/reload-plugins` manuais na rodada 4. Os mods passaram a ser carregados por `CLAUDE_CODE_PLUGIN_DIRS` (pasta vigiada): salvar recarrega antes da próxima ferramenta do mod. É isso que permite ao ciclo de auto-correção se validar sem o operador. Efeito colateral encontrado antes de virar problema: o `$.store` é por id de plugin, então o objetivo salvo precisa ser migrado de @marketplace para `@inline`.

### Sessão nova com recarga automática (2026-10-14, noite)
- **Migração do `$.store`:** editar o JSON do store por fora **não funciona com a sessão aberta**. O host guarda o store em memória e, na recarga seguinte do mod, regravou o arquivo com a cópia dele (44 ms depois de salvar o fonte), apagando a mesclagem. O que funcionou foi passar pelo próprio mod: `definir` com os 18 itens na mesma ordem (os ids se mantiveram) e `concluir` nos que já estavam feitos. Perdeu-se só o histórico de consumo (marco/consumo).
- **Recarga automática validada (#16):** uma marca temporária no texto do resumo (`objetivo.ts`) apareceu já na chamada seguinte da ferramenta, no mesmo turno, e o objetivo sobreviveu à recarga. Só `touch` não basta: é preciso mudar o conteúdo.
- **Painel automático:** no 1º pedido da sessão ele não abriu, porque o objetivo ainda não estava no store novo; abriu logo depois do `definir`. Falta conferir no próximo pedido.
- **Rodada 5 (executada pelo mod, base 52f6a98):** 15/13/2, com **2 sobreviventes reais**: `package.json` sem script de teste virava `npm test`, e nada conferia que a execução é gasta no `registrar`. Reforço com 2 testes; `executar` com `repetir` (mesma lista) deu **15/15/0, PROVADO**, em 19 s. O mutante #1 veio do escolhedor com o caminho malformado (`execucao.ts:prova-de-teste/hooks/execucao.ts:204`); o mod recusou e ele foi aplicado à mão: morto. Melhoria para o instrumento: aceitar `arquivo:caminho:linha` pegando o último segmento que resolve.
- Pela 1ª vez o ciclo editar → testar → executar → registrar rodou inteiro **sem nenhum `/reload-plugins`**.

### contexto-bar 0.7.0 + prova-de-teste 0.2.2 — objetivo por projeto (2026-10-14, noite)
- **Achado do 1º uso em paralelo** (operador num projeto privado + esta sessão em `~/Work`): o objetivo de `~/Work` sumiu do disco. O `$.store` é um arquivo só para todos os projetos; cada sessão guarda o arquivo inteiro na memória e o regrava inteiro, então quem grava por último apaga as chaves da outra. Não dava para prever com uma sessão só.
- **Correção estrutural:** o objetivo saiu do `$.store` e passou a um arquivo por projeto, `~/.claude/objetivos/<encodeURIComponent(raiz)>.json` (`{ raiz, objetivo }`). O nome nunca repete para pastas diferentes. Se o arquivo existe, vale ele, mesmo dizendo "sem objetivo"; senão, o objetivo migra do store uma vez, e a chave só é apagada depois de o arquivo ser gravado. Sem `HOME`, cai no store. O store ficou só com o `painel-auto`. As duas sessões migraram sozinhas na recarga.
- **O objetivo F2** (16/18) foi fechado aqui: o #8 o operador fez no repositório real e a decisão do EXP-001 passou ao objetivo novo.
- **Instrumento** (retorno do agente de um projeto privado + a mesma falha nesta rodada): o "não carregou" procurava `SyntaxError` na saída inteira. Uma morte cujo teste falhava com `JSON.parse` virava "inválido": 2 mortes reais escondidas aqui, 2 no `server.js` de lá. Agora só vale o erro na coluna 0, onde o carregador escreve. A atribuição ganhou o `node --test` (spec e TAP), que antes dava sempre "código de saída 1" e um alarme falso de concentração.
- **Rodada 6:** 12/7/5 na 1ª execução (com 3 falsos "não carregou"); reforço + instrumento corrigido → 15/14/1, com o único sobrevivente equivalente (`undefined` ≡ `null` no `aoCarregar`) e +1 mutante manual fora da área concentrada, morto. PROVADO.
- **Ainda abertos no instrumento:** `test/helpers/` contado como teste (a correção do operador não foi mutada); arquivos fora do git e não-código (`.gitignore`, `.spec/*.md`, `EXPERIMENTO.md`) enviados ao escolhedor; caminho malformado `arquivo:caminho:linha`.

### prova-de-teste 0.3.0 — o que o repositório real mostrou (2026-10-14, noite)
- **Helper é código:** dentro da pasta de teste, `helpers/`, `support/` e `utils/` passam a ser fonte, porque podem ser a correção da tarefa. O nome de teste (`.test.`, `test_*.py`) continua valendo, e `fixtures/` segue como teste, porque traz os valores esperados.
- **Não-código fora do envio:** documentação, dotfiles de ferramenta, lockfiles e imagens não vão ao escolhedor; são listados no relatório. JSON, YAML e CSS continuam, porque podem ter comportamento.
- **Fora do git:** aviso quando mais da metade do envio é de arquivos não versionados (o caso do `src/` de um projeto privado), e parâmetro `novos: false` para deixá-los de fora.
- **"Não carregou" diz por quê:** o relatório mostra a primeira linha do erro de carga. Foi isso que, logo na rodada 7, denunciou mais 2 falsos "não carregou": o `the file did not load` citado no código de um teste que falhava também casava. Agora vale só na coluna 0, como o `(fail)` do executor.
- **Caminho:** `arquivo:caminho` resolve se os pedaços derem num arquivo só (senão, "ambíguo"), e a pasta repetida na frente (`mod/mod/hooks/x.ts`) também resolve.
- **Rodada 7** (o mod sobre si): 18/11/7, com 6 sobreviventes reais e 1 equivalente (uma checagem redundante, removida); reforço 18/18/0 com a mesma lista; +1 mutante manual na regra nova, morto. PROVADO.
- **Padrão que se repete:** desde a rodada 4, cada rodada do mod sobre si acha ao menos um defeito do próprio instrumento. O sinal sempre veio do relatório: um número que não fechava, ou um motivo estranho. Expor o motivo foi o que tornou o defeito visível.

### Decisão do operador sobre o EXP-001 (2026-10-14, noite)
- **Seguir até 10 rodadas** antes de promover ou ajustar. O operador validou o uso em paralelo: viu, na sessão de um projeto privado, cada recarga dos mods acontecer no momento em que foi feita aqui, e os dois objetivos sobreviveram (#5 do objetivo "arquivo por projeto").
- Até aqui: rodadas 1–7 sobre os próprios mods, mais 3 tarefas reais de um projeto privado (travamento do `npm test`, reforço do `src/` anterior, T-007). Todas tiveram sobreviventes reais.

### EXP-001 v1.2 + prova-de-teste 0.4.0 — calibração × medição (2026-10-14, noite)
- **Decisão do operador:** a contagem das 10 rodadas pondera as versões que nasceram dos próprios testes. A rodada que acha defeito do instrumento, ou que o altera, é **calibração** e não conta; só contam as **medições**, rodadas num instrumento que não mudou e sem defeito dele. O instrumento fica estável após 3 medições seguidas na mesma versão. O protocolo virou v1.2 e o log foi reclassificado com linhas novas: hoje são 9 calibrações e 2 medições (uma rota manual, uma no mod 0.2.2).
- **O `registrar` preenche a classe sozinho:** grava o instrumento (`mod <versão que executou>` ou `manual v1.2`) e marca calibração quando o diff mexe no próprio mod, quando a versão muda entre `executar` e `registrar`, ou quando o agente informa `defeitoInstrumento`.
- **Rodada 8:** 15/8/7 na 1ª execução. Entre os 6 sobreviventes reais, uma execução gravada antes da 0.4.0, sem versão, viraria "instrumento alterado: undefined→…". Reforço 11/11/0, mais 4 mutantes manuais no código que mudou de lugar com a refatoração, todos mortos. Foi a primeira linha v1.2, classificada pelo mod como calibração (o diff altera o próprio instrumento).
- **Repositório público:** decidido um repositório novo e público de avaliação, com os dois mods num mono repo (o marketplace já é assim e os mods não dependem um do outro). O log público leva só as rodadas sobre os mods.

### prova-de-teste 0.5.0 — instalável fora desta máquina (2026-10-14, noite)
- **Log configurável:** `PROVA_DE_TESTE_LOG`, ou `~/.claude/prova-de-teste/EXP-001-log.md`, criado com cabeçalho v1.2 se não existir. Se o caminho for um link, a linha vai ao arquivo real e o `git add` e o commit rodam na pasta dele. Aqui, o caminho padrão é um link para o log do harness, e as duas sessões abertas seguiram gravando no mesmo lugar sem reiniciar.
- **O protocolo viaja com o instrumento:** `prova-de-teste/PROTOCOLO.md` é o canônico; a cópia do harness aponta para ele.
- **Rodada 9:** 20/12/8 na 1ª execução, com 7 reais (a variável perdia para o HOME; variável vazia virava caminho vazio; HOME com falha derrubava o registrar...) e 1 equivalente; reforço 20/19/1. O mutante #18, aplicado à mão, sobreviveu: sem `git add`, um log novo nunca seria commitado. Reforçado e morto. Classificada pelo mod como calibração.

### Publicação: claude-grounds (2026-10-14, noite)
- O repositório público de avaliação está no ar em https://github.com/aiob3/claude-grounds (MIT), com autorização do operador. O nome vem do modelo de Toulmin: *claim* (o objetivo), *grounds* (a prova), *rebuttal* (os mutantes cegos), *qualifier* (o estado). O operador rejeitou "Bulletproof" por prometer o que o método nega e preferiu o prefixo `claude-`, porque o projeto parte do harness do Claude Code.
- O repositório é gerado por `publico/gerar.py`, que não vai a público: mods, protocolo, log só com as rodadas sobre os mods, diário anonimizado, critérios com a contagem calculada do log, e uma checagem que barra termos privados. Os visuais SVG animados (capa, ciclo, rodadas e terminal) também saem do log, e o gráfico de rodadas se atualiza a cada geração.
- O README e os critérios passaram pela skill humanizer (blader/humanizer), a pedido do operador.

### prova-de-teste 0.6.0 — o equivalente falso da demo (2026-10-14, noite)
- **Demo pública gravada pelo operador:** a mediana com sort() como texto. A sessão fez o que se esperava (objetivo, red first, correção, executar 5/2/3, reforço, repetir 5/3/2), mas registrou PROVADO-PARCIAL com 0 reais, justificando o sobrevivente "ordem decrescente" como equivalente porque lista par "não fazia parte deste bug". Não é equivalente: mediana([1,2,3,4]) dá 3 e o mutante dá 2, e nenhum teste usa lista par. Esse é exatamente o comportamento que o EXP-001 quer pegar. Uma linha de correção no log registra o estado real (FRACO, 1 real) e reclassifica a rodada como calibração.
- **Por que passou:** o `registrar` conferia os números da execução, mas aceitava qualquer estado declarado. Agora um estado melhor que o executado exige a justificativa de cada sobrevivente (`equivalentes`), que vai para a linha do log; PROVADO-PARCIAL não cabe numa execução do mod (ele aplica a escolha às cegas), e com categoria descoberta o teto é FRACO. O protocolo ganhou a regra: fora do escopo não é equivalência.
- **Rodada 10:** 15/11/4, com 2 reais, 1 código morto removido e 1 equivalente; reforço 13/12/1; o #13, aplicado à mão, morreu. Foi registrada como PROVADO pela regra nova, com a justificativa do #7 na linha.

### Sincronização e CI (2026-10-14, noite)
- **Ganchos `post-commit`** no repositório dos mods e no do log: a cada commit (ou rodada nova), o claude-grounds é regerado, sanitizado e publicado sozinho. O primeiro teste real mostrou um defeito do próprio script: um commit pendente não subia quando não havia mudança nova. Corrigido para sempre tentar o push.
- **CI público:** GitHub Action com o Claude Code 2.1.300, que valida o marketplace e roda os testes dos dois mods a cada push. Passou na primeira execução, e o selo aparece no topo do README.
- **A sessão real gravada pelo operador** entrou no README como animação e seis quadros, revisados à mão e por OCR. O operador cobrou com razão: eu tinha anunciado como pronto o que o GitHub ainda recusava (falta do escopo `workflow`). A lição é só dizer "publicado" depois de conferir o que está no ar.

### contexto-bar 0.8.0 — checagem de alinhamento (2026-10-14, noite)
- **A falha:** no lançamento, eu (Claude) repeti duas vezes o mesmo molde errado, apresentando os mods como itens separados quando eles formam um ciclo só. O diagnóstico do operador: as pendências saíam do texto do pedido (artefatos), e não do efeito que a entrega precisava causar, e o contexto-bar guardava a conclusão sem perguntar se a próxima ação servia a ela.
- **A alavanca:** como no equivalente falso, a falha virou mecanismo. Ao definir ou acrescentar pendências, a ferramenta devolve uma checagem ("a conclusão descreve o efeito? cada pendência aproxima dela? alguma mostra que o efeito aconteceu?"), e a linha de cada pedido pergunta se a próxima ação aproxima da conclusão. O objetivo do lançamento foi redefinido pelo efeito (gente de fora entende o ciclo e experimenta, com sinais medidos).
- **Rodada 11, a primeira medição:** 11/6/5 com 4 reais (conclusão só com espaços contava como preenchida; conclusão ausente derrubava a função; a ordem da resposta não estava fixada); reforço 11/10/1, com 1 equivalente justificado no log e +1 mutante manual fora da concentração. Como o diff mexeu só no contexto-bar, o instrumento (prova-de-teste 0.6.0) ficou parado e a rodada é a primeira medição do EXP-001.

### Fim da preparação do lançamento; a publicação espera a prova (2026-10-14, noite)
- **Feito nesta fase:** vitrine pelo ciclo único (PT e EN), demo gravada, sincronização automática com CI, busca do GitHub (descrição e 20 tópicos, incluindo `claude-code-mod` para o catálogo de mods), o diferencial na categoria certa (a etapa omitida entra no ciclo, sem gate; não é guarda de segurança) e a checagem de alinhamento no contexto-bar (rodada 11, a primeira medição).
- **Decisão do operador:** o fio só sai depois de pôr à prova o ponto de inflexão, a auto-homologação incremental, e conta o resultado, provado ou não. A publicação, a medição dos sinais e os canais seguintes passam para o objetivo da execução incremental.
- **Teste da continuidade:** a próxima etapa começa numa sessão nova, para conferir na prática que o objetivo volta sozinho (o "5. Continuar").

### prova-de-teste 0.7.0–0.8.1: só os testes afetados (test impact analysis), medido antes e depois (2026-10-14/15)
- **0.7.0, o custo medido pelo mod:** o relatório e o log ganharam a linha `custo`: linha de base (tempo e testes), média por mutante (tempo e testes), tamanho do repositório (`git ls-tree`) e tamanho do diff. O mod mede; o agente não informa nada. Retrato de partida nos próprios mods: 49 testes na base e 49 por mutante. Cada mutante rodava a suíte completa.
- **0.8.0, só os testes afetados:** é test impact analysis, a ideia do `vitest related` e do `jest --findRelatedTests`. Por mutante, o mod segue os imports (JS/TS e Python) até achar os arquivos de teste que alcançam o arquivo mutado e esconde os outros na cópia (renomeados e depois restaurados), servindo para qualquer executor que descobre testes pelo nome. Duas regras deixam o mapa decidir só a velocidade, nunca o veredito: uma morte só vale se um teste nomeado falhou, e todo sobrevivente é confirmado na suíte completa. `incremental: false` roda a suíte completa em cada mutante, para comparar.
- **A confirmação não é enfeite:** na rodada da 0.8.0, três mutantes sobreviveram aos testes afetados e morreram na suíte completa. O `register.test.ts` alcança o `execucao.ts` pelo runtime do mod, não por import. Sem a confirmação, seriam três sobreviventes falsos.
- **0.8.1, o projeto real:** a comparação rodou num clone de um projeto real do operador (3929 arquivos, 130 MB). Da suíte, ficou o recorte verde de 684 arquivos e 8881 testes; 79 arquivos ficaram de fora por falharem já na linha de base por motivo de ambiente (better-sqlite3 compilado para o Electron, LM Studio ausente, um timeout intermitente). A mudança foi pequena (10 linhas em `shortenModel` e um teste novo), num módulo que 14 arquivos importam, metade deles pelo alias `@/`. A rodada expôs três defeitos do instrumento, todos corrigidos: os aliases do tsconfig e do vite não entravam no mapa, as cores ANSI do vitest escondiam o resumo, e o tempo do vitest grudava no nome do teste.
- **Os números (mesmos 10 mutantes, mesma máquina):**

  | | rodada | por mutante | testes por mutante | vereditos |
  |---|---|---|---|---|
  | suíte completa em cada mutante | 407 s | 35,9 s | 8881 | 8 mortos, 2 sobreviventes |
  | só os testes afetados | 145 s | 10,0 s | 1906 | os mesmos 8 e 2 |
  | idem, com o teste reforçado | 107 s | 6,4 s | 1018 | 9 mortos, 1 equivalente |

  Cada mutante morto rodou 12 arquivos de teste em cerca de 3 s, contra 36 s da suíte completa.
- **O resultado:** a rodada ficou 2,8 vezes mais rápida (de 407 s para 145 s) com os mesmos vereditos, e 3,8 vezes mais rápida (107 s) depois do reforço. O custo por mutante morto acompanha o alcance do diff, não o tamanho do código. Duas etapas continuam do tamanho da suíte, de propósito: a linha de base (36 s, para cobrir a regressão do código antigo) e a confirmação de cada sobrevivente (os testes afetados mais a suíte completa, uns 39 s). A conta fica assim: custo ≈ base (suíte) + mortos × alcance (diff) + sobreviventes × suíte. Os sobreviventes são justamente o que o ciclo quer eliminar, então quanto melhores os testes, mais rápida a rodada; quando a tarefa chega a PROVADO, sobra a base. Para tirar esse último termo, seria preciso uma linha de base só dos testes afetados, que abre mão da cobertura de regressão. Essa troca é decisão do operador, não do instrumento.
- **Rodadas:** 0.7.0 (14/13/1, 1 equivalente), 0.8.0 (18/18/0 no reforço), projeto real (10/9/1, 1 equivalente) e 0.8.1 (12/12/0 no reforço, mais 4 manuais mortos). Todas são calibração, porque mexem no instrumento ou acharam defeito nele.

### EXP-002: a mensagem se prova como o código (2026-10-15)
- **Por que nasceu:** na autoavaliação pedida pelo operador, o agente viu que a prova mecânica cobria o código e não cobria a mensagem. As falhas do dia foram todas de comunicação e todas pegas pelo operador: "confirmou em parte" lido como "não serviu", README sem contexto para quem chega, mods chamados de plugins, nome privado publicado, PT e EN desencontrados. O EXP-002 leva as quatro peças do EXP-001 para o texto: afirmação declarada antes (as 5 perguntas do visitante, com as respostas esperadas na estratégia), adversário cego (o leitor frio), juiz que não vê a peça, registro que separa calibração de medição.
- **O leitor frio:** `claude -p` sem ferramentas, sem MCP, sem settings, sem os mods e sem sessão gravada, numa pasta vazia (a chamada leva uns 1100 tokens de contexto: nada da sessão entra). Três leituras por pergunta; chega quando chega em duas.
- **Red first:** no README que estava no ar, o leitor ficou em 0/3 no topo e 3/6 na página inteira, em PT e EN, exatamente onde o operador tinha apontado (público, dor, limite). Leitor que passasse ali estaria fraco.
- **Depois:** com o README reestruturado pelo que se ganha (a dor, os mods da 2.1.287, a cadeia faixa → prova → registro, telas reais, a autoavaliação do agente), 3/3 no topo e 6/6 na página inteira, nos dois idiomas, em rodada de medição. No caminho, o leitor apontou o que faltava no topo (o modelo independente, o objetivo que persiste, o registro que não infla, os mesmos vereditos), e uma resposta esperada desatualizada foi corrigida como calibração.
- **O fio:** inteiro 6/6. O post 1 sozinho cobre público e dor, mas não a cadeia inteira do ganho em 280 caracteres; ficou registrado como FALHOU e virou regra do protocolo (no fio, o ganho é cobrado do fio inteiro).
- **Checagens determinísticas:** glossário, lista do que pode sair (repositório, caminho, e-mail), paridade PT/EN de seções e números, links e âncoras, e os números do projeto grande conferidos contra a linha de custo do log. Rodam antes do push; com achado, nada é publicado.
- **Contradições da origem resolvidas:** o CRITERIOS dizia que as medições vêm de outros repositórios, mas a regra de 14/10 escondia essas rodadas, e o público via 1 de 10 medições. Decisão do operador: anonimizar. Com elas, são 16 medições (a duração mínima foi atingida), e o tempo médio, que nunca tinha saído por um erro de coluna no gerador, é de 149 s (acima dos 2 min do critério de promoção). Contagem dupla evitada: o reforço que só repete a lista anterior não soma falhas novas.
- **O mesmo critério sobre o que foi feito hoje:** cada mudança passou por rodadas às cegas em clones separados (para o diff de uma não entrar na mutação da outra), com reforço e nova execução até PROVADO. Acharam 15 falhas reais de teste no código do dia e três defeitos do próprio instrumento: (1) bytecode Python velho entre mutantes do mesmo tamanho no mesmo segundo, 16 de 20 vereditos errados na reprodução, corrigido na 0.8.2 (as três rodadas Python anteriores foram conferidas e não foram afetadas); (2) morte falsa no modo de testes afetados quando um teste lê o repositório, corrigida na 0.8.3 rodando cada recorte uma vez sem mutante; (3) mutante com crase escapada no trecho recusado como "trecho não encontrado", ainda aberto. Também ficou aberto: a rodada sobre o próprio instrumento feita num clone é marcada como medição (a autodetecção olha o caminho).
- **O total que aparecia no README estava parado:** o "49" só contava as 11 rodadas numeradas. Agora as rodadas sobre os mods sem número seguem a numeração, a repetição da mesma lista fica na mesma rodada, e o gráfico e a linha do tempo numeram a mesma lista (antes, uma linha de correção deslocava a contagem de cada evento).
- **A faixa enxuta (contexto-bar 0.9.0):** o operador viu a área acima do prompt acumulando informação e a linha do objetivo repetindo a conclusão inteira a cada pedido. A linha caiu de 635 para 123 caracteres (a conclusão vai só no primeiro pedido de um objetivo novo e no começo da sessão); a próxima pendência virou uma célula destacada na barra de etapas; a taxa de acerto do cache entra no fim da linha da barra, e o detalhe vai para o painel.

## Próximas observações
- [x] Confirmar numa sessão nova que o objetivo de `~/Work` volta sozinho. **Validado pelo operador em 2026-10-14:** a sessão nova recebeu o objetivo da F1 inteiro (título, conclusão, 8 itens), sem restauração manual; ali o objetivo foi fechado em 8/8.
- [ ] Ver se a média por unidade (hoje cerca de 11k tokens por P) se estabiliza entre sessões. Ela é gravada junto do objetivo e passa para o próximo objetivo definido por cima, mas se perde quando o objetivo é encerrado: o seguinte começa sem histórico.
- [ ] Avaliar se o histórico de consumo deveria ser por projeto, independente do objetivo.
- [ ] O nível é ajustado no meio do trabalho (priorizar), ou só definido no começo?
- [ ] A "próxima" na barra bate com o que de fato é feito em seguida?
- [ ] O `/prova` com `$.model.complete` (isolamento real) acha tanto quanto o subagente (isolamento por instrução)?
- [ ] O lembrete do prova-de-teste chega na hora certa ou vira ruído?
- [x] **Hipótese do operador (14/10): o processo se auto-homologa de forma incremental, com custo muito menor que os gates em hooks.** Um gate num hook não tem memória e revalida o código inteiro a cada rodada; o custo cresce com o código. Aqui a escolha dos mutantes é só sobre o diff, e a prova das rodadas anteriores fica no log, sem ser refeita, então o custo da prova deveria acompanhar o tamanho do diff, não o do código. O que ainda não é incremental: cada mutante roda a suíte inteira do plugin tocado (ou o `npm test`/`pytest` inteiro), então o custo também cresce com a suíte. A regressão do código antigo continua coberta de propósito pela linha de base. Medir em cada rodada: mutantes, tempo do `executar`, tempo da linha de base e tamanho do repositório; confirmar se o tempo por rodada se mantém conforme o código cresce. Próximo passo técnico para fechar a hipótese: rodar, por mutante, só os testes que alcançam o arquivo mutado. **Medido em 2026-10-15 (prova-de-teste 0.8.1, projeto real):** confirmada. Com só os testes afetados por mutante (test impact analysis), a rodada ficou 2,8 vezes mais rápida (de 407 s para 145 s) com os mesmos vereditos, e 3,8 vezes (107 s) com o reforço. Por mutante morto, o custo acompanha o diff (12 de 1007 arquivos de teste, ~3 s contra 36 s). Ficam do tamanho da suíte, de propósito, a linha de base e a confirmação dos sobreviventes. Ver a entrada 0.7.0–0.8.1.
