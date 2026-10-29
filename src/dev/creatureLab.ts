/** Development-only asset inspection: open /creatures.html with npm run dev. */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { WanderingEntity, EntityType } from "../game/WanderingEntity";
import { MOB_DEFS } from "../game/mobs/registry";
import { NO_SCRIPTED_POSE } from "../game/mobs/types";
import { updateCreatureAsset, releaseCreatureAsset, setCreatureAssetQuality } from "../game/mobs/creatureAssets";
import { setCreatureMaterialQuality } from "../game/mobs/creatureMaterials";
import { animateSmiler, createSmiler } from "../game/mobs/smiler";
import type { QualityLevel } from "../game/Quality";

const style = document.createElement("style");
style.textContent = `body{margin:0;background:#111;font:14px system-ui;color:#ddd}canvas{display:block}aside{position:absolute;left:18px;top:18px;padding:18px;background:#141619ed;border:1px solid #40444a;border-radius:10px;max-width:250px}h1{font-size:18px;margin:0 0 14px}label{display:block;margin:12px 0}select{display:block;margin-top:5px;width:100%;background:#25282e;color:#eee;border:1px solid #555;padding:7px}p{font-size:12px;color:#aaa;line-height:1.5}output{display:block;font:12px monospace;white-space:pre-line;color:#b8d5c1}`;
document.head.append(style);
const panel = document.createElement("aside");
panel.innerHTML = `<h1>Entidades / materiais</h1><label>Entidade<select id="creature"></select></label><label>Estado<select id="pose"><option value="idle">Repouso</option><option value="walk">Andando</option><option value="run">Perseguição</option><option value="1">Pose especial 1</option><option value="2">Pose especial 2</option><option value="3">Pose especial 3</option></select></label><label>Qualidade<select id="quality"><option>high</option><option>medium</option><option>low</option></select></label><label>Iluminação<select id="light"><option value="studio">Inspeção neutra</option><option value="flashlight">Lanterna / escuro</option></select></label><p>Arraste para orbitar; roda para aproximar. Inspecione o GLB, as articulações e os três níveis de detalhe.</p><output id="metrics"></output>`;
document.body.append(panel);
const select = document.querySelector<HTMLSelectElement>("#creature")!;
for (const type of [...Object.values(EntityType), "SMILER"]) { const option = new Option(type, type); select.add(option); }
const pose = document.querySelector<HTMLSelectElement>("#pose")!;
const quality = document.querySelector<HTMLSelectElement>("#quality")!;
const lightSelect = document.querySelector<HTMLSelectElement>("#light")!;
const metrics = document.querySelector<HTMLOutputElement>("#metrics")!;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x171b1e);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.02, 100);
camera.position.set(2.5, 1.8, 4);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1.1, 0); controls.update();
const hemi = new THREE.HemisphereLight(0xd6e2ed, 0x32302c, 1.3); scene.add(hemi);
const key = new THREE.DirectionalLight(0xffe3c7, 3); key.position.set(2, 4, 3); key.castShadow = true;
key.shadow.mapSize.set(1024, 1024); key.shadow.normalBias = 0.02; scene.add(key);
const rim = new THREE.DirectionalLight(0x9ab3cc, 1.7); rim.position.set(-3, 2, -2); scene.add(rim);
const torch = new THREE.SpotLight(0xfff1da, 40, 20, 0.6, 0.5, 2); torch.castShadow = true; scene.add(torch, torch.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: 0x333638, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
let body: THREE.Group, time = 0, phase = 0;
function show() {
  if (body) {
    releaseCreatureAsset(body); scene.remove(body);
    (body.userData.tintMaterials as THREE.Material[] | undefined)?.forEach(m => m.dispose());
  }
  time = phase = 0;
  body = select.value === "SMILER" ? createSmiler() : WanderingEntity.buildSkinMesh(select.value as EntityType);
  body.position.y = select.value === "SMILER" ? 1.15 : MOB_DEFS[select.value as EntityType].baseHeight;
  scene.add(body);
}
select.value = new URLSearchParams(location.search).get("mob") || "HOUND";
select.addEventListener("change", show); show();
const setQuality = () => { setCreatureAssetQuality(quality.value as QualityLevel); setCreatureMaterialQuality(quality.value as QualityLevel); };
quality.addEventListener("change", setQuality); setQuality();
window.addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
let previousTime = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const delta = Math.min((now - previousTime) / 1000, 0.05); previousTime = now; time += delta;
  const dark = lightSelect.value === "flashlight";
  hemi.intensity = dark ? 0.015 : 1.3; key.visible = rim.visible = !dark; torch.visible = dark;
  torch.position.copy(camera.position); torch.target.position.copy(controls.target);
  if (select.value === "SMILER") animateSmiler(body, time, 1);
  else {
    const def = MOB_DEFS[select.value as EntityType];
    const move = pose.value === "walk" || pose.value === "run" ? 1 : 0, run = pose.value === "run" ? 1 : 0;
    phase += (run ? 3.2 : 1.1) / def.strideLength * delta * Math.PI * 2 * move;
    body.position.set(0, 0, 0); body.rotation.set(0, 0, 0); body.scale.set(1, 1, 1);
    const rig = body.userData.rig;
    def.animate({ joints: rig.joints, body, time, delta, phase, move, run, look: 0, lookYaw: 0, lookPitch: 0, observe: move ? 0 : 0.3, agitated: !!run, chasing: !!run, ...NO_SCRIPTED_POSE, pose: Number(pose.value) || 0, poseTime: time });
    body.position.y += def.baseHeight;
    updateCreatureAsset(body, camera.position.distanceTo(body.position));
  }
  controls.update(); renderer.render(scene, camera);
  metrics.value = `${body.getObjectByName("creatureAsset") ? "GLB / pele articulada" : select.value === "SMILER" ? "Smiler 3D" : "Carregando / corpo de fallback"}\n${renderer.info.render.triangles.toLocaleString()} triângulos\n${renderer.info.render.calls} chamadas (inclui sombras)\n${renderer.info.memory.geometries} geometrias / ${renderer.info.memory.textures} texturas`;
});
