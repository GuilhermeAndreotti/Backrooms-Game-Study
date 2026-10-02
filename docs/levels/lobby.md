# Lobby

- **Id de rede:** `10` (`LOBBY_LEVEL`) — **Código:** [src/game/Lobby.ts](../../src/game/Lobby.ts)
- **Entidades:** nenhuma
- **Grid:** 16×16 células, a céu aberto (sem teto nem paredes — só o céu)

## O que é

Toda sala começa aqui. É um campo aberto onde o grupo espera o anfitrião iniciar a expedição. Quem se conecta depois que a expedição começou também espera aqui e entra com o grupo na próxima fase ("Expedição em andamento: seu grupo ainda está lá dentro").

## O que dá para fazer

- **Futebol**: um campo (22 × 14 m) com traves. Corra contra a bola para chutá-la. A física da bola é simulada pela **autoridade** do nível e replicada aos demais (`ball`/`ball_kick`); gols são contados e anunciados ("GOOOL!").
- **Espelho**: um espelho de corpo inteiro (reflexo planar) ao lado do terminal, bom para ver o próprio traje e rosto.
- **Terminal de cheats**: no canto, longe do campo. Os efeitos desbloqueados valem para **toda a sala**: `speed`, `stamina`, `clip`, `life`, `arrow`; o código `sudo` libera todos.
- **Chat, mensagens rápidas e voz** funcionam normalmente.
- **Convite**: copie o código da sala ou o link de convite.

## Anfitrião

O host (indicado no lobby) controla:

- **Iniciar expedição** (`Enter` ou botão) — por padrão leva todos ao Level 0.
- **Seletor de níveis** — iniciar direto em qualquer nível jogável: 0, 1, 2, Electrical Room, Abandoned Office, Poolrooms, Lights Out, Level G, Motion, Level FUN, Level 79.
- **Configurações da sala**: o que ocorre se todos morrerem (nível atual, Level 0 ou lobby) e se as rotas secretas estão ativas.

## Notas técnicas

- `start_game` só é aceito se `room.level === LOBBY_LEVEL` e vem do host; o servidor valida que o nível pedido é inteiro e permitido.
- Ao voltar ao lobby depois de um final (`return_to_lobby_request`), o jogador vê o relatório de fuga por cima enquanto o lobby carrega por baixo.
