# Level G — The Small Office (secreto)

- **Id de rede:** `7` (conteúdo `4`) — **Grid:** 18×18 (pequeno de propósito)
- **Entidades:** o **Finger King** (`FINGER_KING`), exclusivo do nível — ecossistema `bespoke`
- **Entrada:** passagem escondida no [Abandoned Office](level-4-abandoned-office.md) — **Saída:** porta de emergência (retorna ao Abandoned Office)

## Ambientação

Um escritório **pequeno demais**, abandonado, com três setores:

1. **Recepção**
2. **Arquivo**
3. **Sala Principal** (com o computador)

Ao entrar: *"LEVEL G. Um escritório pequeno demais. Encontre os 3 documentos... e ouça os dedos."*

## Objetivo

1. Encontrar **3 documentos** espalhados pelos setores. Cada um revela **um dígito** do código (memorando, ficha do arquivo e relatório de turno).
2. Ir ao **computador antigo** da Sala Principal (`E`) e digitar o **código de 3 dígitos** no terminal SISADM para liberar a porta de emergência.
3. Correr até a **porta vermelha de emergência** antes que o Finger King o alcance.

Código errado: *"ACESSO NEGADO. Algo ouviu o terminal..."* — o rei é atraído. Código certo: *"ALARME! A PORTA DE EMERGÊNCIA DESTRAVOU. CORRA!"*

Os documentos de um colega também aparecem no seu registro (*"Um colega achou o DOCUMENTO n/3"*).

## O Finger King

Caça o jogador pelo som dos **dedos arrastando e batendo nas paredes** ("tec tec tec tec") — um aviso sonoro antes de aparecer. É **invisível ao radar** de propósito. Ele é o motivo de o nível ser pequeno: não há para onde fugir por muito tempo.

### Esconder-se

**Agache dentro dos armários** para se esconder:

- *"ESCONDIDO. Fique abaixado e em silêncio..."*
- Se ele desconfiar: *"Algo bate na porta do armário. Três vezes. Não respire."*
- Se te achar: *"ELE SABE ONDE VOCÊ ESTÁ. SAIA DAÍ."*

Esconderijos são temporários; a sensação de pavor (*dread*) aumenta o efeito de VHS na tela conforme ele se aproxima.

## Entrada e saída

- **Entrada**: chegar à célula da "porta de escritório que não deveria existir", no Abandoned Office (conquista **Horário de Expediente**). Ou escolher Level G no seletor do lobby.
- **Saída**: pela porta de emergência o jogador volta ao Abandoned Office (conquista **Saída de Emergência**).

## Referências no código

- `GameEngine`: `updateLevelG`, `updateKingPresence`, `updateKingSighting`, `updateKingGrab`, `levelGAlarm`.
- [mobs/fingerKing.ts](../../src/game/mobs/fingerKing.ts), [KingScratches.ts](../../src/game/KingScratches.ts), [TerminalModal.tsx](../../src/components/TerminalModal.tsx).
- Textos: `term.*`, `eng.doc*`, `eng.hidden`, `eng.found`, `sector.g1`–`sector.g3`.
