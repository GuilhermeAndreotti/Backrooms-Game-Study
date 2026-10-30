# Poolrooms (Dark Poolrooms, tema Level 37.2)

- **Id de rede:** `5` (conteúdo `7`) — **Grid:** 96×96 (três partes; a parte 1 é um único salão de 29×14 células, a parte 2 ocupa 46×31)
- **Entidades:** `CLUMP` (parte 1); `O VIGIA` só da grade em diante — um na parte 2, um na parte 3
- **Exibido como:** Level 37 - Poolrooms · **Vem de:** [Level Fun](level-fun.md)
- **Saídas (lado a lado, no fim da parte 3):** [Level 79 — Space Station](level-79-space-station.md) (porta de estação, leva a sala) **ou** [Level 94 — Motion](level-94-motion.md) (porta para a estrada, individual; desligada se a sala desativar "Rotas secretas")

O plano das partes 2 e 3 está em [poolLayout.ts](../../src/game/levels/poolLayout.ts) (dados puros, sem seed — inclusive o labirinto, gerado com uma semente fixa). As coordenadas ali (e em `carveLevel7`) são as *autorais*, de antes de os salões encolherem: `poolRemap` tira algumas linhas e colunas de água vazia ou de estrutura repetida das partes 1 e 2 (`POOL_DROP`) e desloca a parte 3 inteira para continuar encaixada. Tudo o que o módulo exporta já está em coordenadas finais. A geometria fica em [poolWorld.ts](../../src/game/levels/poolWorld.ts); fôlego, ambientação, luz, alavancas e a comporta final em [poolDirector.ts](../../src/game/levels/poolDirector.ts). As três partes são iluminadas como as Poolrooms clássicas.

## Parte 1 — As válvulas (exploração)

**Um único salão alagado**, **sem o Vigia**: da sala de partida seca até a grade na parede leste. Duas meias-paredes o dividem em baias, mas nada fica fechado: a água tem a mesma altura em todo lugar e dá pé do começo ao fim. Drene a contaminação girando **3 válvulas**, espalhadas pelas paredes do salão, **na ordem correta** (`poolValveOrderForSeed`, em [poolroomsPuzzle.ts](../../src/game/poolroomsPuzzle.ts)). O salão tem **três pistas** no piso (símbolo + posição na sequência), longe das válvulas e umas das outras. **A cada válvula certa a água baixa um degrau**; uma errada reinicia a sequência e a água volta a subir. O progresso é compartilhado pela sala (`poolroomsState` no servidor).

Quando a terceira gira, o salão drena e **a grade na parede leste (célula `31,9`) sobe**, abrindo o caminho para a parte 2.

## Parte 2 — A Caçada (verticalidade)

Um natatório enorme com água pelo tornozelo, em três salões (**arquibancadas**, **piscina de competição**, **escorregadores**) e uma **ala de máquinas** a leste (caixas d'água, passarelas, uma ponte de tubos sem um vão, pilhas de blocos).

- **Subir:** blocos sobem de ~0,9 m em ~0,9 m (pule), escadas de marinheiro (encoste olhando e segure `W`), escadas.
- **A regra:** o Vigia **nunca sai do chão** e não alcança quem está com os pés **≥ 2 m acima dele**. Blocos baixos não salvam.
- **Ronda:** anda entre os postos de salva-vidas dos salões e para em cada um, varrendo a água com o olhar; o corpo vira para onde ele olha (o cone de visão é o que ele mostra).
- Quem ele vê **na água ao seu alcance** ouve **dois apitos** — ele para, leva o apito à boca — e é perseguido em disparada, direto. Quem fica lá em cima ele espreita de braços erguidos por alguns segundos e depois **vai embora** para o outro lado do circuito, ignorando você enquanto não descer.
- As alavancas aparecem no **radar** (laranja até serem puxadas; uma seta na borda aponta as que estão fora do alcance).
- **Som:** correr na água chama atenção; andar quase não; agachado, quase nada. Cair de uma passarela é ouvido do outro lado do salão.
- **Objetivo: as 3 alavancas** da ala de máquinas — duas no chão, expostas, uma no alto de uma caixa d'água (`POOL_LEVERS`). Puxar uma (`E`) faz barulho. Estado compartilhado pela sala (mensagem `pool_lever`, validada pelo servidor). Com as três, **abre a porta** no alto da passagem sul (`48,31`), à qual se chega pelas passarelas (rota oeste com a passarela desabada, ou leste pelas escadas do escorregador).

## Parte 3 — As Profundezas (labirinto submerso)

Um **labirinto alagado** de corredores largos (duas células, 8 m) sob um teto logo abaixo da linha d'água, com **poços de ar** espalhados — nenhum trecho sem ar passa de dois cômodos. Sobre o teto do labirinto fica um **salão escuro de azulejo** onde os poços se abrem como bocas de poço: é por ali que o Vigia anda.

- **Nadar:** `Espaço` sobe, `C`/`Ctrl` mergulha, `W` segue o olhar debaixo d'água, `Shift` nada mais rápido (gasta fôlego e estamina).
- **Fôlego:** ~32 s de ar, que só gasta com a cabeça submersa e enche em ~2,4 s num poço. O medidor aparece quando importa; som e imagem se fecham quando falta. Ficar sem ar não mata: você apaga e acorda no último chão seco, com perda de sanidade. **Os poços de ar são iluminados.**
- **O Vigia:** faz a ronda **de poço em poço** no salão por cima, e em cada um se debruça sobre a borda para espiar, com um braço esticado poço abaixo. Debruçado, **puxa quem emerge do lado dele** (até ~3,2 m da borda onde está), mas não alcança quem emerge do lado oposto do poço nem quem mergulhou. Ele vê pelo poço quem está na superfície, ouve braçadas e o arquejo de quem sobe sem fôlego, e **segue as bolhas** de poço em poço.
- **O fim:** quem chega aos últimos cômodos o encontra **esperando na borda do último poço**. Do poço sai um canal a leste; a escada leva ao patamar (alto demais para ele). Gire a **roda da comporta** (`E`, barulhenta) e escolha a porta.

## Perigos

- **Água tóxica** (parte 1): exposição de 8 s te arranca dali para um ponto seguro.
- **`CLUMP`** (parte 1): perde você se estiver submerso.
- **`O VIGIA`** (partes 2 e 3): ver [entities.md](../entities.md).

## Referências no código

- `ProceduralMap`: `carveLevel7` (parte 1), `updatePoolroomsWater` (nível da água do salão), `carvePoolDepths`, `waterSurfaceAt`, `ceilingAt`, `blocksBody`, `vigiaMayStand`, `standHeightAt`, `setPoolLevers`, `setPoolExitOpen`.
- `PlayerController.updatePoolBody`: degraus, quedas, escadas, natação.
- `WanderingEntity` + [vigiaBrain.ts](../../src/game/mobs/vigiaBrain.ts): estados do Vigia (a direção em que olha é replicada no campo `h` do frame `entities`); `GameEngine.pickVigiaTarget`, a regra de altura e o alcance no poço (`VIGIA_WELL_REACH`) no `catch`.
- Servidor: `poolroomsSnapshot` (válvulas + `levers`), mensagens `valve_turn` e `pool_lever`.
- [Water.ts](../../src/game/Water.ts): superfície com ondulações reais, Fresnel, janela de Snell vista de baixo.
