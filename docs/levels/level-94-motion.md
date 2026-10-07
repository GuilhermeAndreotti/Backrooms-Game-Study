# Level 94 — Motion

- **Id de rede:** `8` (conteúdo `94`) — **Grid:** 72×72
- **Entidades:** `TOWN_KING` (no trono desde o início), `ANIMATION` ×4 (só à noite) — `bespoke`
- **Acesso:** a **porta de saída** num nicho da parede norte da [Electrical Room](level-3-electrical-room.md) (desvio individual), o rumo **DESCONHECIDO** na navegação do [Level 79](level-79-space-station.md) (leva todos a bordo), ou o seletor de níveis do lobby. As duas primeiras exigem "Rotas secretas". Ao terminar, volta ao lobby com o relatório de fuga (como Level FUN e Level 79).
- **Duração esperada:** 15–25 min

## Estrutura

```
CIDADE (dia) ─▶ CIDADE (noite) ─▶ GRASS HILLS ─▶ CASTLE ─▶ THE KING
```

1. **Dia** — uma cidadezinha 1930s/cartoon/maquete **espalhada sobre colinas**: cada casa no topo plano da sua colina (dá para subir em todas), estradas de asfalto com faixa amarela serpenteando pelos vales, a **torre do relógio na colina mais alta** com uma pracinha em volta, carros antigos, postes, árvores redondas. Moradores em loop (varrem, leem, dançam, acenam) que param para olhar o jogador. Sons estranhos atrás das portas. A estrada principal para fora está bloqueada.
   **Objetivo:** achar **CHAVE**, **ENGRENAGEM** e **PONTEIRO** (cada uma em uma de duas casas, sorteada pela seed) e encaixá-las na escotilha da torre (`E`), no lado sul dela.
2. **Transição (~19 s, igual para todos):** o relógio anda → moradores congelam → música para → pôr do sol → postes acendem e as luzes das casas apagam uma a uma → noite.
3. **Noite** — moradores somem; 4 **Animations** patrulham a cidade. A barricada ao norte abre. Casas são esconderijo seguro; carros, casas e **a crista de uma colina** cortam a visão delas.
4. **Grass Hills** — passando a cerca da cidade a noite simplesmente acaba: céu nublado e pálido, vale com estrada, móveis e pedaços de casas abandonados. Sem puzzle. No fim do vale, o **castelo no topo de um morro alto e íngreme** (~38 m), visível de longe; a estrada sobe o morro até o portão, e as encostas em volta do castelo também dão para subir.
5. **Castle** — *Entrance* (brinquedos, pinturas — uma delas mostra a cidade vista do ponto de ônibus, com cada casa em suas cores: é a pista), *Animation Room* e, atrás da grade, um corredor curto até a *Throne Room*.
   **A maquete:** na mesa da Animation Room está a cidade em miniatura (colinas de feltro, estradas, casinhas), com **5 terrenos vazios**. `E` na mesa abre o **painel de montar** (como os fios do Level 79): a planta da cidade vista de cima e uma bandeja com os 5 prédios que faltam — **torre do relógio, padaria, capela, casa azul e casa verde**. Arraste cada um para o terreno onde ele fica de verdade. Certo: encaixa e aparece na maquete 3D. Errado: volta para a bandeja e as luzes do castelo falham. As 5 lâmpadas sobre a grade contam os prédios no lugar; com os 5, a grade sobe. O progresso é compartilhado entre os jogadores.
6. **The King** — sentado no meio do salão. Na primeira vez que você chega a ~15 m do trono com ele ainda sentado, ele **fala com você** (painel de diálogo; nada te pega enquanto ele fala): diz que sabe que você procura a saída e que pode te tirar das Backrooms. Respostas:
   - *"Como você me tiraria daqui?"* / *"Quem é você?"* — ele explica (a segunda resposta é a pista do segredo abaixo).
   - **"Aceito."** — o mesmo final do *Stay*: você vira uma Animation sentada numa casa da cidade, para sempre.
   - **"Não. Eu vou sair sozinho."** — ele se levanta (para todos na sala) e persegue sem parar; colunas e mesas ajudam. Na porta norte, uma **visão individual**: o Rei bloqueia a porta e fica enorme, a sala distorce. **Andar até ele** o faz encolher e sumir; a porta abre → tela branca "LEVEL 94 / MOTION / COMPLETE" → fim.
   - **"Eu fico. Mas no seu trono."** *(secreta)* — só aparece se você (1) pegou a **coroa de papel** largada na poltrona no meio das colinas, (2) **nunca foi pego** neste level e (3) montou a maquete **sem errar nenhum prédio**. Final: "...A coroa reconhece você." → tela preta → você, uma Animation de coroa e manto nas suas cores, sentado no trono; a câmera se afasta pelo salão → "VIDA LONGA AO REI" (conquista *Vida Longa ao Rei*).

   **Final secreto (Stay):** na visão da porta, ficar **parado ~6 s** diante dele → "Stay." → tela preta → você é uma Animation sentada numa cadeira de uma casa da cidade, de dia, para sempre; a câmera se afasta → "FIM".

Ser pego **não mata**: Animations te levam de volta ao ponto de ônibus; o Rei te devolve à entrada do salão. (Sanidade zerada ainda mata normalmente.)

### Limites do terreno

Ao norte da cerca da cidade não há paredes invisíveis: toda a colina é andável e só o que é **íngreme demais para subir** (mais de ~38°, `TOWN_MAX_SLOPE`) bloqueia, então cada limite é algo que se vê. A estrada e as encostas do morro do castelo (até ~35°) ficam abaixo desse limite. A cidade continua fechada: de dia só a barricada (aberta à noite) liga a cidade às colinas, e a cerca tem colisão.

## Multiplayer

- Fatos compartilhados (`town_event`, guardados no servidor para quem chega depois via `town_sync`/`town_state`): peça achada, relógio ligado, prédio recolocado na maquete, maquete resolvida, oferta do Rei recusada (ele acorda para todos). Os três fatores do final secreto são de cada jogador.
- A transição dia→noite é uma linha do tempo fixa que cada cliente roda ao saber do fato `clock`; quem chega de noite pula direto para a noite.
- Rei e Animations são entidades replicadas normais (a autoridade do nível os simula). A visão na porta e os dois finais são por jogador; durante a visão o Rei replicado fica invisível e inofensivo para quem a vive.

## Referências no código

- [townLayout.ts](../../src/game/levels/townLayout.ts) — planta (casas, colinas, estradas), peças, maquete, regras de onde cada monstro pode andar, altura do terreno.
- [townPlan.ts](../../src/game/levels/townPlan.ts) — a cidade desenhada em 2D (base da maquete, painel de montar, pintura-pista); [TownModelModal.tsx](../../src/components/TownModelModal.tsx) — o painel.
- [townWorld.ts](../../src/game/levels/townWorld.ts) — geometria (construída inteira e mesclada por material; as células do mapa ficam vazias), portões, luzes.
- [townDirector.ts](../../src/game/levels/townDirector.ts) — dia/entardecer/noite, interações, atmosfera por zona, visão do Rei, finais.
- [townSky.ts](../../src/game/levels/townSky.ts), [townFigures.ts](../../src/game/levels/townFigures.ts) — céu e personagens rubber-hose.
- [mobs/animation.ts](../../src/game/mobs/animation.ts), [mobs/townKing.ts](../../src/game/mobs/townKing.ts).
