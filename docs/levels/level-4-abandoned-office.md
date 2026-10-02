# Level 4 — Abandoned Office

- **Id de rede:** `4` (conteúdo `9`) — **Grid:** 48×48
- **Entidades:** nenhuma hostil fixa (`bespoke`); os **funcionários M.E.G.** são NPCs ([npc/OfficeWorker.ts](../../src/game/npc/OfficeWorker.ts))
- **Próximo nível:** Poolrooms · **Segredos:** [Level G](level-g.md) e [Level FUN](level-fun.md)

## Ambientação

Um escritório corporativo vazio, de luz fraca e silêncio pesado. Ainda assim há gente: funcionários do **M.E.G.** sentados às mesas, animados, conversando com quem se aproxima. É o nível mais "calmo" — a tensão vem de entender o que está errado.

## Objetivo

Abrir a **porta azul** da saída. Ela exige os **IDs de acesso dos três programadores**, digitados em ordem de **senioridade**:

1. **Sênior** (Helena Duarte) — primeiro
2. **Pleno** (Rafael Costa)
3. **Júnior** (Marina Alves) — por último

Cada funcionário diz seu ID e, às vezes, a regra da ordem ("*Digite este primeiro, depois os IDs do pleno e do junior*"). Fale com cada um com `E`, anote os IDs e use a porta azul (`E`: *"Usar porta azul"*).

- Ordem correta: *"ACESSO MEG AUTORIZADO. A porta azul foi liberada."*
- Ordem errada: *"ACESSO NEGADO. A ordem dos funcionários está incorreta."*

Os IDs vêm da seed, logo são iguais para todos.

## Quebras de personagem

Cerca de 30% das falas, o funcionário "sai do personagem" e revela que **ninguém ali é real** — são ecos de quem trabalhava no escritório, que está abandonado há muito tempo. Às vezes aproveitam e repetem o próprio ID. É lore e dica ao mesmo tempo.

## Segredos

Dois caminhos opcionais saem deste nível (ambos individuais, se **Rotas secretas** estiver ativado):

- **Level G** — uma passagem escondida, convergindo no marcador da "porta de escritório que não deveria existir". Chegar à célula dela leva o jogador ao [Level G](level-g.md), e a saída de lá devolve a este nível.
- **Level FUN** — um **bolo escondido** num ponto do mapa. Aperte `E` perto dele quando **ninguém estiver olhando** para comê-lo e você é levado ao [Level FUN](level-fun.md). O radar mostra um marcador do bolo enquanto ele não foi comido.

## Referências no código

- `ProceduralMap`: `level4Employees`, `abandonedSecretX/Z`, `funCakeX/Z`.
- `GameEngine`: `level4DoorOpen`, `setupOfficeWorkers`, diálogo M.E.G., `MegDoorModal`.
- Textos: `meg.*`, `dialog.*`, `act.megDoor`, `eng.megDoor*`.
