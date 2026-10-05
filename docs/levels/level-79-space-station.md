# Level 79 — Space Station

- **Id de rede:** `12` (também é o id de conteúdo) — **Grid:** 32×32, **desenhado à mão** — **Layout:** [levels/spaceLayout.ts](../../src/game/levels/spaceLayout.ts)
- **Entidades:** `O ALIEN` (começa na extremidade leste da espinha, o mais longe possível da doca)
- **Acesso:** saída das [Poolrooms](poolrooms.md) (uma porta de estação), a porta de serviço do [Level FUN](level-fun.md) (rota alternativa que pula as Poolrooms) ou seletor do lobby — **Final:** é o último nível da rota principal; escapar encerra o jogo

## Ambientação

Uma estação espacial de **corredores fechados e janelas enormes**. Ao norte (−z) pairam um **buraco negro** e um **planeta**; todas as salas feitas para olhar para eles têm janelas na parede norte. A estação começa só com **iluminação de emergência**.

```
 deck ─────────────── convés de observação (finale)
   │
 nav ── corrDeckE     Sala de Navegação, 3 consoles e o leme
 lab    nav    comms  ao norte da espinha
 ═════ espinha ═════  corredor longo e fechado; doca no oeste
 crew   tech   eng    ao sul; carga no leste
```

Portas automáticas se abrem quando alguém (incluindo o Alien) se aproxima (≈3,6 m). Placas e setas nas paredes guiam o jogador.

## O quebra-cabeça de navegação

Tudo são **fatos idempotentes** (energia restaurada, console ajustado, rota executada), aplicados localmente e anunciados via servidor; todos os clientes rodam a mesma linha do tempo.

1. **Sem energia** — todos os terminais estão apagados, exceto o **barramento de energia** na **engenharia**, onde **5 cabos** são religados cor a cor (`SpaceWiringModal`). O mapeamento vem da seed. Depois as luzes acendem.
2. **Explorar** — três **consoles** (**ORIENTAÇÃO**, **DESTINO**, **TRAJETÓRIA**) são ajustados um a um, cada um para um alvo (`planeta`, `buraco negro`, `desconhecido`). O **leme** executa a combinação.
3. **Dados e pistas** — o laboratório, as comunicações e o diário da tripulação trazem as informações. A análise lista dois objetos: **A** (distorção gravitacional extrema, horizonte de eventos) e **B** (planeta, atmosfera estável, assinatura de vida) — e as comunicações revelam que B só *devolve* o nosso próprio pedido de socorro.

> ⚠️ **Spoiler** — a solução: os sistemas da estação recomendam o planeta, mas ele é uma **isca**; a saída real é o **buraco negro**.

### Sequências

| Sequência | O que acontece |
|---|---|
| **Corrida ao planeta** (a falsa) | A rota é aceita, luzes verdes, *"DESTINO SEGURO CONFIRMADO"*… então os números deixam de fazer sentido e o planeta encolhe. **ABORTAR** no leme reinicia tudo (e a sala de sistemas passa a "falar"). Deixar chegar **mata todos a bordo**. |
| **Corrida travada** (a real) | Luzes vermelhas, alarme, *TRAJETÓRIA TRAVADA*. Há **17 s** (`ARRIVAL_SECONDS`) para chegar ao **convés de observação** enquanto o buraco cresce no vidro. |
| **Final** | Quem está **no convés** na chegada vê o planeta se apagar "como a imagem que sempre foi" e o buraco ocupar a visão; fade para o preto. A fuga é concluída como um final de jogo. |
| **Colapso** | Se **ninguém** estiver observando na chegada, o curso desmorona e reinicia. |
| **Rumo desconhecido** *(secreto)* | Os três consoles em **DESCONHECIDO** + EXECUTAR: com "Rotas secretas" ligada, em vez do erro *sem coordenadas* a estação parte sem alarme; as estrelas deslizam como cenário trocado, toca ao longe uma musiquinha, tudo fica branco e **todos a bordo** vão para o [Level 94 — Motion](level-94-motion.md). Com a opção desligada, continua o erro. |

## O Alien

Único habitante. Bípede alto, lustroso, sem olhos, crânio alongado e cauda afiada.

- **Patrulha**: caminha entre cruzamentos e cabines sorteados, sem usar a posição de ninguém, e **demora-se** em cada cabine que inspeciona.
- **Persegue** quando vê alguém (cone frontal, qualquer um colado atrás, passos de quem corre por perto, ou quem entra na cabine onde ele já está).
- **Nunca entra em cabines durante a perseguição** nem enquanto procura depois. **Esconder-se em navegação, engenharia, laboratório etc. o despista**: ele revista o corredor por alguns segundos e deixa aquela cabine em paz por um tempo.

## Dicas

- Dividam: um grupo restaura a energia, outro lê os terminais.
- Use as cabines como esconderijo, não os corredores.
- Fique atento ao tempo: no estágio final, **todos que puderem devem estar no convés**.

## Referências no código

- [spaceDirector.ts](../../src/game/levels/spaceDirector.ts) (regras e sequências), [spaceWorld.ts](../../src/game/levels/spaceWorld.ts) (modelos), [spaceSky.ts](../../src/game/levels/spaceSky.ts) (céu, buraco negro, planeta), [mobs/alien.ts](../../src/game/mobs/alien.ts).
- UI: [SpaceTerminalModal.tsx](../../src/components/SpaceTerminalModal.tsx), [SpaceWiringModal.tsx](../../src/components/SpaceWiringModal.tsx).
- Textos: `space.*` (todas as telas da estação passam por `t()`).
