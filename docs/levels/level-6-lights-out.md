# Level 6 — Lights Out

- **Id de rede:** `6` (conteúdo `3`) — **Grid:** 48×48
- **Entidades:** invocadas sob demanda (`timedSummon`): `DULLER`, `SKIN_STEALER`, `WRETCH`, `HOUND`
- **Rota principal:** [Terror Hotel](level-5-terror-hotel.md) → Lights Out → [Poolrooms](poolrooms.md).
- **Desvio secreto:** corredor sem luz no [Level 1](level-1.md) → Lights Out → [Electrical Room](level-3-electrical-room.md).

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

Na rota principal, o grupo chega pelo corredor final do Terror Hotel. Também pode ser escolhido no lobby.

A entrada pelo Level 1 continua **opcional e individual**: chegue ao fim do corredor escuro (a posição vem da seed; o radar a marca com o rótulo `6`) e a transição dispara só para você. Conta como a conquista **Luzes Apagadas**. Esse desvio pode ser desativado em **Rotas secretas**.

## Saída

Na rota principal (ou quando escolhido no lobby), a saída segue às Poolrooms após todos os exploradores vivos estarem prontos. Pelo desvio do Level 1, a saída leva o grupo à Electrical Room, pulando o Level 2. O servidor determina o destino a partir da rota da sala.

## Referências no código

- `LEVEL_DEFS[LIGHTS_OUT_LEVEL]` (spawn `timedSummon`) e `GameEngine.updateLightsOutSummons`, `spawnLightsOutStalker`.
- Lanterna ligada contínua: contador do nível no `GameEngine`.
