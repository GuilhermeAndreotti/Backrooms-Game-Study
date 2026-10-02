# Poolrooms (Dark Poolrooms, tema Level 37.2)

- **Id de rede:** `5` (conteúdo `7`) — **Grid:** 40×40
- **Entidades:** `CLUMP` e `O VIGIA`
- **Próximo nível:** [Level 79 — Space Station](level-79-space-station.md) (a saída é uma porta de estação)

## Ambientação

Salas de azulejo inundadas, escuras e úmidas, com piscinas de profundidades diferentes. A água está **contaminada** ("Hydrolitis Plague") e o ambiente tem azulejo por todo lado.

## Objetivo

Drenar a contaminação girando **12 válvulas** — **3 válvulas em cada uma das 4 áreas** — **na ordem correta** de cada área. Quando todas estão giradas:

> *"AS VÁLVULAS DRENARAM A CONTAMINAÇÃO. A água está segura agora."*

A saída, embutida na divisória da piscina mais funda (célula `28,21`), só funciona depois disso.

## Como descobrir a ordem

A ordem de cada área é sorteada da seed (`poolValveOrderForSeed`, em [poolroomsPuzzle.ts](../../src/game/poolroomsPuzzle.ts)), igual para todos. Em cada área há **três pistas** (pontos de leitura espalhados, longe uns dos outros), cada uma indicando uma válvula e sua posição na sequência. Encontre as três pistas, monte a ordem e gire as válvulas (`E`) nela.

O progresso (`VÁLVULA GIRADA: n/total`) é compartilhado pela sala; o servidor guarda o estado (`poolroomsState`) e o envia por snapshot a quem entra depois.

## Perigos

- **Água tóxica**: ficar em células contaminadas acumula exposição; ao chegar a **8 s** o jogador é arrancado dali e reaparece em um ponto seguro (as entidades são afastadas dele). Fora da água a exposição se recupera rápido. O HUD mostra a exposição. A água fica segura depois de drenar.
- **`CLUMP`**: o perigo nativo do nível. **Perde você se estiver submerso** — mergulhar é uma fuga.
- **`O VIGIA`**: criatura enorme de membros longuíssimos que **marca os exploradores desde o início**, enxerga longe pelas salas alagadas e avança em passo de caminhada. Ela é mais perigosa conforme o puzzle avança.

## Dicas

- Dividam as quatro áreas entre os jogadores; cada área é independente.
- Anote a ordem de cada área à medida que acha as pistas.
- Mantenha-se fora da água tóxica enquanto procura.

## Referências no código

- `ProceduralMap`: `valvePositions`, `poolValveOrder`, `poolClueCells`, `toxicWaterCells`, `poolroomsSolved`, `updatePoolroomsWater`.
- `GameEngine`: `tryTurnValve`, `valvesTurned`, `toxicWaterExposure`; servidor: `resetPoolroomsState`, `poolroomsSnapshot`.
- [Water.ts](../../src/game/Water.ts): superfície da água.
