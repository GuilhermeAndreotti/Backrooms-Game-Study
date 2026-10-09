# Level 5 — Terror Hotel

- **Id de rede/conteúdo:** `13` — **Grid:** 60×60, células de 4 m.
- **Rota:** Abandoned Office → Terror Hotel → Lights Out → Poolrooms → Level 79.
- **Entidades:** Bellman ×1, Deathmoths ×3.

## Ambientes e puzzles

O hotel tem planta finita, decoração dos anos 1920/1930, carpete vermelho, madeira escura, lustres e detalhes dourados. A seed determina as pistas e a ordem das alcovas.

1. **Main Hall:** encontre quatro cartões nos quartos. Cada cartão associa um naipe a um dígito; a ordem dos quatro quadros numerados da galeria determina a combinação da caixa da recepção. Abra a caixa, recolha a chave compartilhada e destranque a **ROOM 512**.
2. **The Beverly Room:** encontre as quatro peças de Mahjong nas alcovas liberadas em sequência e coloque-as na mesa. As peças recolhidas ficam disponíveis para o grupo inteiro. A última peça provoca cinco segundos de blackout, após os quais a escada da Boiler Room é liberada.
3. **Boiler Room:** explore os avisos de manutenção e configure as válvulas: **A LOW, B MEDIUM, C HIGH**. O seletor só aplica a escolha ao confirmar. Um erro anuncia vapor com 1,8 segundo de antecedência e bloqueia temporariamente duas passagens opcionais; a rota central continua disponível. A combinação correta abre a saída.
4. **Corredor final:** ao passar pelo ponto sem retorno, o hotel desaparece apenas para aquele explorador e as luzes acendem atrás dele. A porta final registra sua chegada; o servidor espera pelos demais exploradores vivos antes de avançar ao Level 6.

## Ameaças

O Bellman aparece de forma intermitente, em posições não observadas. Corrida, permanência prolongada e pressão descontrolada podem transformar a aparição em perseguição. Quebrar a linha de visão ajuda a despistá-lo. As Deathmoths reagem à lanterna a curta distância e à aproximação excessiva. O blackout do puzzle e a saída liberada suspendem capturas.

## Multiplayer e implementação

- `src/shared/hotel.ts` valida as ações no servidor: distância, altura, linha de visão, etapa e `epoch` da expedição. Revisões impedem que snapshots antigos revertam o progresso.
- Chave, portas, peças e válvulas pertencem à sala. Desconexões não levam itens necessários embora; entrada tardia recebe o estado atual.
- `hotelDirector.ts` usa a autoridade eleita do nível para aparições e eventos, com checkpoints e cache de entidades para troca de autoridade.
- `hotelLayout.ts` compartilha a planta com o servidor; `hotelWorld.ts` renderiza células, objetos e luzes agrupadas pelo `LightPool`.
- O id `13` não representa ordem de progressão: use `nextMainLevel`, pois o Hotel segue para `6` e depois `5`.

## Verificação

```bash
npm run lint
npm run test:hotel
npm run dev
# Em outro terminal, com o servidor em execução:
npm run test:hotel:multiplayer
```

O teste de regras cobre 150 seeds, conectividade, pré-requisitos e recuperação de pressão. Os testes WebSocket cobrem coleta concorrente, entrada tardia, troca de autoridade, reset, ações de expedições antigas e as duas rotas do Lights Out. `HOTEL_TEST_WS` permite apontar a integração para outro servidor de desenvolvimento.

Referência temática: https://backrooms-wiki.wikidot.com/level-5.
