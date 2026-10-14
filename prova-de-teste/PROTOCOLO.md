---
type: experiment
title: EXP-001 Prova de Teste
description: Red first + one manual mutant per applicable category on the diff, chosen blind by a subagent, for every task that creates or changes tests; runs in parallel to the harness, not a criterion yet.
status: active
version: 1.2
timestamp: 2026-10-14
---

# EXP-001 — Prova de Teste (experimento global) — v1.2

> **Origem:** sessão com o operador em 14/10/2026. Referências: vídeo "Mutation testing is AWESOME" (Matt Pocock, youtube.com/shorts/djSbndoByr8), *Practical Mutation Testing at Scale* (Google, research.google/pubs/practical-mutation-testing-at-scale-a-view-from-google), *Mutation-Guided LLM-based Test Generation at Meta* (arxiv.org/abs/2501.12862).
> **Onde vive:** este arquivo viaja com o instrumento, em `prova-de-teste/PROTOCOLO.md`, versionado junto com o mod.
> **Status:** EXPERIMENTO. Ainda não é critério do harness. Quem decide se vira critério é o operador.
> **Changelog:**
> - v1.0 (14/10/2026): R1, R2 e R3.
> - v1.1 (14/10/2026): mudanças motivadas pela rodada 1 do contexto-bar 0.5.0, relatada como PROVADO (9/9 mortos). A auditoria mostrou que o estado real era FRACO: 4 de 7 mutantes por categoria sobreviveram. Na v1.1, R2 passa a cobrir uma mutação por categoria, entra a R2.1 (mutantes escolhidos às cegas), o relatório passa a listar cada mutante e entra o alerta de concentração.
> - v1.2 (14/10/2026, decisão do operador): a contagem separa **calibração** do instrumento e **medição** do método. Motivo: da rodada 4 à 7, toda rodada do mod prova-de-teste sobre si mesmo achou um defeito do próprio instrumento (caminho curto, morte falsa, "não carregou" falso, helper tomado por teste). Essas rodadas mediam o instrumento, não o método, e não podem contar para as 10. O log ganha versão do instrumento e defeito do instrumento.

## Problema

Quando o mesmo agente escreve o código e o teste, o teste tende a confirmar o que o próprio agente supôs. Ele também escolhe o mutante, então a prova herda o mesmo viés. Um "teste passou" sem prova de que o teste pega bug equivale a "escrevi o texto e ele respondeu o texto".

## Regras (valem para toda tarefa que crie ou altere testes)

### R1 — Red first (obrigatória)
Antes de declarar um teste como válido, **mostre o teste falhando**:
- Em bug fix: rode o teste novo antes do fix (ou com o fix revertido) e registre a falha.
- Em feature nova: quebre a linha central da implementação, rode o teste, registre a falha e desfaça a quebra.
- Se o teste não falha, ele não prova nada. Reescreva o teste antes de seguir.

### R2 — Mutantes por categoria no diff (obrigatória)
Para o código **alterado nesta tarefa** (só o diff), aplique **pelo menos 1 mutante em cada categoria que se aplique**:

| Categoria | Exemplos |
|---|---|
| borda / vazio | lista vazia, tudo filtrado, limite `<` → `<=`, off-by-one |
| empate / ordem | remover o desempate, inverter a ordem, ordenação não estável |
| null / ausente / inválido | `null` ou `undefined` não cai no padrão; valor fora do domínio aceito |
| condição invertida | `if (x)` → `if (!x)`, filtro invertido |

- Se uma categoria não se aplica ao diff, diga em uma linha por quê.
- Você pode somar mutantes livres (remover uma chamada, trocar uma string por `""`), mas eles **não substituem** as categorias.
- Aplique um mutante por vez, rode só os testes afetados e reverta.
- Confirme a restauração com `git diff` limpo no código-fonte. Sem commit, use `cmp` contra uma cópia e registre qual dos dois usou.
- Todo SOBREVIVENTE gera uma das duas saídas: reforçar o teste até matá-lo (e o teste novo passa pela R1), ou justificar em uma linha que ele é equivalente.
- **Equivalente** quer dizer que nenhuma entrada distingue o mutante do original. "Fora do escopo desta tarefa" não é equivalência: se uma entrada válida mostra a diferença (como uma lista de tamanho par), o sobrevivente é real. Com o mod, registrar um estado melhor que o executado exige a justificativa de cada sobrevivente (`equivalentes`), que vai para a linha do log.

### R2.1 — Mutantes escolhidos às cegas (obrigatória quando houver subagente disponível)
Quem escolhe os mutantes **não pode ter visto os testes**.
- Entregue a um subagente **só o diff do código-fonte e a tabela de categorias, sem os arquivos de teste**, e peça uma lista de mutantes no formato `arquivo:linha | categoria | mutação`.
- O agente principal aplica os mutantes da lista. Não remove nenhum; pode acrescentar.
- Sem subagente disponível, registre `R2.1: não aplicada (motivo)`. Nesse caso o estado máximo é PROVADO-PARCIAL.

Motivo: na rodada 1, o que encontrou as 4 falhas foi um revisor de fora nomeando as categorias sem conhecer os testes. A R2.1 transforma isso em procedimento.

### R3 — Ferramenta automática (opcional)
Se o projeto já tiver Stryker (TS/JS), mutmut (Python) ou similar, rode **restrito aos arquivos do diff**. Não instale nada sem aprovação do operador.

## Formato obrigatório do relatório

Proibido escrever só "testes passam". Use:

```
PROVA DE TESTE — <tarefa> — <data>
Red first:  <teste> falhou contra <bug/quebra> → passou   [feito | não feito: motivo]
Escolha:    R2.1 às cegas por <subagente> | não aplicada: <motivo>
Mutantes:
  # | arquivo:linha | categoria | mutação | MORTO por "<teste>" | SOBREVIVENTE → <reforçado | equivalente: motivo>
  ...
Categorias: borda/vazio ✔ | empate/ordem ✔ | null/inválido ✔ | condição ✔   (ou "n/a: motivo")
Concentração: <maior nº de mortes por um único teste>/<total>
Restauração: git diff limpo | cmp contra cópia
Tempo:      <s total>
Estado:     PROVADO | PROVADO-PARCIAL | FRACO | NÃO VERIFICADO
```

- **PROVADO:** R1 feita, todas as categorias aplicáveis cobertas, R2.1 aplicada e nenhum sobrevivente sem tratamento.
- **PROVADO-PARCIAL:** o mesmo, mas sem R2.1.
- **FRACO:** existe sobrevivente sem tratamento, ou uma categoria aplicável ficou sem mutante. A tarefa **não** é Done.
- **NÃO VERIFICADO:** R1 ou R2 não foram executadas. Diga por quê.

**Alerta de concentração:** se um único teste matou mais da metade dos mutantes, sinalize `⚠ concentração`. Os mutantes provavelmente estão agrupados no que esse teste cobre. Antes de fechar, aplique pelo menos mais 1 mutante fora dessa área.

Reportar teste falhando ou estado FRACO é resultado válido e esperado. Esconder a falha, ou ajustar o teste só para ele passar, é o defeito que este experimento existe para eliminar.

## Registro do experimento

Uma linha por tarefa no log: `PROVA_DE_TESTE_LOG`, ou `~/.claude/prova-de-teste/EXP-001-log.md` (o caminho padrão pode ser um link para onde o log já vive). O mod `prova-de-teste` grava a linha com a ferramenta `registrar`. Correções entram como uma linha nova abaixo, **sem reescrever a original**.

```
<data> | <tarefa> | versão do protocolo | mutantes aplicados/mortos/sobreviventes | sobreviventes reais encontrados | estado | tempo (s)
```

v1.2 acrescenta dois campos ao fim: `| instrumento: <mod x.y.z | manual> | <medição | calibração: <defeito do instrumento>>`.

## Contagem: calibração × medição (v1.2)

O **instrumento** é o que executa a prova: o mod `prova-de-teste` (versão em `plugin.json`) ou a rota manual (subagente às cegas + aplicação à mão, versão = a do protocolo).

- **Rodada de calibração:** a rodada achou um defeito do instrumento (número errado, morte ou sobrevivente falso, mutante recusado indevidamente, arquivo classificado errado) **ou** o instrumento foi alterado durante ela. Ela vale como resultado do instrumento e **não conta** para a duração.
- **Rodada de medição:** a rodada rodou num instrumento que não mudou e nela nenhum defeito do instrumento apareceu. **Só ela conta** para a duração e para o tempo médio.
- **Instrumento estável:** 3 rodadas de medição seguidas na mesma versão. Qualquer mudança no instrumento cria uma versão nova, que só fica estável depois de 3 medições seguidas.
- **Defeito descoberto depois:** se ele afetou os números de uma medição anterior, uma linha de correção a reclassifica como calibração. A original nunca é reescrita.
- **Achados do método × do instrumento:** "sobreviventes reais" são falhas dos testes da tarefa. Defeitos do instrumento vão no campo próprio e nunca entram em "reais".

## Critério de saída (decisão do operador)

| Variável | Valor sugerido (proposta) | Quem decide |
|---|---|---|
| Duração | 10 rodadas de **medição** (v1.2; decisão do operador em 14/10/2026: seguir até 10) | operador |
| Promover a critério do harness se | sobreviventes reais em ≥ 3 rodadas de medição E tempo médio das medições < 2 min E instrumento estável | operador |
| Descartar ou ajustar se | tempo médio das medições > 5 min, ou zero achados em 5 medições seguidas | operador |
| Rodada 1 (referência) | v1.0, contexto-bar 0.5.0: relatada PROVADO, real FRACO; 4 sobreviventes reais; cerca de 16 s no total | — |
