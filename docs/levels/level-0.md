# Level 0

- **Id de rede:** `0` — **Grid:** 64×64 (o maior do jogo)
- **Entidades:** nenhuma fixa (sem entrada em `LEVEL_DEFS`); a ameaça é o ambiente
- **Próximo nível:** Level 1

## Ambientação

O clássico das Backrooms: carpete amarelado úmido, papel de parede amarelo, zumbido de lâmpadas fluorescentes e um labirinto de corredores, salas amplas, áreas abertas, *pit rooms* e arcos. O mapa é gerado pela *seed* da sala — todos veem o mesmo labirinto.

## Mecânicas

- **Luzes que piscam**: a autoridade do nível sorteia *blackouts* e tempestades de flicker e os transmite (`world_event`), para que todos vejam o mesmo evento.
- **Red Room**: salas raras de carpete vermelho-escuro, silenciosas. Ficar nelas drena a sanidade sem aviso. O HUD mostra a exposição.
- **Passagens falsas**: perto do fim do labirinto há duas passagens; só uma leva adiante, a outra leva de volta ao vermelho. Um **Scrap of Note** com uma dica rabiscada na margem diz qual é a certa: *a que tem uma mesa com um papel*.
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
