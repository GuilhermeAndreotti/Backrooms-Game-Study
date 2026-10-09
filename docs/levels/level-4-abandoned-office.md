# Level 4 — Abandoned Office

- **Id de rede:** `4` (conteúdo `9`) — **Grid:** 48×48
- **Entidades:** nenhuma hostil fixa (`bespoke`); os **funcionários M.E.G.** são NPCs ([npc/OfficeWorker.ts](../../src/game/npc/OfficeWorker.ts))
- **Próximo nível:** [Terror Hotel](level-5-terror-hotel.md) · **Segredos:** [Level G](level-g.md) e [Level FUN](level-fun.md)

## Ambientação

Um escritório corporativo vazio, de luz fraca e silêncio pesado. Ainda assim há gente: funcionários do **M.E.G.** sentados às mesas, animados, conversando com quem se aproxima. É o nível mais "calmo" — a tensão vem de entender o que está errado.

## Objetivo

Abrir a **porta azul** da saída. Ela exige os **IDs de acesso dos três programadores**, digitados em ordem de **senioridade**:

1. **Sênior** — primeiro
2. **Pleno**
3. **Júnior** — por último

**Quem são e onde sentam muda a cada partida:** os nomes saem de uma lista de 20 e cada programador fica numa sala lateral diferente (8 salas, várias cadeiras por sala), tudo sorteado da seed (`drawLevel4Programmers` em [ProceduralMap.ts](../../src/game/ProceduralMap.ts)) — igual para todos da sala, diferente na próxima. Nunca ficam no salão central de operações.

Os três programadores se destacam do resto da equipe: **camiseta laranja** com um "`</>`" no peito (sem paletó nem gravata). Ao entrar no nível, um aviso diz para procurá-los, e o canto superior esquerdo mostra a **senha da porta azul** com três espaços (SR / PL / JR) e quantos já foram encontrados.

Fale com cada programador com `E`: o ID dele entra **automaticamente** na senha do HUD, no espaço certo — não é preciso anotar. O achado é compartilhado: quando qualquer jogador fala com um programador, o ID aparece na senha de todos que estão no nível (mensagem `meg_id`; quem chega depois recebe via `meg_sync`). Com a senha completa, use a porta azul (`E`: *"Usar porta azul"*): o painel já vem preenchido, é só autorizar.

- Ordem correta: *"ACESSO MEG AUTORIZADO. A porta azul foi liberada."*
- Ordem errada: *"ACESSO NEGADO. A ordem dos funcionários está incorreta."*

Os IDs, os nomes e as posições vêm da seed, logo são iguais para todos.

## A torre, a paisagem, a chuva e os trovões

O escritório é o **~50º andar de uma torre isolada**, numa tempestade. As janelas são um shader ([officeWindow.ts](../../src/game/officeWindow.ts)) compartilhado por todas:

- **Janelas só nas paredes externas:** o contorno da torre segue as salas — as células andáveis passam por um *fechamento* morfológico de 2 células (`officeMassMask` em [ProceduralMap.ts](../../src/game/ProceduralMap.ts)): as paredes grossas entre salas vizinhas viram prédio, e vãos de 5+ células ficam como **recuos** entre alas. Toda parede de sala que dá para fora vira uma janela larga (3,3 m × 1,85 m), e nenhuma parede interna tem janela.
- **A própria torre vista de fora:** o vidro traça cada raio de visão pelo contorno da torre (extrudado de 200 m abaixo até alguns andares acima). Perto de um canto interno, olhando de lado, vê-se a **fachada da outra ala** — concreto e vidro escuros, lajes de cada andar, uma ou outra luz fria piscando — com paralaxe de verdade.
- **A paisagem, muito longe:** renderizada **uma vez** num cubemap (`buildOfficeSkyline`): uma planície escura com estradas de postes laranja, uma **cidade a 5–7 km** aos pés das colinas (milhares de janelas acesas, luzes vermelhas de aviação) e **colinas** a 8–20 km fechando o horizonte. O brilho alaranjado da cidade aparece nas nuvens.
- **Chuva:** três camadas caindo a profundidades diferentes (0,8 m, 3 m e 9 m além do vidro), inclinadas pelo vento — as mais próximas se movem mais com o olhar.
- **Vidro molhado:** gotículas que se formam e evaporam e gotas que escorrem aos trancos deixando rastro limpo. As gotas refratam a paisagem (lente invertida) e o resto do vidro fica embaçado em manchas.
- **Relâmpagos:** de 14 a 34 s cai um raio — céu, colinas e a fachada se acendem, um raio aparece no céu, a sala pisca em branco e o trovão chega depois (mais rápido e forte quando perto). A autoridade do nível sorteia e envia `world_event` `"thunder"`; a direção do raio deriva do mesmo valor, então todos o veem no mesmo lugar.

## Água de amêndoas

O escritório é abastecido de água de amêndoas, mas com **menos garrafas** (7% das células, antes 14%) e cada uma **vale menos aqui**: beber no Abandoned Office devolve +8% de sanidade e +6% de stamina (40% do efeito normal, +20%/+15%). Ajuste em `LEVEL4_WATER_CHANCE` ([ProceduralMap.ts](../../src/game/ProceduralMap.ts)) e `ALMOND_LEVEL4_FACTOR` ([GameEngine.ts](../../src/game/GameEngine.ts)).

## Quebras de personagem

Cerca de 30% das falas, o funcionário "sai do personagem" e revela que **ninguém ali é real** — são ecos de quem trabalhava no escritório, que está abandonado há muito tempo. Às vezes aproveitam e repetem o próprio ID. É lore e dica ao mesmo tempo.

## Segredos

Dois caminhos opcionais saem deste nível (ambos individuais, se **Rotas secretas** estiver ativado):

- **Level G** — uma passagem escondida, convergindo no marcador da "porta de escritório que não deveria existir". Chegar à célula dela leva o jogador ao [Level G](level-g.md), e a saída de lá devolve a este nível.
- **Level FUN** — um **bolo escondido** num ponto do mapa. Aperte `E` perto dele quando **ninguém estiver olhando** para comê-lo e você é levado ao [Level FUN](level-fun.md). O radar mostra um marcador do bolo enquanto ele não foi comido.

## Referências no código

- `ProceduralMap`: `level4Employees`, `drawLevel4Programmers`, `abandonedSecretX/Z`, `funCakeX/Z`.
- `GameEngine`: `level4DoorOpen`, `setupOfficeWorkers`, `learnMegId`/`onMegProgress` (senha no HUD), `updateOfficeStorm` (raios), diálogo M.E.G., `MegDoorModal`.
- Textos: `meg.*`, `dialog.*`, `act.megDoor`, `eng.megDoor*`, `eng.megHint`, `eng.megId*`, `hud.meg*`.
