# Level 3 — Electrical Room (Brick Offices)

- **Id de rede:** `3` (conteúdo `8`) — **Grid:** 48×48
- **Entidades:** matilha de **8 `HOUND`** patrulhando a rota
- **Próximo nível:** Abandoned Office · **Recebe:** a saída do [Lights Out](level-6-lights-out.md)

## Ambientação

Escritórios de tijolo aparente, com iluminação fraca e uma sala elétrica inteira por religar.

## Objetivo

Ligar **5 interruptores** espalhados pelo mapa. Quando as 5 luzes acendem, a **porta de barras** da saída se abre:

- `INTERRUPTOR LIGADO: n/5`
- `AS 5 LUZES ACENDERAM. A PORTA DE BARRAS ESTÁ ABERTA.`

A saída só funciona com a porta aberta. O estado dos interruptores é compartilhado: um interruptor ligado por um jogador conta para todos.

Posições (células): `(17,8)`, `(35,8)`, `(11,25)`, `(26,25)`, `(32,41)`.

## Mecânicas

- **Teto baixo**: trechos do último setor têm corredores baixos; ande **agachado** (`Ctrl`/`C`) ou o jogo avisa *"O teto é baixo demais. Agache-se para passar."*
- **Matilha de Hounds**: os 8 cães ficam distribuídos pelo mapa. Hounds congelam sob o olhar direto — veja o [catálogo](../entities.md). Atenção às salas com vários.
- Interagir com cada interruptor: `E` (*"Ligar interruptor"*).

## Dicas

- Dividam os interruptores entre os jogadores, mas não deixem ninguém sozinho perto da matilha.
- Cantos de corredor baixo são bons para observar o cão antes de entrar.

## Referências no código

- `ProceduralMap`: `level3Switches`, `level3SwitchesOn`, `level3GateOpen`, `level3LowCorridor`.
- `GameEngine`: sincronização de interruptor (`level3Switch`) e checagem de saída (`level3GateOpen`).
