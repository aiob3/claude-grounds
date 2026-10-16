# Critérios de avaliação do EXP-001

O experimento é promovido, ajustado ou descartado pelos critérios abaixo, e qualquer pessoa pode refazer a conta
a partir de [`log/EXP-001-log.md`](log/EXP-001-log.md). A regra completa está no
[protocolo](prova-de-teste/PROTOCOLO.md), na seção "Contagem: calibração × medição".

## Regra de contagem (v1.2)

Uma rodada é de calibração quando acha um defeito do próprio instrumento (número errado, morte ou sobrevivente
falso, mutante recusado sem motivo, arquivo mal classificado) ou quando o instrumento muda durante ela. Toda
rodada do mod `prova-de-teste` sobre o próprio código cai aqui.

Uma rodada é de medição quando roda num instrumento que não mudou e nenhum defeito dele aparece. Só as medições
contam para a duração e para o tempo médio. O instrumento passa a ser considerado estável depois de 3 medições
seguidas na mesma versão.

O mod classifica a rodada ao registrá-la. Ele marca calibração quando o diff mexe nele mesmo, quando a versão
muda entre `executar` e `registrar`, ou quando o agente informa um defeito.

## Critério de saída

| Variável | Valor | Estado atual, calculado do log público |
|---|---|---|
| Duração | 10 rodadas de medição | 37 medições (mínimo atingido); 46 calibrações registradas |
| Instrumento estável | 3 medições seguidas na mesma versão | não, 0 de 3 medições seguidas |
| Promover se | sobreviventes reais em pelo menos 3 medições, tempo médio das medições abaixo de 2 min e instrumento estável | medições com sobreviventes reais: 19; tempo médio das medições: 81 s |
| Descartar ou ajustar se | tempo médio das medições acima de 5 min, ou nenhum achado em 5 medições seguidas | n/a |

Quem decide é o operador. Até lá, o EXP-001 roda em paralelo e não bloqueia nenhuma entrega.

## Por que as rodadas sobre os mods não contam

Da rodada 4 à 9, cada rodada do instrumento sobre si mesmo achou um defeito dele: o caminho curto devolvido
pelo modelo, uma morte falsa, um "não carregou" falso, um helper de teste tomado por teste, uma execução antiga
sem versão. Contar essas rodadas mediria o instrumento enquanto ele mudava. Elas ficam no log como calibração, e
as medições vêm de tarefas com teste em outros repositórios, com o instrumento parado. Esses repositórios são
privados: no log, as rodadas deles aparecem só com os números, como "tarefa em projeto privado".
