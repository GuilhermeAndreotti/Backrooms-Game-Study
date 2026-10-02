# Level 6 — Lights Out (secreto)

- **Id de rede:** `6` (conteúdo `3`) — **Grid:** 48×48
- **Entidades:** invocadas sob demanda (`timedSummon`): `DULLER`, `SKIN_STEALER`, `WRETCH`, `HOUND`
- **Entrada:** beco sem saída de um corredor sem luz no [Level 1](level-1.md) — **Saída:** volta à [Electrical Room](level-3-electrical-room.md)

## Ambientação

Um labirinto **totalmente escuro**. Quase nada acende além da sua lanterna.

## Regra central

Neste nível o elenco não é fixo: **enquanto a sua lanterna ficar ligada, ela atrai perseguidores.**

| Parâmetro | Valor |
|---|---|
| Intervalo entre invocações | 6 s |
| Máximo simultâneo | 5 |
| Distância do jogador ao surgir | 8 a 14 células |
| Aviso | *"A luz atraiu algo na escuridão..."* |

O jogo é um equilíbrio entre **ver para onde vai** e **ser visto**: use a lanterna em rajadas curtas, desligue-a ao ouvir algo e encontre a saída pela memória e pelo radar.

## Entrada

É um desvio **opcional e individual**: chegue ao fim do corredor escuro do Level 1 (a posição vem da seed; o radar a marca com o rótulo `6`) e a transição dispara só para você. Conta como a conquista **Luzes Apagadas**. Pode ser desativado em **Rotas secretas**.

## Saída

Ao alcançar a saída, o servidor leva o jogador à Electrical Room (convergência), onde ele reencontra o grupo quando a sala chegar lá.

## Referências no código

- `LEVEL_DEFS[LIGHTS_OUT_LEVEL]` (spawn `timedSummon`) e `GameEngine.updateLightsOutSummons`, `spawnLightsOutStalker`.
- Lanterna ligada contínua: contador do nível no `GameEngine`.
