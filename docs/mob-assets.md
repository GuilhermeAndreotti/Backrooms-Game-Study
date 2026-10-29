# Assets das entidades

## Estado desta implementação

Os 17 tipos de `EntityType` têm GLBs próprios em `public/assets/mobs/`, com
esqueleto e três LODs. São **assets gerados a partir dos blockouts do jogo**:
superfícies orgânicas são reconstruídas offline, recebem pesos de deformação e
materiais específicos. As texturas são sintéticas, não escaneamentos fotográficos.
Esta é uma base funcional para a direção ultrarrealista; esculturas artísticas
finalizadas, retopologia manual, texturas anatômicas exclusivas e animações
capturadas ainda são trabalho de produção de arte.

Os Smilers usam olhos e dentição em geometria 3D compartilhada, em vez do plano
aditivo anterior. As Animations e o Town King preservam a identidade de bonecos
de desenho antigo, inclusive o stop-motion.

## Inspeção

```sh
npm run dev
```

Abra `http://localhost:3000/creatures.html`. O laboratório permite selecionar
entidade, repouso/caminhada/perseguição, poses especiais, qualidade e iluminação.
Mostra se o GLB carregou e o custo de geometria. Arraste para orbitar e use a roda
para aproximar/afastar e verificar LOD. A entrada do laboratório é de desenvolvimento
e não integra o bundle de produção.

O laboratório não substitui jogar os níveis: revelações, captura, visibilidade,
água, iluminação VHS e autoridade multiplayer também precisam ser conferidas.

## Regeneração

Os binários e texturas estão versionados; `npm install`, `npm run dev` e
`npm run build` não precisam de Python ou de ferramentas DCC.

Para editar os blockouts e regenerar:

```sh
# NumPy, SciPy e Pillow são necessários apenas para gerar as texturas.
python3 -m pip install -r scripts/requirements-mobs.txt
npm run assets:mobs
npm run test:mobs
npm run lint
npm run build
```

`scripts/build-mobs.ts` usa Three.js, meshoptimizer, three-mesh-bvh e um canvas
headless. Remeshing e transferência de pesos/UVs acontecem offline. Tecidos com
superfícies abertas preservam a topologia original. O manifesto registra bytes,
triângulos por LOD, ossos e superfícies; os testes verificam todos os índices,
pesos, valores finitos, orçamento e cobertura do elenco.

## Contrato de integração

- `buildContext.ts` mantém as coordenadas, hierarquia e nomes iguais no compilador
  e no jogo. A hierarquia original continua dirigindo os estados e animações.
- Cada GLB contém `schema: 1`, nomes de materiais, caminhos `driver` nos ossos e
  `materialIndex`, `lod`, `visibility` nas superfícies. Ao modificar a estrutura
  dos builders, regenere o elenco e execute os testes.
- Um modelo artístico importado deve ser adaptado a esse contrato (rig, escala,
  pivôs, nomes e materiais); não basta substituir um arquivo por qualquer GLB.
- `creatureAssets.ts` compartilha geometria, clona o rig por instância e utiliza
  uma textura de ossos por criatura. Os olhos da revelação e braços extras usam
  grupos de visibilidade independentes, não a visibilidade dos ossos do GLB.
- Downloads inválidos ou indisponíveis mantêm o corpo procedural visível.
  O carregamento é deduplicado; uma conclusão tardia não recria um corpo liberado.
- Corpos devolvidos ao pool liberam a instância GLB; até oito templates ficam
  aquecidos no cache, exceto quando há mais tipos ativos. Skins compartilham os
  buffers, mas têm esqueleto e materiais mutáveis independentes.
- A visão do Town King na porta usa o mesmo asset do chefe. A simulação, os
  alcances e o protocolo de rede permanecem nos sistemas existentes.

## Materiais

`surfaceProfile.ts` classifica pele, carne, tecido, couro, osso, quitina e borracha
por nomes semânticos. `creatureMaterials.ts` amostra os mapas em coordenadas de
repouso, antes da deformação, para evitar texturas deslizando durante a animação.
Cor é sRGB; o mapa `surface` é linear: R = rugosidade, G = microaltura,
B = visibilidade das cavidades. Rostos pintados, crachá e risca de giz conservam
suas UVs. O relevo é submilimétrico e acompanha o preset gráfico.

## Limites e próximos passos artísticos

Esta versão não implementa KTX2, captura de movimento, simulação de tecido,
subsurface scattering ou IK de contato. Os GLBs contêm os três LODs no mesmo
download. As metas finais de ultrarrealismo e 60 FPS devem ser avaliadas com os
assets artísticos definitivos e hardware-alvo, não inferidas dos testes de integridade.
