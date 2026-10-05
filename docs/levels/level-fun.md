# Level FUN (secreto)

- **Id de rede:** `9` (conteúdo `11`) — **Grid:** 48×48 — **Layout:** [levels/funLayout.ts](../../src/game/levels/funLayout.ts)
- **Entidades:** nenhuma de perseguição (`bespoke`). Os "convidados" são **aparições roteirizadas e cenas**, nunca caçadores
- **Entrada:** bolo escondido no [Abandoned Office](level-4-abandoned-office.md), ou seletor do lobby — **Saída:** uma porta de serviço que leva à [Level 79 — Space Station](level-79-space-station.md), pulando as Poolrooms (rota alternativa; **não** encerra a expedição). Quem veio do Abandoned Office vai **sozinho** e chega à estação à frente do grupo; se a sala começou no FUN pelo lobby, **a sala inteira** segue junto.

## Ambientação

Um salão de festas infantil **abandonado**: balões, faixas, desenhos de giz de cera, bolo velho. Tudo parece uma festa que ficou esperando por convidados que nunca foram embora. O medo aqui é de atmosfera: luzes que piscam quando algo se aproxima, objetos que mudam de lugar quando você vira as costas, sorrisos imóveis. Não há perseguição, mas o diretor tem o poder de matar o explorador local em cenas específicas (`host.kill`).

## Estrutura

Uma rota com ramificações, em três movimentos, cada um abre um portão colorido (`g1`, `g2`, `g3`) até a saída:

```
Puzzle 1  Hall A (spawn) + salas A2/A3 ─────────▶ portão g1
Puzzle 2  galeria (hub) + 4 salas temáticas ────▶ portão g2
Puzzle 3  corredor longo → depósito → salão final ▶ portão g3 ─▶ saída
          (cozinha e sala de brinquedos saem do salão final)
```

### Puzzle 1 — Preparar a festa
Há **cinco lugares numerados** na mesa. Eles devem ser preenchidos **na ordem em que os desenhos de giz de cera indicam**. Existe um item **isca** que não pertence à mesa (a ordem certa não o inclui).

### Puzzle 2 — Quatro salas, quatro símbolos
Cada sala temática (vermelha, azul, amarela, verde) pinta um **símbolo**, apresentado em **contagens** (quantas vezes ele aparece). Um painel ao lado da porta central tem quatro botões com **símbolos**; as cores dos botões **não** são as cores das salas — o símbolo é a pista. Pressione os símbolos na ordem correta. O código deriva da seed.

### Puzzle 3 — O último salão
Encontre **um bolo, um presente e um balão dourado** (cada um atrás de uma pequena interação: um armário, um baú azul, vasculhar os balões) e coloque-os na **mesa comprida**. As notas espalhadas dão dicas (*"os presentes dormem no baú azul"*, *"o balão dourado se esconde entre os outros"*).

## Itens carregáveis

Apenas **uma pessoa** pode carregar cada item: pegar um é um *pedido* (`fun_take`) arbitrado pelo servidor, e todos os clientes mostram/escondem os objetos conforme quem o servidor diz que os segura. Se um item estiver com um colega, o pedido é recusado.

## Cenas

O diretor ([funDirector.ts](../../src/game/levels/funDirector.ts)) controla apagões, tempestades de flicker, portas que batem e aparições de convidados. A música e os sons mudam por **estágio** (a festa "desanda" conforme os puzzles avançam). Essas cenas são cosméticas e locais — por isso, ali, `Math.random()` é aceitável, ao contrário do que afeta o mapa.

## Sincronia

O progresso dos puzzles são **fatos idempotentes** (lugar preenchido, painel resolvido, contêiner aberto, item colocado): aplicados localmente, anunciados via `fun_event` e reaplicados quando chegam de colegas. O servidor mantém `funFacts` e `fun_state` para quem entra depois, e limpa tudo quando ninguém está mais no nível.

## Referências no código

- [funDirector.ts](../../src/game/levels/funDirector.ts), [funWorld.ts](../../src/game/levels/funWorld.ts), [funLayout.ts](../../src/game/levels/funLayout.ts), [LevelFunModels.ts](../../src/game/LevelFunModels.ts).
- Servidor: `fun_event`, `fun_take`/`fun_drop` (broadcast `fun_carry`), `fun_sync`/`fun_state`. Painel do Puzzle 2: [FunPanelModal.tsx](../../src/components/FunPanelModal.tsx).
- Textos: `fun.*`.
