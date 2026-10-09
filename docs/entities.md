# Catálogo de entidades

Cada entidade hostil é uma `MobDefinition` em [src/game/mobs/](../src/game/mobs/), registrada de forma **total** em [mobs/registry.ts](../src/game/mobs/registry.ts) (um `EntityType` sem definição quebra o build). Os tipos ficam em [src/shared/entityTypes.ts](../src/shared/entityTypes.ts), compartilhado com o servidor — que também usa a lista para validar frames de `entities`.

Cada monstro responde a uma **pergunta** que o jogador deve fazer a si mesmo. Não há ataque nem como matar uma entidade em nenhum ponto do jogo: só fuga, esconderijo e despiste.

## Quem aparece onde

Elencos de [levels/registry.ts](../src/game/levels/registry.ts). "Estático" = posições fixas; "sob demanda" = invocação periódica; "bespoke" = lógica própria do nível.

| Nível | Modelo | Entidades |
|---|---|---|
| Level 0 | — | nenhuma |
| Level 1 | estático (só no andar 1) | `DULLER` ×2, `CLUMP`, `ECO`, `OBSERVADOR` (+ *Smilers* no andar 3, via `GameEngine`) |
| Level 2 | estático, 11 posições | `HOUND` ×3, `SKIN_STEALER` ×2, `WRETCH` ×3, `SOMBRA`, `IMITADOR` ×2 |
| Electrical Room | estático | `HOUND` ×8 |
| Abandoned Office | bespoke | nenhuma hostil (NPCs M.E.G.) |
| Terror Hotel | estático, dirigido por eventos | `BELLMAN`, `DEATHMOTH` ×3 |
| Poolrooms | estático | `CLUMP`, `VIGIA` |
| Level 79 | estático | `ALIEN` |
| Lights Out | sob demanda | pool `DULLER`, `SKIN_STEALER`, `WRETCH`, `HOUND` |
| Level G | bespoke | `FINGER_KING` |
| Level 94 — Motion | bespoke | `TOWN_KING` (no trono desde o início), `ANIMATION` ×4 (só à noite) |
| Level FUN | bespoke | nenhuma (cenas roteirizadas) |

## Entidades

| Tipo | Arquivo | Pergunta / sentido | Comportamento | Como lidar |
|---|---|---|---|---|
| `DULLER` | [duller.ts](../src/game/mobs/duller.ts) | — | Sombra esguia e semitransparente que flutua e **atravessa paredes** | Não confie em paredes |
| `HOUND` | [hound.ts](../src/game/mobs/hound.ts) | Olhar | Cão rastejante, rápido e persistente (audição/proximidade). **Congela/recua** se você o encara | Sustente o olhar |
| `CLUMP` | [clump.ts](../src/game/mobs/clump.ts) | Audição | Núcleo carnudo com espinhos, **sem olhos**; raio de alerta proporcional ao seu barulho | Seja silencioso; nas Poolrooms, submerja |
| `SKIN_STEALER` | [skinStealer.ts](../src/game/mobs/skinStealer.ts) | "Isso é uma pessoa?" | Finge ser explorador (voz pedindo ajuda); a menos de **5,5 m** a máscara cai e ele ataca | Não se aproxime de "sobreviventes" |
| `WRETCH` | [wretch.ts](../src/game/mobs/wretch.ts) | — | Esquelético, pele em carne viva, caveira gritando; corredor implacável após te ver | Corra, quebre a linha de visão |
| `ECO` | [eco.ts](../src/game/mobs/eco.ts) | "Estou fazendo barulho?" | Humanoide distorcido sem rosto; reage só a **som** (correr/empurrar caixa soa longe; andar menos; agachado quase nada). Acelera ao longo da perseguição | Agache, evite correr |
| `OBSERVADOR` | [observador.ts](../src/game/mobs/observador.ts) | "Ele está me vendo?" | Alto, coberto de olhos. **Contato visual sustentado o faz atacar** (e não volta atrás) — o inverso do Hound | Desvie o olhar |
| `IMITADOR` | [imitador.ts](../src/game/mobs/imitador.ts) | "Isso é o que parece?" | Humanoide genérico **imóvel**; revela-se (olhos abrem, escurece, corre) ao chegar perto | Dê a volta |
| `SOMBRA` | [sombra.ts](../src/game/mobs/sombra.ts) | "Tenho luz suficiente?" | Massa negra quase invisível no escuro. **Fraca e fugitiva sob luz**; só perigosa para quem está no escuro | Fique em áreas iluminadas |
| `VIGIA` | [vigia.ts](../src/game/mobs/vigia.ts) | — | Enorme, membros longuíssimos; **marca os jogadores desde o início das Poolrooms**, enxerga longe, anda em passo lento | Planeje a rota; não fique exposto |
| `CEIFADOR` | [ceifador.ts](../src/game/mobs/ceifador.ts) | "Ele aprendeu meu padrão?" | Alto, encapuzado, **o mais rápido**; aparece perto das células mais visitadas pelo grupo (`VisitTracker`) | Varie rotas (hoje nenhum nível o invoca; segue disponível no cheat SKIN) |
| `ANIMATION` | [animation.ts](../src/game/mobs/animation.ts) | "Eles me viram?" | Personagens de desenho antigo, em stop-motion. Veem quem está à frente com linha livre (mais longe se você corre ou usa a lanterna, bem menos agachado); desistem após ~3,5 s sem te ver; **nunca entram em casas** | Entre numa casa, use carros e becos, apague a lanterna |
| `TOWN_KING` | [townKing.ts](../src/game/mobs/townKing.ts) | "Como passo por ele?" | Sentado no trono até alguém chegar perto ou passar por ele; então persegue sem parar, mais devagar que uma corrida, com alcance longo (2,4 m). Preso ao salão | Use colunas e mesas: ele contorna, você se espreme ao lado |
| `ALIEN` | [alien.ts](../src/game/mobs/alien.ts) | — | Patrulha corredores e cabines, caça a quem vê; **nunca entra em cabine durante a perseguição** | Esconda-se em cabines |
| `BELLMAN` | [bellman.ts](../src/game/mobs/bellman.ts) | "Estou chamando atenção?" | Aparições intermitentes; corrida, demora e pressão podem provocar perseguição | Quebre a linha de visão e evite correr sem necessidade |
| `DEATHMOTH` | [deathmoth.ts](../src/game/mobs/deathmoth.ts) | "Minha lanterna está atraindo algo?" | Mariposa de voo baixo; reage à luz até 6 m e à proximidade até 2 m, com linha de visão | Apague a lanterna e mantenha distância |
| `FINGER_KING` | [fingerKing.ts](../src/game/mobs/fingerKing.ts) | — | Exclusivo do Level G. Anuncia-se por **dedos arranhando paredes**; fica mais forte ao longo do nível, mas nunca passa de um corredor em disparada (a corrida final é vencível). Se você o encara de perto, ele **encara de volta** e então ataca | Esconda-se em armários, agachado |

## Notas técnicas

- **Rádio**: algumas entidades (`FINGER_KING`, `CEIFADOR`, `TOWN_KING`) são **invisíveis ao radar** de propósito — "sem aviso" é a mecânica.
- **Autoridade**: só o cliente-autoridade do nível simula as entidades e transmite `entities`; os demais renderizam. Veja o README principal.
- **Falas/sons**: vozes procedurais em [AudioManager.ts](../src/game/AudioManager.ts); falas legendadas em `sp.*` no i18n.
- **Perseguição direta**: hoje as entidades perseguem o jogador (BFS), não a posição de um ruído; "distrações" funcionam apenas porque ficar quieto esfria a perseguição. Isso e outras limitações conhecidas estão nos comentários de escopo no topo de cada arquivo de mob.
- **Novo tipo**: adicione em `EntityType`, crie `mobs/<nome>.ts`, registre em `mobs/registry.ts`, coloque no `LEVEL_DEFS` e adicione a fala em `sp.*` nas três línguas.
