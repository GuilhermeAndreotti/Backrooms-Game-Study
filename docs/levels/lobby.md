# Lobby

- **Id de rede:** `10` (`LOBBY_LEVEL`) — **Código:** [src/game/Lobby.ts](../../src/game/Lobby.ts)
- **Entidades:** nenhuma
- **Grid:** 16×16 células, a céu aberto (sem teto; o limite é um alambrado)

## O que é

Toda sala começa aqui. É um campo esportivo cercado por alambrado, com arquibancada, árvores e prédios ao longe, onde o grupo espera o anfitrião iniciar a expedição. Quem se conecta depois que a expedição começou também espera aqui e entra com o grupo na próxima fase ("Expedição em andamento: seu grupo ainda está lá dentro").

## O que dá para fazer

- **Futebol**: um campo (22 × 14 m) com traves. Corra contra a bola para chutá-la. A física da bola é simulada pela **autoridade** do nível e replicada aos demais (`ball`/`ball_kick`); gols são contados e anunciados ("GOOOL!").
- **Xadrez**: uma mesa no lado norte da praça, com tabuleiro e peças em 3D e duas cadeiras (a mesa e as cadeiras são sólidas). Chegue perto e aperte `E` para abrir o painel do tabuleiro:
  - **Sentar** em um dos lados (brancas ou pretas); a partida **começa sozinha** quando os dois lados têm alguém. Quem não está sentado **assiste** (o tabuleiro 3D e o painel acompanham em tempo real).
  - Jogue clicando na peça e depois na casa (as jogadas legais aparecem marcadas; promoção abre uma escolha). O painel vira o tabuleiro para quem joga de pretas.
  - Regras completas: xeque, roque, en passant, promoção, xeque-mate, afogamento, 50 lances, material insuficiente e tripla repetição. **Desistir**, **Levantar** (levantar no meio da partida conta como abandono) e **Revanche** (troca as cores).
  - Quem sai do lobby (ou da sala) é tirado da mesa e perde a partida em andamento.
- **Xadrez Anômalo**: uma segunda mesa, roxa e com uma lâmpada piscando por cima, logo ao sul da primeira. Xadrez com **cartas de poder**; mesmas regras de sentar/levantar/assistir/revanche da mesa clássica. O botão `?` do painel mostra as regras e todas as cartas.
  - **Energia ⚡** (Água de Amêndoa): +1 no início de cada turno seu, máximo 10; as brancas jogam o 1º turno com 2, as pretas com 3. **Virada:** quem *perde* uma peça ganha energia (+1 peão/cavalo/bispo, +2 torre/dama).
  - **Mão:** 3 cartas no início, compra 1 por turno a partir do seu 2º turno, máximo 5 (a excedente é descartada). Os dois jogadores têm o mesmo baralho de 24 cartas, embaralhado pelo servidor. A mão é **secreta**: o adversário e os espectadores só veem quantas cartas você tem.
  - **Turno:** até **uma** carta e depois o lance. As cartas que "encerram o turno" substituem o lance.
  - **Cartas nunca tocam o rei inimigo nem dão xeque** — só lances dão xeque. Uma carta, porém, pode **tirar você do xeque** (congelar o atacante, bloquear a linha, fugir com o rei). Por isso o mate só é declarado quando não há lance **nem carta** que salve o rei.
  - Estados: **Congelada** ❄️ (não move nem ataca; fica imune a novo congelamento logo depois), **Blindada** 🛡️ (não pode ser capturada), **Fantasma** 👻 (atravessa peças e paredes neste lance), **Piso molhado** ⚠️ (casa-parede: ninguém entra nem atravessa; bloqueia roque).
  - Fim: xeque-mate, desistência, abandono; empate por afogamento, material insuficiente ou 200 meio-lances (sem 50 lances/tripla repetição: a mão e a energia mudam a posição). Mate com ajuda de uma carta jogada no mesmo turno aparece como **MATE ANÔMALO**.
  - O painel guarda seu histórico (vitórias/derrotas/empates e carta favorita) no navegador. Conquistas: *Xeque Anômalo* (primeira vitória), *Atravessando Paredes* (mate no turno do Noclip), *Da Lama ao Trono* (vencer depois de ficar 5 pontos de material atrás) e *Purista* (mate sem jogar carta).

  | Carta | ⚡ | Raridade | Cópias | Efeito |
  |---|---|---|---|---|
  | Água de Amêndoa | 0 | comum | 2 | +2 de energia |
  | Sanidade | 1 | comum | 2 | compra 2 cartas |
  | Noclip | 2 | comum | 2 | uma torre/bispo/dama/peão sua atravessa peças neste lance |
  | Fita Amarela | 2 | comum | 2 | blinda uma peça sua (não o rei) durante o próximo turno do adversário |
  | Piso Molhado | 2 | comum | 2 | casa vazia vira parede por 2 turnos do adversário |
  | Lâmpada Piscando | 2 | comum | 2 | congela um peão/cavalo/bispo inimigo por 1 turno |
  | Corredor Espelhado | 3 | incomum | 2 | troca duas peças suas (não o rei; peão nunca vai para a 1ª/8ª fileira) |
  | Porta Sem Saída | 3 | incomum | 2 | teleporta uma peça sua para uma casa vazia da sua metade |
  | Rajada | 3 | incomum | 1 | empurra uma peça inimiga (não o rei) 1 casa para trás |
  | Apagão | 4 | incomum | 2 | congela qualquer peça inimiga (não o rei) por 1 turno |
  | Ascensão | 4 | incomum | 1 | promove um peão seu a cavalo ou bispo |
  | Saída de Emergência | 4 | rara | 1 | o rei salta para uma casa vazia a até 2 casas, fora de ataque — **encerra o turno** |
  | Smiler | 5 | rara | 1 | destrói um peão inimigo (não blindado) |
  | Adrenalina | 5 | rara | 1 | segundo lance com outra peça, sem captura e sem xeque (se o 1º lance der xeque, não há segundo) |
  | Memória da Sala | 6 | rara | 1 | revive sua melhor peça perdida (torre > bispo > cavalo) numa casa vazia da sua 1ª fileira — **encerra o turno** |
- **Armário**: encostado no alambrado leste, ao lado do espelho. `E` abre o painel com prévia 3D: **cor do traje**, **rosto** (o mesmo editor de pixels do menu) e **acessórios**, um por espaço — cabeça (cartola, boné, chapéu de festa, coroa, capacete de obra, cowboy, auréola, orelhas de gato, antenas, boné de hélice), rosto (óculos escuros, monóculo, bigode, óculos 3D, nariz de palhaço, máscara de gás), pescoço (gravata, gravata-borboleta, cachecol, crachá da M.E.G., medalha, corrente) e costas (mochila, capa, asas, galão de Água de Amêndoa, balão do Level FUN). O espelho acompanha cada mudança; os outros só veem ao **Vestir**. O visual fica salvo nas configurações. **Não funciona com a skin de monstro** (cheat `SKIN`) ativa.
- **Espelho**: um espelho de corpo inteiro (reflexo planar) ao lado do armário, bom para ver o próprio traje e rosto.
- **Terminal de cheats**: no canto sudeste da praça. Os efeitos desbloqueados valem para **toda a sala**: `speed`, `stamina`, `clip`, `life`, `arrow`; o código `sudo` libera todos.
- **Chat, mensagens rápidas e voz** funcionam normalmente.
- **Convite**: copie o código da sala ou o link de convite.

## Anfitrião

O host (indicado no lobby) controla:

- **Iniciar expedição** (`Enter` ou botão) — por padrão leva todos ao Level 0.
- **Seletor de níveis** — iniciar direto em qualquer nível jogável: 0, 1, 2, Electrical Room, Abandoned Office, Terror Hotel, Lights Out, Poolrooms, Level G, Motion, Level FUN, Level 79.
- **Configurações da sala**: o que ocorre se todos morrerem (nível atual, Level 0 ou lobby) e se as rotas secretas estão ativas.

## Notas técnicas

- `start_game` só é aceito se `room.level === LOBBY_LEVEL` e vem do host; o servidor valida que o nível pedido é inteiro e permitido.
- **Xadrez** — o servidor é a autoridade: guarda a mesa em `room.chess` (assentos + partida) e valida cada `chess_move` com o mesmo motor de regras que os clientes usam para mostrar jogadas legais ([src/shared/chess.ts](../../src/shared/chess.ts), sem dependências de three/DOM). Mensagens: `chess_sit`/`chess_stand`/`chess_move`/`chess_resign`/`chess_new`/`chess_sync` (cliente → servidor, só no lobby) e `chess_state` (servidor → todos no lobby, com FEN, lances em SAN, último lance, assentos e resultado). O motor foi conferido com o teste *perft* oficial (posições padrão, Kiwipete e outras). UI: [ChessModal.tsx](../../src/components/ChessModal.tsx); mesa 3D em `Lobby.buildChessTable`.
- **Xadrez Anômalo** — também autoritativo no servidor (`room.powerChess`, motor em [src/shared/powerChess.ts](../../src/shared/powerChess.ts), que estende `chess.ts` por um parâmetro opcional `MoveRules`: peças congeladas, blindadas, paredes, fantasma; sem ele o xadrez clássico é idêntico e o *perft* continua batendo). Cada peça tem um id estável, então os efeitos andam com ela. Todo efeito com prazo vence num ponto só, ao fim do meio-lance (`endHalfMove`), e um lance só é legal se o rei de quem jogou estiver seguro **depois** desse vencimento — nenhum efeito expirando deixa um rei capturável. Mensagens: `pchess_sit`/`pchess_stand`/`pchess_move`/`pchess_card` (`index` 0..4, `targets` com até 2 casas, `choice` `n`/`b`)/`pchess_resign`/`pchess_new`/`pchess_sync`; `pchess_state` é montado **por destinatário** (só a própria mão; ordem dos baralhos nunca sai do servidor). O cliente reconstrói o jogo do frame (`PowerChessGame.fromNet`) só para destacar lances e alvos de carta. UI: [PowerChessModal.tsx](../../src/components/PowerChessModal.tsx) (grade do tabuleiro compartilhada com o clássico em `ChessBoardGrid.tsx`); mesa 3D em `Lobby.setPowerChess` (gelo nas congeladas, anel dourado nas blindadas, fantasmas translúcidos, cone amarelo no piso molhado).
- **Armário** — mensagem `look` (cliente → servidor: `suitColor`, `face`, `outfit`), aceita só de quem está no lobby e sem skin de monstro, no máximo uma a cada 500 ms; cada campo é validado (cores de `SUIT_COLORS`, rosto de 256 dígitos, acessórios contra [src/shared/outfit.ts](../../src/shared/outfit.ts)) e retransmitido como `player_look` para a sala. Como `face`, `outfit` só vai em `joined`/`player_joined`/`player_look`, nunca nos snapshots de movimento. Os modelos dos acessórios ficam em [src/game/ExplorerAvatar.ts](../../src/game/ExplorerAvatar.ts); UI em [WardrobeModal.tsx](../../src/components/WardrobeModal.tsx).
- **Cenário** — céu pintado num canvas (esfera que segue o jogador), um sol direcional sem sombras e uma luz hemisférica; cerca, árvores, postes e prédios distantes são `InstancedMesh` (uma chamada de desenho por tipo). O plano far da câmera sobe para `LOBBY_CAMERA_FAR` só no lobby.
- **Cutscenes de início e fim** ([LobbyCutscene.ts](../../src/game/LobbyCutscene.ts), `GameEngine.playCutscene`) — locais, cada jogador vê a sua, com o próprio avatar (traje, rosto, acessórios ou skin); `Espaço` pula. Barras de cinema e a dica de pular ficam no `App`.
  - **Início:** quando chega o `level_transition` com `start` (saindo do lobby), a câmera sai dos olhos do jogador, ele anda alguns passos pelo lobby, o mundo glitcha e ele atravessa o chão (noclip); só então o cliente troca de nível.
  - **Fim:** depois de um dos finais (Level 79 ou Level 94, `return_to_lobby` com `completed`), o lobby carrega, o jogador volta glitchando, aterrissa, comemora pulando de braços erguidos, anda até a cadeira das brancas na mesa de xadrez e senta para descansar; só depois aparece o relatório de fuga, e ele fica de pé ao lado da cadeira.
