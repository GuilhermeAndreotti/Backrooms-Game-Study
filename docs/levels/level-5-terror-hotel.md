# Level 5 — Terror Hotel

- **Id de rede/conteúdo:** `13` — **Grid:** 60×60, células de 4 m.
- **Rota:** Abandoned Office → Terror Hotel → Lights Out → Poolrooms → Level 79.
- **Entidades:** Bellman ×1, Deathmoths ×3.

## Ambientes e puzzles

O hotel tem planta finita e decoração dos anos 1920/1930. Os corredores têm papel de parede damasco bordô, carpete de hexágonos e luminárias de teto. Os quartos têm papel listrado verde e piso de taco. O Beverly Room tem piso de mármore xadrez, colunas, piano e bar, e a Boiler Room tem chapas rebitadas e piso de chapa xadrez. Todas as texturas são procedurais (canvas), em `hotelWorld.ts`. A seed determina os dígitos dos cartões, a ordem dos retratos, a ordem das alcovas e a pressão de cada válvula.

1. **Main Hall:** doze quartos iguais (3×2 células, 12×8 m), numerados de 501 a 514 sem o 513, cada um atrás de uma entrada com porta e banheiro. Os quatro quartos com cartão mostram o naipe na placa da porta (ex.: `ROOM 503 ♠`). O cartão fica no criado-mudo e associa o naipe a um dígito sorteado, que não tem relação com o número do quarto. Os quatro retratos I→IV atrás do balcão da recepção dão a ordem dos naipes. Ler o cartão (ou só chegar perto dele) registra a descoberta no servidor para a sala inteira: todos recebem um aviso e a HUD mostra `CÓDIGO DA RECEPÇÃO` com os dígitos que qualquer explorador já encontrou. O painel da caixa repete esses dígitos. Abra a caixa, recolha a chave compartilhada e destranque a **ROOM 512**.
2. **The Beverly Room:** encontre as quatro peças de Mahjong nas alcovas liberadas em sequência e coloque-as na mesa. A porta da vez tem uma lâmpada acesa acima dela. As peças recolhidas ficam disponíveis para o grupo inteiro. A última peça provoca cinco segundos de blackout, após os quais a escada da Boiler Room é liberada.
3. **Boiler Room:** ao pé da escada há a tabela de manutenção: **abaixo de 60 PSI → HIGH, de 60 a 120 → MEDIUM, acima de 120 → LOW**. Ao lado de cada válvula (A, B, C) há um manômetro com a leitura sorteada pela seed (`hotelPuzzle().psi`, faixas em `HOTEL_PSI_BANDS`). Leia, converta e configure. O painel da válvula mostra a leitura do manômetro, a tabela e o ajuste atual; o seletor só aplica a escolha ao confirmar. Um erro anuncia vapor com 1,8 segundo de antecedência e bloqueia temporariamente duas passagens opcionais; a rota central continua disponível. A combinação correta abre a saída.
4. **Corredor final:** ao passar pelo ponto sem retorno, o hotel desaparece apenas para aquele explorador e as luzes acendem atrás dele. A porta final registra sua chegada; o servidor espera pelos demais exploradores vivos antes de avançar ao Level 6.

Em todas as etapas a HUD mostra o objetivo atual da equipe (título + dica), derivado só do estado da sala, então é igual para todos os exploradores.

## Ameaças

O Bellman aparece de forma intermitente (o primeiro após ~40 s, depois a cada ~50 s), em posições não observadas, anunciado pelo sino da recepção. Ele caminha devagar até o explorador e para a alguns metros, encarando; some alguns segundos depois de sair de vista (ou quando seu tempo acaba), nunca à vista de alguém. Corrida, vapor de pressão descontrolada e permanência prolongada numa área cuja etapa já foi resolvida podem transformar a aparição em perseguição. Quebrar a linha de visão ajuda a despistá-lo. As Deathmoths reagem à lanterna a curta distância e à aproximação excessiva. As luzes oscilam devagar (≈1 Hz, nunca abaixo de 60%) em eventos, perto do Bellman e com vapor — sem estrobo. O blackout do puzzle e a saída liberada suspendem capturas.

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
