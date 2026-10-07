# Level 1 — Habitable Zone (a garagem)

- **Id de rede:** `1` — **Grid:** 48×48 — **Layout:** [levels/garageLayout.ts](../../src/game/levels/garageLayout.ts)
- **Entidades:** `DULLER` ×2, `CLUMP`, `ECO`, `OBSERVADOR` (só no andar 1) + os *Smilers* do andar 3
- **Próximo nível:** Level 2 · **Secreto:** corredor escuro → [Level 6 (Lights Out)](level-6-lights-out.md)

## Ambientação

Um estacionamento de **três andares** de concreto. Os andares ficam lado a lado no eixo X, cada um um pé-direito mais alto que o anterior, separados por divisórias sólidas; **rampas** são a única forma de subir.

```
x:  2 ─── 14 │15│ 16 ─── 30 │31│ 32 ─── 45
     andar 1     andar 2       andar 3
     explorar    código        apagões
```

## Andar por andar

### Andar 1 — Estacionamento
Estacionamento aberto com divisórias. É o **único andar com monstros** e eles nunca usam as rampas. O elenco ensina as mecânicas básicas, uma por vez:

| Entidade | Lição |
|---|---|
| `DULLER` (×2) | Perseguição por proximidade |
| `CLUMP` | Perseguição por audição |
| `ECO` | Reage a **barulho** — correr e empurrar caixas se ouve de longe; agachado quase não ecoa |
| `OBSERVADOR` | Reage ao **olhar** — contato visual sustentado o faz atacar |

### Andar 2 — Garagem trancada
A rampa para o andar 3 está atrás de um portão de enrolar. Um **teclado de acesso** pede o número de carros de cada cor estacionados **neste andar**, na ordem que o próprio teclado mostra (vermelho, verde, amarelo, azul — a ordem varia com a seed). São 4 dígitos, **um campo por cor**. **Carros cinza não contam.** Tanto a ordem quanto as contagens vêm da seed, então todos os jogadores veem o mesmo andar e o mesmo código. Os carros ficam **todos juntos numa faixa do andar**, no caminho entre a rampa por onde você chega e o teclado, então contar é uma caminhada curta. Dica de cooperação: dividam a faixa para contar.

Cada dígito **certo fica travado** (em verde) e continua assim mesmo que você feche o painel; ao autorizar, só os errados são apagados e o painel diz quantos já estão certos. Com os 4 travados, o portão abre para todos.

- Acerto: *"CÓDIGO ACEITO. A PORTA DE ENROLAR DA RAMPA ESTÁ SUBINDO."*
- Nenhum dígito novo certo: *"CÓDIGO RECUSADO. CONTE OS CARROS DE NOVO."*

### Andar 3 — Apagões
O andar agenda seus próprios **blackouts** forçados. No escuro:

- **Mover-se fora do círculo de uma luz de emergência atrai os Smilers** ("eles ouvem você se mexer no escuro").
- **Ficar parado**, ou alcançar um círculo de luz (raio seguro ≈ 2,6 m), é seguro.
- Quando as luzes voltam, os Smilers recuam.

A saída fica na outra ponta do andar.

### No radar

Além das paredes da grade, o radar mostra o que o mapa não guarda como parede: as **laterais das rampas** e o **portão de enrolar** do andar 2 (em laranja enquanto fechado). No andar 2, os **carros estacionados** aparecem na cor que têm (os cinza, que não contam para o código, em tom apagado) e na direção em que estão parados, dentro do alcance do radar — a fita cassete aumenta esse alcance.

## Secreto: Lights Out

Existe um corredor lateral **sem luz** com um beco sem saída. Chegar ao fim dele leva o jogador (sozinho) ao [Level 6](level-6-lights-out.md). É um desvio opcional; ele volta pela Electrical Room.

## Referências no código

- Mapa/andares: `garageLayout.ts` (puro dado, função da seed); sincronia do código: mensagem `garage_sync`.
- Lógica: `GameEngine.updateGarage`, `updateSmilers`; HUD de setor (`sector.1`–`sector.3`).
- Textos: chaves `garage.*` e `eng.garage*` em [pt-BR.ts](../../src/i18n/pt-BR.ts).

