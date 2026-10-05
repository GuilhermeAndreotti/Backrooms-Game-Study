# Lobby

- **Id de rede:** `10` (`LOBBY_LEVEL`) — **Código:** [src/game/Lobby.ts](../../src/game/Lobby.ts)
- **Entidades:** nenhuma
- **Grid:** 16×16 células, a céu aberto (sem teto nem paredes — só o céu)

## O que é

Toda sala começa aqui. É um campo aberto onde o grupo espera o anfitrião iniciar a expedição. Quem se conecta depois que a expedição começou também espera aqui e entra com o grupo na próxima fase ("Expedição em andamento: seu grupo ainda está lá dentro").

## O que dá para fazer

- **Futebol**: um campo (22 × 14 m) com traves. Corra contra a bola para chutá-la. A física da bola é simulada pela **autoridade** do nível e replicada aos demais (`ball`/`ball_kick`); gols são contados e anunciados ("GOOOL!").
- **Xadrez**: uma mesa no canto nordeste, com tabuleiro e peças em 3D e duas cadeiras (a mesa e as cadeiras são sólidas). Chegue perto e aperte `E` para abrir o painel do tabuleiro:
  - **Sentar** em um dos lados (brancas ou pretas); a partida **começa sozinha** quando os dois lados têm alguém. Quem não está sentado **assiste** (o tabuleiro 3D e o painel acompanham em tempo real).
  - Jogue clicando na peça e depois na casa (as jogadas legais aparecem marcadas; promoção abre uma escolha). O painel vira o tabuleiro para quem joga de pretas.
  - Regras completas: xeque, roque, en passant, promoção, xeque-mate, afogamento, 50 lances, material insuficiente e tripla repetição. **Desistir**, **Levantar** (levantar no meio da partida conta como abandono) e **Revanche** (troca as cores).
  - Quem sai do lobby (ou da sala) é tirado da mesa e perde a partida em andamento.
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
- **Xadrez** — o servidor é a autoridade: guarda a mesa em `room.chess` (assentos + partida) e valida cada `chess_move` com o mesmo motor de regras que os clientes usam para mostrar jogadas legais ([src/shared/chess.ts](../../src/shared/chess.ts), sem dependências de three/DOM). Mensagens: `chess_sit`/`chess_stand`/`chess_move`/`chess_resign`/`chess_new`/`chess_sync` (cliente → servidor, só no lobby) e `chess_state` (servidor → todos no lobby, com FEN, lances em SAN, último lance, assentos e resultado). O motor foi conferido com o teste *perft* oficial (posições padrão, Kiwipete e outras). UI: [ChessModal.tsx](../../src/components/ChessModal.tsx); mesa 3D em `Lobby.buildChessTable`.
- Ao voltar ao lobby depois de um final (`return_to_lobby_request`), o jogador vê o relatório de fuga por cima enquanto o lobby carrega por baixo.
