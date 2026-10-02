# Backrooms — Online

Jogo 3D **multiplayer cooperativo** de exploração e sobrevivência ambientado no universo das **Backrooms**. Até 4 jogadores compartilham um mesmo mundo gerado proceduralmente a partir de uma *seed*, enfrentam entidades hostis, gerenciam a sanidade e resolvem puzzles para escapar, nível a nível. Tudo roda no navegador (Three.js) — não há cliente para instalar.

> A interface do jogo está em **português (pt-BR)**, com tradução para **inglês** e **espanhol**. Código e comentários estão em inglês.

## Sumário

- [Visão geral](#visão-geral)
- [Níveis](#níveis)
- [Como se joga](#como-se-joga)
- [Controles](#controles)
- [Stack técnica](#stack-técnica)
- [Rodando localmente](#rodando-localmente)
- [Configuração](#configuração)
- [Build e deploy](#build-e-deploy)
- [Arquitetura](#arquitetura)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Contribuindo](#contribuindo)
- [Licença](#licença)

## Visão geral

- **Co-op de até 4 jogadores** (`ROOM_CAPACITY`) por sala, com chat de texto, mensagens rápidas, voz (VoIP via WebRTC) e entrega de itens entre jogadores.
- **Mundo determinístico**: o mapa de cada nível é reconstruído em cada cliente a partir de `(seed, nível)`; o servidor nunca transmite geometria.
- **Sanidade, stamina e lanterna**: a sanidade cai com o tempo e em áreas perigosas (como a Red Room); chegar a zero é morte.
- **Entidades com regras próprias**: cada monstro responde a uma pergunta diferente do jogador (barulho, olhar, luz, rota repetida…). Veja o [catálogo de entidades](docs/entities.md).
- **Puzzles cooperativos** por nível (contar carros, ligar interruptores, girar válvulas em ordem, religar cabos, definir uma rota espacial…).
- **Níveis secretos** e finais alternativos, diário de lore, conquistas e um lobby com campo de futebol enquanto a sala se reúne.

## Níveis

A rota principal vai do Level 0 até a Estação Espacial. Os demais níveis são secretos ou escolhidos pelo anfitrião no lobby.

```
LOBBY ──start──▶ Level 0 ─▶ Level 1 ─▶ Level 2 ─▶ Electrical Room ─▶ Abandoned Office ─▶ Poolrooms ─▶ Level 79 (Space Station) ─▶ fim
                              │                        ▲                     │  │
                              └─ corredor escuro ─▶ Level 6 (Lights Out) ────┘  │  (volta à Electrical Room)
                                                                                │
                                      porta que não deveria existir ─▶ Level G  │ (volta ao Abandoned Office)
                                      bolo que ninguém vigia ───────▶ Level FUN
                                      
        Motion: só pelo seletor de níveis do lobby
```

| Nível | Tema | Objetivo resumido | Doc |
|---|---|---|---|
| Lobby | Campo aberto com bola | Reunir o grupo; o anfitrião inicia | [lobby](docs/levels/lobby.md) |
| **Level 0** | Escritórios amarelos | Achar a saída "noclip" (parede/chão sem física) | [level-0](docs/levels/level-0.md) |
| **Level 1** | Habitable Zone — garagem de 3 andares | Resolver o código dos carros, sobreviver aos apagões | [level-1](docs/levels/level-1.md) |
| **Level 2** | Pipe Dreams | Corrida por um túnel em S sob perseguição | [level-2](docs/levels/level-2.md) |
| **Level 3** | Electrical Room (tijolos) | Ligar 5 interruptores para abrir a porta de barras | [level-3](docs/levels/level-3-electrical-room.md) |
| **Level 4** | Abandoned Office | Descobrir a ordem de acesso dos funcionários M.E.G. | [level-4](docs/levels/level-4-abandoned-office.md) |
| **Poolrooms** | Piscinas escuras | Drenar 12 válvulas na ordem certa | [poolrooms](docs/levels/poolrooms.md) |
| **Level 79** | Space Station | Religar a energia, ajustar rota, fugir do Alien | [level-79](docs/levels/level-79-space-station.md) |
| Level 6 *(secreto)* | Lights Out | Atravessar um labirinto escuro | [level-6](docs/levels/level-6-lights-out.md) |
| Level G *(secreto)* | The Small Office | 3 documentos, código, porta de emergência | [level-g](docs/levels/level-g.md) |
| Level FUN *(secreto)* | Festa infantil abandonada | 3 puzzles até a saída | [level-fun](docs/levels/level-fun.md) |
| Motion *(lobby)* | Campo aberto, dia e noite | Alcançar o castelo; o Ceifador caça à noite | [motion](docs/levels/motion.md) |

Índice completo, numeração interna e regras de transição em [docs/levels/README.md](docs/levels/README.md).

## Como se joga

1. **Menu**: escolha nome, cor do traje e rosto, crie uma sala ou entre com o código/link de convite.
2. **Lobby**: o grupo espera. Chute a bola, troque mensagens, use o terminal de cheats (se quiser). O **anfitrião** inicia a expedição (`Enter`) — por padrão no Level 0 ou, pelo seletor, em qualquer nível.
3. **Expedição**: cada nível tem uma saída com condição própria. A sala **avança junta**: o servidor só muda de nível quando todos os vivos chegaram à saída.
4. **Sobrevivência**: gerencie sanidade e stamina, use itens do inventário, esconda-se, ouça o ambiente.
5. **Morte**: o que acontece quando todos morrem é configurável pelo anfitrião (reiniciar o nível atual, voltar ao Level 0 ou ao lobby). Mortos podem observar os vivos (`←`/`→`).

### Recursos do jogador

| Recurso | Descrição |
|---|---|
| Sanidade | Decai com o tempo; Red Room, água tóxica e entidades aceleram a queda. Zero = morte |
| Stamina | Consumida ao correr; recupera parado/andando |
| Lanterna | `F`. Em alguns níveis a luz atrai monstros |
| Inventário / hotbar | Itens com slots fixos `1`–`5` (veja abaixo) |
| Diário | Fragmentos de lore procedurais ("Scrap of Note") e páginas de diário |
| Conquistas | Marcos como "Fuga do Labirinto" ou "Água Segura" |
| Radar | Mostra aliados e a maioria das entidades (algumas são invisíveis a ele de propósito) |

### Itens

| Slot | Item | Efeito |
|---|---|---|
| 1 | Água de amêndoas | +20% sanidade, +15% stamina |
| 2 | Foto antiga | +35% sanidade |
| 3 | Dor líquida | 10 s de adrenalina (stamina infinita, corrida mais rápida), −15% sanidade |
| 4 | Fita cassete | Amplia o alcance do radar por 30 s |
| 5 | Cristal estranho | Passivo: enquanto você o carrega, a sanidade cai mais devagar |

Itens podem ser entregues a um colega próximo (`G`). Definições em [src/shared/items.ts](src/shared/items.ts).

## Controles

| Ação | Tecla |
|---|---|
| Mover | `W` `A` `S` `D` / setas |
| Olhar | Mouse |
| Correr | `Shift` |
| Agachar | `Ctrl` / `C` |
| Pular | `Espaço` |
| Lanterna | `F` |
| Interagir | `E` |
| Usar item da hotbar | `1`–`5` |
| Entregar item a um colega | `G` |
| Inventário | `I` |
| Conquistas | `K` |
| Chat / mensagens rápidas | `Enter` (e atalhos numéricos no comunicador) |
| Iniciar expedição (anfitrião, no lobby) | `Enter` |
| Observar outro jogador (morto) | `←` / `→` |
| Liberar o mouse / pausar | `Esc` |

> A lista oficial e atualizada fica na tela de controles do jogo (chaves `controls.*` em [src/i18n/pt-BR.ts](src/i18n/pt-BR.ts)).

## Stack técnica

| Camada | Tecnologia |
|---|---|
| Cliente | React 19 + TypeScript, Three.js, Tailwind CSS 4, Vite 6, `motion` |
| Servidor | Node.js 20+ (imagem usa 22) + Express + `ws`; um único processo serve o cliente e o relay |
| Build | Vite (cliente → `dist/client`) + esbuild (servidor → `dist/server.cjs`) |
| Empacotamento | Docker multi-stage (`node:22-alpine`); imagem publicada no GHCR por GitHub Actions |
| i18n | Dicionários próprios `pt-BR` (fonte), `en-US`, `es` em [src/i18n/](src/i18n/) |

## Rodando localmente

Pré-requisitos: **Node.js 20+** e **npm**.

```bash
npm install
npm run dev      # http://localhost:3000
```

`npm run dev` executa `tsx watch server.ts`: o Vite roda como middleware (HMR) e o relay WebSocket (`/ws`) no mesmo processo. Abra duas abas (ou dois navegadores) para testar o co-op.

| Script | O que faz |
|---|---|
| `npm run dev` | Servidor + cliente com hot reload |
| `npm run build` | Build do cliente e bundle do servidor (`dist/`) |
| `npm start` | Roda o build de produção (`NODE_ENV=production node dist/server.cjs`) |
| `npm run lint` | `tsc --noEmit` — é a única checagem estática (não há ESLint) |
| `npm run clean` | Remove `dist/` |

**Não há suíte de testes.** Para validar uma mudança: `npm run lint`, depois jogue o trecho afetado no navegador.

> Existem `pnpm-lock.yaml`/`pnpm-workspace.yaml`, mas o `npm` é o gerenciador canônico (é o que `package-lock.json`, Dockerfile e CI usam).

## Configuração

Nenhum `.env` é obrigatório. Para sobrescrever, copie [.env.example](.env.example) para `.env`.

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta do servidor Node |
| `HOST` | `0.0.0.0` | Interface de escuta (`127.0.0.1` atrás de reverse proxy) |
| `WS_PATH` | `/ws` | Rota do upgrade WebSocket (mude junto com nginx/cliente) |
| `ROOM_CAPACITY` | `4` | Jogadores por sala |
| `TICK_HZ` | `20` | Snapshots de movimento por segundo, por sala |
| `MAX_ROOMS` | `200` | Máximo de salas simultâneas |
| `MAX_CONNECTIONS` | `200` | Máximo de conexões simultâneas |
| `VITE_ADSENSE_CLIENT`, `VITE_ADSENSE_MENU_SLOT`, `VITE_ADSENSE_PAUSE_SLOT` | — | Google AdSense opcional. Variáveis `VITE_*` são embutidas **em build-time**; sem elas nenhum anúncio é carregado |

### Configurações da sala (no jogo)

O anfitrião define, no lobby, **o que acontece se todos morrerem** (nível atual / Level 0 / lobby) e se as **rotas secretas** estão ativadas. O lobby também tem um terminal de *cheats* cujos efeitos valem para a sala toda.

## Build e deploy

### Docker

```bash
docker compose up --build
```

O [docker-compose.yml](docker-compose.yml) expõe o jogo apenas em `127.0.0.1:3000` (pensado para ficar atrás de nginx/Caddy). Para acesso direto, use `"3000:3000"`.

A cada push em `main`, [.github/workflows/main.yml](.github/workflows/main.yml) publica a imagem no GHCR:

```bash
docker pull ghcr.io/guilhermeandreotti/backrooms-game-study:main
docker run -d -p 3000:3000 ghcr.io/guilhermeandreotti/backrooms-game-study:main
```

> Porta e opções de runtime podem ter sido gravadas na imagem em build-time pelas *repository variables* do Actions. Se o container não responder onde esperado, confira com `docker inspect <imagem> --format '{{json .Config.Env}}'` e sobrescreva com `-e PORT=... -e WS_PATH=...`.

### Sem Docker (nginx + systemd)

O diretório [deploy/](deploy/) traz [nginx.conf](deploy/nginx.conf) (reverse proxy com upgrade de WebSocket) e [backrooms.service](deploy/backrooms.service) (unit systemd, espera o código em `/opt/backrooms`). Fluxo típico: `npm ci && npm run build`, copiar `dist/`, `node_modules` de produção e `.env` para `/opt/backrooms`, ativar a unit.

## Arquitetura

Visão resumida; os detalhes ficam no código e no [CLAUDE.md](CLAUDE.md).

**Servidor relay, não simulador.** [server.ts](server.ts) gerencia salas, roster e o fluxo de jogo (em qual nível a sala está, quem está vivo). Ele **não** simula física, IA nem geração: apenas valida, sanitiza e retransmite. Nenhum campo vindo do cliente é confiável — toda mensagem nova precisa de validação no servidor.

**Mundo determinístico.** A *seed* é escolhida no servidor ao criar a sala. Cada cliente gera o mesmo mapa com `SeededRandom` ([ProceduralMap.ts](src/game/ProceduralMap.ts)). Nunca use `Math.random()` em nada que afete layout, posição de entidades ou outro estado visível entre clientes — isso dessincroniza silenciosamente. (Efeitos puramente cosméticos e locais podem usar.)

**Movimento autoritativo no cliente.** Cada cliente simula a própria física e envia `update` a ~25 Hz; o servidor agrupa os jogadores "sujos" em um único `players_snapshot` por tick (`TICK_HZ`), transformando tráfego O(N²) em O(N). Jogadores remotos são interpolados.

**Autoridade de mundo por nível.** Para cada nível, um único cliente (o conectado há mais tempo e vivo naquele nível) é eleito autoridade e transmite `entities`, `world_event` e `ball`; o servidor valida e repassa. A autoridade é recalculada a cada tick e passa adiante sem emenda quando quem a detém sai.

**Transições arbitradas pelo servidor.** Chegar à saída envia `level_transition_request`; a sala só avança se todos os vivos naquele nível estiverem prontos e o destino for o próximo da rota principal. Detours secretos (Lights Out, Level G, FUN) são individuais e voltam ao ponto de convergência.

**Estado de puzzle como fatos idempotentes.** Níveis com puzzles (FUN, Space Station, Poolrooms, garagem) aplicam fatos localmente, anunciam via servidor e aplicam o mesmo ao receber de colegas, de modo que a sala converge sem que o servidor conheça as regras. Itens que só uma pessoa pode carregar usam *claim* arbitrado pelo servidor.

**Mobs como dados.** [src/game/mobs/](src/game/mobs/) define cada entidade (`MobDefinition`), com registro total (um tipo novo sem definição quebra o build). A tabela nível → entidades fica em [levels/registry.ts](src/game/levels/registry.ts). O tipo `EntityType` vive em [src/shared/](src/shared/), compartilhado com o servidor (sem importar `three`).

**UI.** [App.tsx](src/App.tsx) é a máquina de estados (`MENU → CONNECTING → LOBBY → PLAYING → ESCAPED | ERROR | GAME_OVER`) e dona do WebSocket e do estado visível ao React. A lógica de jogo mora em `GameEngine`, que fala com o React por callbacks injetados.

## Estrutura do projeto

```
server.ts                 Express + ws: salas, snapshots, autoridade, validação, rate limit
src/
  App.tsx                 Máquina de estados da UI e conexão WebSocket
  game/
    GameEngine.ts          Loop Three.js, câmera, níveis, HUD (callbacks)
    ProceduralMap.ts       Geração determinística de todos os níveis
    PlayerController.ts    Movimento, colisão, stamina, agachar
    WanderingEntity.ts     Execução da IA das entidades
    AudioManager.ts        Áudio posicional e voz procedural dos monstros
    Lobby.ts               Lobby com campo de futebol e espelho
    Voip.ts                Voz entre jogadores (WebRTC, sinalização pelo servidor)
    LightPool.ts, Quality.ts  Pool de luzes e presets gráficos
    levels/                Dados e "diretores" por nível (garagem, FUN, Space), registry
    mobs/                  Uma definição por entidade + registry
    npc/                   NPCs (funcionários M.E.G.)
    systems/               noiseBus, visitTracker, lightQuery
  components/             HUD, menu, inventário, hotbar, radar, chat, modais de puzzle
  shared/                 Tipos e listas compartilhados cliente/servidor (entidades, itens)
  i18n/                   pt-BR (fonte), en-US, es
  utils/, types/          Conquistas, lore procedural, rosto, entrada
deploy/                   nginx.conf e unit systemd
docs/                     Documentação por nível e catálogo de entidades
```

## Contribuindo

- Rode `npm run lint` antes de enviar; para mudanças de gameplay/render, jogue o nível afetado.
- Textos visíveis ao jogador vão em [src/i18n/](src/i18n/) — `pt-BR` define as chaves e `en-US`/`es` precisam acompanhá-las. Use `t("chave", { vars })`.
- Novo tipo de entidade: adicione em `EntityType`, crie a `MobDefinition` e registre em `mobs/registry.ts`.
- Nova mensagem de rede: valide e sanitize cada campo no servidor (veja os helpers `sanitize*`, `gridInt`, `finiteNumber`).
- Ids de nível são parte do protocolo: veja [docs/levels/README.md](docs/levels/README.md) antes de mexer em [levels/constants.ts](src/game/levels/constants.ts).

## Licença

Apache-2.0 (cabeçalho `SPDX-License-Identifier` nos arquivos-fonte).
