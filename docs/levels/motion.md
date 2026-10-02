# Motion (tema Level 94)

- **Id de rede:** `8` (conteúdo `6`) — **Grid:** 40×40
- **Entidades:** `O CEIFADOR`, só à noite (`bespoke`)
- **Acesso:** **somente** pelo seletor de níveis do lobby (não faz parte da rota principal nem tem entrada secreta)

## Ambientação

Um campo **a céu aberto**, claro de dia, com um **corredor** que atravessa o terreno até um **castelo** no canto distante. Há casas pelo caminho, sem a densidade de decoração dos níveis 0–2.

## Ciclo dia/noite

| Fase | Duração | O que muda |
|---|---|---|
| Dia | 90 s | Seguro, sem monstros. *"O sol nasce. A área está segura por enquanto."* |
| Noite | 60 s | O **Ceifador** surge para caçar. *"A noite cai de repente. Entre numa casa, apague a luz, se esconda."* |

O ciclo recomeça a cada vez que o nível é carregado.

## O Ceifador

O predador supremo do jogo: alto, esguio, encapuzado, o **mais rápido** e de maior alcance de percepção. É **invisível ao radar** (sem aviso). Seu "aprender" é *onde* ele aparece: a posição de surgimento é **enviesada pelas células que o grupo mais visitou** (`VisitTracker`), então rotas repetidas viram armadilhas. Se ainda não há dados de visitas, ele nasce num canto distante. Durante o dia ele é removido.

## Objetivo

Chegar à **saída dentro do castelo**. Como ela fica no fim do corredor, alcançá-la à noite significa fazê-lo com o Ceifador caçando.

## Estratégia

- Mova-se de dia; à noite, entre numa casa, apague a luz e fique quieto.
- **Evite repetir rotas**: o Ceifador usa o seu histórico.
- Use a janela do dia para avançar o máximo possível em direção ao castelo.

## Referências no código

- `GameEngine.updateLevel6` (nome histórico; `LEVEL6_DAY_S`/`LEVEL6_NIGHT_S`), `spawnCeifadorNightHunt`, `despawnCeifadorNightHunt`.
- [mobs/ceifador.ts](../../src/game/mobs/ceifador.ts), [systems/visitTracker.ts](../../src/game/systems/visitTracker.ts).
- Mapa: `ProceduralMap` (carve do conteúdo `6`: campo, corredor e câmara em arco do castelo).
