# Level 94 — The Old Town

- **Id de rede:** `8` (conteúdo `94`) — **Grid:** 72×72
- **Entidades:** `TOWN_KING` (no trono desde o início), `ANIMATION` ×4 (só à noite) — `bespoke`
- **Acesso:** a **porta de saída** num nicho da parede norte da [Electrical Room](level-3-electrical-room.md) (desvio individual), o rumo **DESCONHECIDO** na navegação do [Level 79](level-79-space-station.md) (leva todos a bordo), ou o seletor de níveis do lobby. As duas primeiras exigem "Rotas secretas". Ao terminar, volta ao lobby com o relatório de fuga (como Level FUN e Level 79).
- **Duração esperada:** 15–25 min

## Estrutura

```
OLD TOWN (dia) ─▶ OLD TOWN (noite) ─▶ GRASS HILLS ─▶ CASTLE ─▶ THE KING
```

1. **Dia** — cidade 1930s/cartoon/maquete: praça com a torre do relógio, quarteirões de casas (seis podem ser visitadas), carros antigos, postes, moradores em loop (varrem, leem, dançam, acenam) que param para olhar o jogador. Sons estranhos atrás das portas. A estrada para fora está bloqueada.
   **Objetivo:** achar **CHAVE**, **ENGRENAGEM** e **PONTEIRO** (cada uma em uma de duas casas, sorteada pela seed) e encaixá-las na escotilha da torre (`E`).
2. **Transição (~19 s, igual para todos):** o relógio anda → moradores congelam → música para → pôr do sol → postes acendem e as luzes das casas apagam uma a uma → noite.
3. **Noite** — moradores somem; 4 **Animations** patrulham as ruas. A barricada ao norte abre. Casas são esconderijo seguro; carros, becos e esquinas cortam a visão.
4. **Grass Hills** — passando a cerca da cidade a noite simplesmente acaba: céu nublado e pálido, vale com estrada, móveis e pedaços de casas abandonados. Sem puzzle. O castelo no horizonte.
5. **Castle** — *Entrance* (brinquedos, pinturas — uma delas é a planta da cidade, a pista), *Animation Room* (maquete da cidade com **casa, carro e torre** fora do lugar; `E` move cada peça entre 3 posições; as 3 lâmpadas da grade mostram quantas estão certas; certas = grade sobe), corredor curto, *Throne Room*.
6. **The King** — sentado no meio do salão. Acorda quando alguém chega perto, corre perto dele ou passa dele; então persegue sem parar (colunas e mesas ajudam). Na porta norte, uma **visão individual**: o Rei bloqueia a porta e fica enorme, a sala distorce. **Andar até ele** o faz encolher e sumir; a porta abre → tela branca "LEVEL 94 / THE OLD TOWN / COMPLETE" → fim.
   **Final secreto:** ficar **parado ~6 s** diante dele → "Stay." → tela preta → você é uma Animation sentada numa cadeira de uma casa da Old Town, de dia, para sempre; a câmera se afasta → "FIM".

Ser pego **não mata**: Animations te levam de volta ao ponto de ônibus; o Rei te devolve à entrada do salão. (Sanidade zerada ainda mata normalmente.)

## Multiplayer

- Fatos compartilhados (`town_event`, guardados no servidor para quem chega depois via `town_sync`/`town_state`): peça achada, relógio ligado, posição de cada peça da maquete, maquete resolvida.
- A transição dia→noite é uma linha do tempo fixa que cada cliente roda ao saber do fato `clock`; quem chega de noite pula direto para a noite.
- Rei e Animations são entidades replicadas normais (a autoridade do nível os simula). A visão na porta e os dois finais são por jogador; durante a visão o Rei replicado fica invisível e inofensivo para quem a vive.

## Referências no código

- [townLayout.ts](../../src/game/levels/townLayout.ts) — planta, peças, maquete, regras de onde cada monstro pode andar, altura do terreno.
- [townWorld.ts](../../src/game/levels/townWorld.ts) — geometria (construída inteira e mesclada por material; as células do mapa ficam vazias), portões, luzes.
- [townDirector.ts](../../src/game/levels/townDirector.ts) — dia/entardecer/noite, interações, atmosfera por zona, visão do Rei, finais.
- [townSky.ts](../../src/game/levels/townSky.ts), [townFigures.ts](../../src/game/levels/townFigures.ts) — céu e personagens rubber-hose.
- [mobs/animation.ts](../../src/game/mobs/animation.ts), [mobs/townKing.ts](../../src/game/mobs/townKing.ts).
