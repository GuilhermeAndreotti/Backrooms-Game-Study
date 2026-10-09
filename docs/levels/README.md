# Níveis

Guia de cada nível do jogo. Os ids e a rota principal vêm de [src/game/levels/constants.ts](../../src/game/levels/constants.ts); os elencos de entidades, de [src/game/levels/registry.ts](../../src/game/levels/registry.ts).

## Rota principal

```
Lobby ─▶ Level 0 ─▶ Level 1 ─▶ Level 2 ─▶ Electrical Room ─▶ Abandoned Office ─▶ Terror Hotel ─▶ Lights Out ─▶ Poolrooms ─▶ Level 79 ─▶ fim
```

A sala avança **junta**: o jogador que chega à saída envia `level_transition_request`; o servidor só muda de nível quando todos os jogadores vivos naquele nível estão prontos e o destino é o próximo de `MAIN_LEVELS`. Ao avançar, todos os mortos são revividos.

## Índice

| Nível | Id de rede | Acesso | Doc |
|---|---|---|---|
| Level 0 | `0` | Rota principal / lobby | [level-0.md](level-0.md) |
| Level 1 — Habitable Zone | `1` | Rota principal / lobby | [level-1.md](level-1.md) |
| Level 2 — Pipe Dreams | `2` | Rota principal / lobby | [level-2.md](level-2.md) |
| Level 3 — Electrical Room | `3` | Rota principal / lobby / saída do Lights Out | [level-3-electrical-room.md](level-3-electrical-room.md) |
| Level 4 — Abandoned Office | `4` | Rota principal / lobby / saída do Level G | [level-4-abandoned-office.md](level-4-abandoned-office.md) |
| Poolrooms | `5` | Rota principal / lobby | [poolrooms.md](poolrooms.md) |
| Level 5 — Terror Hotel | `13` | Saída do Abandoned Office / lobby | [level-5-terror-hotel.md](level-5-terror-hotel.md) |
| Level 6 — Lights Out | `6` | Saída do Terror Hotel / corredor secreto no Level 1 / lobby | [level-6-lights-out.md](level-6-lights-out.md) |
| Level G — The Small Office *(secreto)* | `7` | Passagem escondida no Level 4 / lobby | [level-g.md](level-g.md) |
| Level 94 — Motion *(secreto)* | `8` | Porta de saída na Electrical Room / rumo DESCONHECIDO no Level 79 / lobby | [level-94-motion.md](level-94-motion.md) |
| Level FUN *(secreto)* | `9` | Bolo escondido no Level 4 / lobby | [level-fun.md](level-fun.md) |
| Lobby | `10` | Início de toda sala | [lobby.md](lobby.md) |
| Level 79 — Space Station | `12` | Saída das Poolrooms / lobby | [level-79-space-station.md](level-79-space-station.md) |

Entidades: [../entities.md](../entities.md).

## Numeração: ids de rede vs. ids de conteúdo

Existem **dois** conjuntos de números, e confundi-los é a armadilha mais comum:

- **Id de rede** (`LEVEL_*` em `constants.ts`): é o que trafega no protocolo, o que o servidor guarda em `room.level` e `PlayerState.level`.
- **Id de conteúdo**: o que `ProceduralMap` usa para gerar o mapa. [`contentLevelFor()`](../../src/game/levels/constants.ts) faz a tradução, porque a geração procedural antiga foi reaproveitada ao reformular os temas:

| Nível | Id de rede | Id de conteúdo |
|---|---|---|
| Electrical Room | 3 | 8 |
| Abandoned Office | 4 | 9 |
| Poolrooms | 5 | 7 |
| Lights Out | 6 | 3 |
| Level G | 7 | 4 |
| Level 94 — Motion | 8 | 94 |
| Level FUN | 9 | 11 |
| Level 79 | 12 | 12 |
| Terror Hotel | 13 | 13 |
| 0, 1, 2, Lobby | igual | igual |

Detalhes: o id `11` é pulado na rede porque é o id de **conteúdo** do Level FUN; por isso o Level 79 usa `12`, que é ao mesmo tempo id de rede e de conteúdo. Comentários mais antigos no código (e rótulos como "Level 6/7" em `ProceduralMap`) usam ids de conteúdo — ao ler `if (level === 7)` lá dentro, cheque em qual espaço de ids aquele código está.

## Níveis secretos e detours

Controlados pela opção de sala **Rotas secretas** (anfitrião, no lobby).

| Detour | Entrada | Saída |
|---|---|---|
| Lights Out | Beco sem saída de um corredor sem luz no Level 1 | Leva o grupo à Electrical Room; na rota principal, após o Hotel, segue às Poolrooms |
| Level G | Passagem escondida no Abandoned Office | Volta ao Abandoned Office |
| Level 94 — Motion | Porta "SAÍDA" num nicho da parede norte da Electrical Room (individual), ou os três consoles do Level 79 em DESCONHECIDO (todos a bordo) | Final da própria fase (volta ao lobby) |
| Level FUN | Comer o bolo que ninguém está vigiando (Abandoned Office), ou escolher no lobby | **Segue para o Level 79** (pula as Poolrooms) — não encerra a expedição |

Detours são **individuais**: quem entra deixa a sala principal por um tempo; o servidor reúne os jogadores quando a sala chega ao ponto de convergência (nível 4 em diante). O **Level FUN** é um atalho para frente: quem sai dele chega à estação do Level 79 **antes** do grupo e permanece lá quando a sala avança (as transições da rota principal não o puxam de volta); a estação não guarda estado compartilhado para quem chega depois (energia, consoles).

## Anatomia de um nível

Para criar ou alterar um nível, estes são os lugares que costumam ser tocados:

1. **Id**: [`levels/constants.ts`](../../src/game/levels/constants.ts) (e `contentLevelFor`, `MAIN_LEVELS`). O servidor ([server.ts](../../server.ts)) tem listas próprias de níveis privados/permitidos — atualize-as também.
2. **Mapa**: `gridSizeForLevel` e o método `carve*` correspondente em [ProceduralMap.ts](../../src/game/ProceduralMap.ts); níveis grandes têm layout/mundo em `levels/*Layout.ts` + `*World.ts`.
3. **Entidades**: entrada em `LEVEL_DEFS` (`static`, `timedSummon` ou `bespoke`).
4. **Lógica**: níveis com puzzle complexo têm um "diretor" ([funDirector.ts](../../src/game/levels/funDirector.ts), [spaceDirector.ts](../../src/game/levels/spaceDirector.ts)); os demais têm ramos em `GameEngine.ts`.
5. **Atmosfera**: `levelAtmosphere` em `GameEngine.ts` (fog, luz ambiente).
6. **Textos**: chaves em `src/i18n/*` (as três línguas).
7. **Seletor do lobby**: [LevelSelectorModal.tsx](../../src/components/LevelSelectorModal.tsx).
