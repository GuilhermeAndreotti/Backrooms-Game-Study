# Backrooms Level 0 — Online

Jogo 3D multiplayer cooperativo de exploração e sobrevivência ambientado no universo das **Backrooms**, com geração procedural de mapa, sanidade decrescente, entidades hostis e relay de rede em tempo real via WebSocket. Roda inteiramente no navegador (Three.js), sem necessidade de instalar cliente.

## Sumário

- [O que é](#o-que-é)
- [Stack técnica](#stack-técnica)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Rodando localmente](#rodando-localmente)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Build de produção](#build-de-produção)
- [Docker](#docker)
- [Controles](#controles)
- [Licença](#licença)

## O que é

Um grupo de até 4 jogadores (`ROOM_CAPACITY`) se conecta à mesma sala e explora, em conjunto, um labirinto infinito gerado proceduralmente a partir de uma *seed* compartilhada — corredores, salas amplas, áreas abertas, "pit rooms", arcos e a rara e silenciosa **Red Room**. Cada jogador tem:

- **Sanidade**, que decai com o tempo e some de vez ao encostar em entidades ou ficar exposto demais à Red Room — chegando a zero é game over;
- **Stamina**, consumida ao correr;
- **Lanterna** (F), **agachar** (Ctrl/C) e um **inventário** (I) de itens coletáveis;
- Um **diário** com fragmentos de lore ("Scrap of Note") gerados proceduralmente, encontrados pelo mapa;
- **Conquistas** (K) desbloqueáveis (ex.: primeiro contato com o mapa, sobreviver à dor, encontrar todas as chaves, escapar do labirinto);
- Um **radar** e chat de texto para coordenação com o resto da equipe.

O objetivo é encontrar a saída ("noclip") e escapar — o que leva o grupo ao próximo nível (Level 1 → Level 2, *Pipe Dreams*), cada um com sua própria ambientação e entidades (`DULLER`, `HOUND`, `CLUMP`, `SKIN_STEALER`, `WRETCH`).

Todo o estado de posição/movimento é sincronizado por um servidor Node autoritativo via WebSocket (`/ws`), a ~20 snapshots/s por sala (`TICK_HZ`).

## Stack técnica

| Camada | Tecnologia |
|---|---|
| Cliente | React 19 + TypeScript, Three.js (render 3D), Tailwind CSS 4, Vite 6 |
| Servidor | Node.js + Express + `ws` (WebSocket), um único processo serve o client buildado *e* o relay |
| Build | Vite (client) + esbuild (bundle do servidor para `dist/server.cjs`) |
| Empacotamento | Docker multi-stage (`node:22-alpine`), imagem publicada via GitHub Actions no GHCR |

## Estrutura do projeto

```
server.ts               # Express + WebSocket relay (salas, snapshots, chat, rate limiting)
src/
  App.tsx                # Máquina de estados da UI (menu → conectando → jogando → escape/game over)
  game/
    GameEngine.ts         # Loop principal Three.js, câmera, níveis, HUD callbacks
    ProceduralMap.ts       # Geração procedural do labirinto (seeded RNG) e tipos de célula
    PlayerController.ts    # Movimento, colisão, stamina, agachar/correr
    WanderingEntity.ts      # IA das entidades hostis
    AudioManager.ts        # Áudio ambiente/SFX posicional
    LightPool.ts / Quality.ts  # Pool de luzes dinâmicas e perfis de qualidade gráfica
  components/             # HUD, menu principal, inventário, radar, conquistas
  utils/                  # Lore procedural, conquistas
deploy/                  # nginx.conf e unit systemd para deploy sem Docker
Dockerfile, docker-compose.yml  # Empacotamento em produção
```

## Rodando localmente

Pré-requisitos: **Node.js 20+** e `npm`.

```bash
npm install
npm run dev
```

Isso sobe `tsx watch server.ts`, que serve o cliente via Vite em modo middleware (com hot-reload) e o relay WebSocket no mesmo processo, em **http://localhost:3000**.

Não é necessário criar um `.env` — todos os valores têm um padrão sensato (veja [.env.example](.env.example)). Se quiser sobrescrever algo:

```bash
cp .env.example .env
```

> O repositório também tem `pnpm-lock.yaml`/`pnpm-workspace.yaml`, mas o projeto é mantido com `npm` (é o que o `package-lock.json` e o Dockerfile usam) — prefira `npm install`/`npm run dev`.

## Variáveis de ambiente

Todas opcionais, com padrão definido em [.env.example](.env.example):

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta que o servidor Node escuta |
| `HOST` | `0.0.0.0` | Interface de escuta (`127.0.0.1` se for usar atrás de reverse proxy) |
| `WS_PATH` | `/ws` | Rota do upgrade WebSocket |
| `ROOM_CAPACITY` | `4` | Jogadores por sala |
| `TICK_HZ` | `20` | Snapshots de movimento por segundo, por sala |
| `MAX_ROOMS` | `200` | Limite de salas simultâneas |
| `MAX_CONNECTIONS` | `200` | Limite de conexões simultâneas no total |

## Build de produção

```bash
npm run build   # vite build (client) + esbuild (dist/server.cjs)
npm start       # NODE_ENV=production node dist/server.cjs
```

## Docker

```bash
docker compose up --build
```

Por padrão o [docker-compose.yml](docker-compose.yml) expõe o jogo só em `127.0.0.1:3000` (pensado para rodar atrás de nginx/Caddy). Para acesso direto, mude para `"3000:3000"`.

Uma imagem também é publicada automaticamente no GHCR a cada push em `main` (veja [.github/workflows/main.yml](.github/workflows/main.yml)):

```bash
docker pull ghcr.io/guilhermeandreotti/backrooms-game-study:main
docker run -d -p 3000:3000 ghcr.io/guilhermeandreotti/backrooms-game-study:main
```

> ⚠️ A porta e outras opções de runtime (`WS_PATH`, `MAX_ROOMS`, etc.) ficam gravadas na imagem em build-time via *repository variables* do GitHub Actions — confira `docker inspect <imagem> --format '{{json .Config.Env}}'` se o container não responder na porta esperada, e sobrescreva com `-e PORT=... -e WS_PATH=...` se precisar.

## Controles

| Ação | Tecla |
|---|---|
| Mover | W A S D / setas |
| Olhar ao redor | Mouse |
| Correr | Shift esquerdo |
| Agachar | Ctrl / C |
| Lanterna | F |
| Inventário | I |
| Conquistas | K |
| Liberar mouse / pausar | Esc |

## Licença

Apache-2.0 (conforme cabeçalho `SPDX-License-Identifier` presente nos arquivos-fonte).
