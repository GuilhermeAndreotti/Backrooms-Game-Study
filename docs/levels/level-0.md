# Level 0

- **Id de rede:** `0` — **Grid:** 64×64 (o maior do jogo)
- **Entidades:** nenhuma fixa (sem entrada em `LEVEL_DEFS`); a ameaça é o ambiente
- **Próximo nível:** Level 1

## Ambientação

O clássico das Backrooms: carpete amarelado úmido, papel de parede amarelo, zumbido de lâmpadas fluorescentes e um labirinto de corredores, salas amplas, áreas abertas, *pit rooms* e arcos. O mapa é gerado pela *seed* da sala — todos veem o mesmo labirinto.

## Mecânicas

- **Luzes que piscam**: a autoridade do nível sorteia *blackouts* e tempestades de flicker e os transmite (`world_event`), para que todos vejam o mesmo evento.
- **Pit rooms**: salas cujo chão foi engolido por poços quadrados enormes (2,9 m de lado, um por célula). Sobram só uma beirada de carpete junto às paredes e passarelas estreitas (~1,1 m) entre os poços; as portas mantêm o piso. **Cair num poço mata** (causa `fall`): a câmera despenca e escurece, e você passa a espectar. Um pulo correndo atravessa um poço por pouco; o cheat LIFE anda no ar. Itens que caem numa célula de poço vão para a beirada.
- **Red Room**: salas raras de carpete vermelho-escuro, silenciosas. Ficar nelas drena a sanidade (cerca de 70 s de cheia a zero, mesmo com a lanterna; mais rápido com um monstro por perto) e impede que ela se recupere. Uma vinheta vermelha vai fechando a tela conforme a exposição.
- **Passagens falsas**: perto do fim do labirinto há duas passagens; só uma leva adiante, a outra dá numa sala vermelha. A certa dá numa **pit room** estreita com a saída no fundo: é obrigatório atravessá-la pela passarela entre as duas fileiras de poços (há sempre uma, com ~1,1 m). O labirinto final também tem algumas clareiras de pit room. Um **Scrap of Note** com uma dica rabiscada na margem diz qual é a certa: *a que tem uma mesa com um papel*.
- **Papel da saída** (`E` na mesa): explica a saída deste nível.

## Objetivo

Encontrar a **saída noclip**: uma **parede** ou um **chão** sem física, cercado de **fita isolante amarela e preta**. Atravesse a parede (instantâneo) ou afunde no chão (cerca de 0,45 s) para trocar de nível.

## Dicas

- Fragmentos de nota e itens (água de amêndoas, foto antiga, fita cassete…) estão espalhados pelo mapa; recolha-os com `E`.
- Evite se demorar em salas vermelhas.
- A saída fica em um ponto determinístico: se alguém do grupo achar, o resto só precisa seguir.

## Referências no código

- Geração: `ProceduralMap` (`noclipCellX/Z`, `noclipKind`, `correctDoorMarker`).
- Gatilho da saída: `GameEngine.ts` (`isInNoclipExit`, `noclipDwell`).
- Pit rooms: `ProceduralMap` (`isPitHole`, `isOverPit`, `PIT_HOLE_HALF`); a queda: `GameEngine.ts` (`startPitFall`, `updatePitFall`).
