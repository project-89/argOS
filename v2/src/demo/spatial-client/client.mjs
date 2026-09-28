import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { animationFor, setPresentationAnimation, createConfirmedMotionPlayback, latestNativeOutcome, operatorActionTargets, confirmedPhoneHolder, createSceneCueTracker, nativeNeeds, treeStatePresentation, townLifePresentation, weatherPresentation } from './view-model.mjs';
import { scenarioLighting, allowsAuthoredCafe, passageFrameParts, worldPresentation } from './scenario-view.mjs';
import { worldControlAvailability, worldCommandReceipt, isCurrentWorldCommand } from './world-control-view.mjs';
import { roomExtents, roomViewSignature, shouldInitializeOverview, overviewFrame, applyOverviewFrame, actorAccent, isProjectedPointVisible } from './framing-view.mjs';
import { outdoorRoom, outdoorPaths, treeShape } from './terrain-view.mjs';
import { createTownArchitecture, townArchitectureSignature, revealedBuildingRooms, exteriorOccludes, buildingWallCutaway, outdoorPassage, setTownInteriors } from './town-architecture.mjs';
import { createCommittedEnvironmentClock, createTreeIncidentPlayback, wetnessPresentation, tintWetMaterial } from './environment-view.mjs';
import { createWeatherScene } from './weather-scene.mjs';
import { SOLAR_DIRECTION, ENVIRONMENT_FAR } from './world-atmosphere.mjs';
import { worldTheme, sceneLighting } from './theme-view.mjs';
import { createThemeScene } from './theme-scene.mjs';
import { createGodCommandState } from './development-control-view.mjs';
import { generatedDetailsPresentation } from './generated-details-view.mjs';

/** @typedef {import('../spatial-contract').SpatialViewState} SpatialViewState */
/** @typedef {import('../spatial-contract').SpatialViewEntity} SpatialViewEntity */

const el = id => document.getElementById(id);
const token = decodeURIComponent(location.hash.slice(1));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let state = null, selectedKey = null, follow = false, connected = false, toastTimer;
let overviewMode = true;
let requestedOverview = null;
let interiors = false, townArchitecture = null, architectureSignature = '', revealedRooms = new Set();
let frame = 0, previousFrameWall = performance.now();
let lastGraphicsDiagnosticAt = 0;
let stateRequestSequence = 0, acceptedStateRequest = 0;
let worldCommandPending = false, worldCommandRequest = 0, houseSpiritReceipt = null;
const godCommand = createGodCommandState();
let godPanelSignature = '';
let generatedDetailsSignature = '';
const nodes = new Map(), rooms = new Map(), labels = new Map(), assets = new Map();
const cueTracker = createSceneCueTracker(), cueLabels = new Map();
const motionPlayback = createConfirmedMotionPlayback({ reducedMotion });
const environmentClock = createCommittedEnvironmentClock({ reducedMotion }), treeIncidents = createTreeIncidentPlayback({ reducedMotion });
const propStateLabels = new Map(), scenarioMaterialColors = new WeakMap(), materialRoughness = new WeakMap();
const scenarioAssets = new Set(['power-panel', 'supply-box', 'repair-part']);
const goalLabel = document.createElement('div'); goalLabel.className = 'world-goal'; goalLabel.hidden = true;
el('scene-labels').append(goalLabel);
const host = el('canvas-host');
const scene = new THREE.Scene();
const weatherScene = createWeatherScene(scene, { reducedMotion });
const themeScene = createThemeScene(scene);
const camera = new THREE.OrthographicCamera(-11, 11, 9, -9, 0.1, ENVIRONMENT_FAR);
let renderer, controls, keyLight, skyLight;
let townLifeView = null, townLifeSignature = '', weatherSignature = '';
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
const selectedRing = new THREE.Mesh(new THREE.RingGeometry(0.39, 0.44, 48), new THREE.MeshBasicMaterial({ color: '#d6edac', transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false }));
selectedRing.rotation.x = -Math.PI / 2; selectedRing.visible = false; scene.add(selectedRing);
const loader = new GLTFLoader();
const assetFiles = {
  sofa: 'furniture/loungeSofa.glb', table: 'furniture/tableCoffee.glb', chair: 'furniture/chairCushion.glb',
  'cafe-table': 'furniture/tableRound.glb', plant: 'furniture/plantSmall1.glb', lamp: 'furniture/lampRoundFloor.glb',
  bookcase: 'furniture/bookcaseOpen.glb', cabinet: 'furniture/kitchenCabinet.glb', fridge: 'furniture/kitchenFridge.glb',
  rug: 'furniture/rugRectangle.glb', 'actor-mara': 'characters/character-f.glb', 'actor-ivo': 'characters/character-b.glb',
  'actor-a': 'characters/character-a.glb', 'actor-b': 'characters/character-b.glb', 'actor-f': 'characters/character-f.glb',
};

function notify(message, error = false) {
  clearTimeout(toastTimer); el('toast').textContent = message; el('toast').classList.toggle('error', error); el('toast').hidden = false;
  toastTimer = setTimeout(() => { el('toast').hidden = true; }, error ? 6500 : 3800);
}
async function api(path, body, { timeoutMs = 12000 } = {}) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  const content = response.headers.get('content-type')?.includes('application/json') ? await response.json() : undefined;
  if (!response.ok) throw new Error(content?.error || (response.status === 401 || response.status === 403 ? 'This world link needs its access key. Open the complete link supplied by the server.' : `World request failed (${response.status}).`));
  return content;
}
function safeText(parent, tag, text, className) {
  const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; parent.append(node); return node;
}
function material(color, options = {}) { return new THREE.MeshStandardMaterial({ color, roughness: .87, metalness: 0, ...options }); }
function box(size, color, position = [0, 0, 0], options) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color, options));
  mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
}
function disposeTree(root) {
  root.traverse(obj => { obj.geometry?.dispose(); if (obj.material) for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) { m.map?.dispose(); m.dispose(); } });
}
function fallback(entity) {
  const group = new THREE.Group(), size = entity.size ?? (entity.kind === 'actor' ? { x: .48, y: 1.55, z: .38 } : { x: .6, y: .7, z: .6 });
  const color = entity.color || '#81918a';
  if (entity.kind === 'actor') {
    group.add(box([.38, .61, .25], color, [0, .86, 0]));
    group.add(box([.30, .32, .28], '#d9ac83', [0, 1.33, 0]));
    for (const x of [-.13, .13]) { group.add(box([.15, .52, .19], '#35474b', [x, .34, 0])); group.add(box([.18, .12, .29], '#29312d', [x, .06, .035])); }
    for (const x of [-.255, .255]) group.add(box([.13, .55, .17], color, [x, .87, 0]));
  } else if (entity.asset === 'tree') {
    const shape = treeShape(size), condition = treeStatePresentation(entity);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(shape.trunk.radius * .72, shape.trunk.radius, shape.trunk.height, 6), material('#826448'));
    trunk.position.y = shape.trunk.height / 2; trunk.castShadow = true; trunk.receiveShadow = true; group.add(trunk);
    for (const [index, canopy] of [shape.canopy, shape.lowerCanopy].entries()) {
      const geometry = new THREE.IcosahedronGeometry(1, 1), colors = [];
      const leafColor = new THREE.Color(condition.leafColor || entity.color || '#708b5d');
      for (let vertex = 0; vertex < geometry.attributes.position.count; vertex++) {
        const shade = leafColor.clone().offsetHSL((Math.floor(vertex / 3) % 3 - 1) * .012, 0, (Math.floor(vertex / 3) % 5 - 2) * .025);
        colors.push(shade.r, shade.g, shade.b);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const mesh = new THREE.Mesh(geometry, material('#ffffff', { flatShading: true, vertexColors: true }));
      mesh.position.set(...canopy.center); mesh.scale.set(...canopy.scale);
      mesh.position.y *= condition.canopyHeight; mesh.scale.y *= condition.canopyScaleY;
      mesh.userData.treeCanopy = { positionY: mesh.position.y, scaleY: mesh.scale.y, normalPositionY: canopy.center[1], normalScaleY: canopy.scale[1] };
      mesh.rotation.y = index * .65; mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    }
    if (condition.branch) {
      const branch = box(condition.branch.size, '#9c7952', condition.branch.position);
      branch.userData.brokenLimb = { positionY: condition.branch.position[1], rotationZ: condition.branch.rotationZ };
      branch.rotation.z = condition.branch.rotationZ; group.add(branch);
    }
  } else if (entity.asset === 'phone') {
    group.add(box([size.x, size.y, size.z], '#172525', [0, size.y / 2, 0]));
    group.add(box([size.x * .85, .006, size.z * .79], '#a6c6c4', [0, size.y + .004, 0], { emissive: '#729c99', emissiveIntensity: .24 }));
  } else if (entity.asset === 'food') {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(size.x * .65, size.x * .6, .045, 24), material('#e8decb')); plate.position.y = .024; group.add(plate);
    const loaf = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material('#bc8445')); loaf.scale.set(size.x * .43, size.y * .7, size.z * .43); loaf.position.y = size.y * .5; loaf.castShadow = true; group.add(loaf);
  } else if (entity.asset === 'power-panel') {
    group.add(box([size.x, size.y, size.z], '#455657', [0, size.y / 2, 0]));
    group.add(box([size.x * .87, size.y * .87, size.z * .12], color, [0, size.y / 2, size.z * .54]));
    // Neutral controls only: internal repair requirements come from the world,
    // never from the renderer's decoration or a guessed completion state.
    for (const x of [-.23, 0, .23]) group.add(box([size.x * .12, size.y * .25, size.z * .25], '#243637', [size.x * x, size.y * .51, size.z * .64]));
    group.add(box([size.x * .55, size.y * .055, size.z * .06], '#b4b294', [0, size.y * .78, size.z * .63]));
  } else if (entity.asset === 'supply-box') {
    const thick = Math.min(size.x, size.y, size.z) * .09;
    group.add(box([size.x, thick, size.z], color, [0, thick / 2, 0]));
    for (const x of [-1, 1]) group.add(box([thick, size.y * .82, size.z], color, [x * (size.x - thick) / 2, size.y * .41, 0]));
    for (const z of [-1, 1]) group.add(box([size.x, size.y * .82, thick], color, [0, size.y * .41, z * (size.z - thick) / 2]));
    const lid = new THREE.Group(); lid.position.set(0, size.y * .83, -size.z / 2);
    lid.add(box([size.x * 1.04, size.y * .15, size.z * 1.04], '#a78156', [0, size.y * .075, size.z / 2]));
    if (entity.state === 'open') lid.rotation.x = -Math.PI * .57;
    group.add(lid);
  } else if (entity.asset === 'repair-part') {
    group.add(box([size.x * .94, size.y * .82, size.z * .9], color, [0, size.y * .5, 0]));
    for (const x of [-1, 1]) group.add(box([size.x * .18, size.y, size.z], '#adb6ae', [x * size.x * .41, size.y / 2, 0]));
    group.add(box([size.x * .34, size.y * .08, size.z * .6], '#e5d5ad', [0, size.y * .95, 0]));
  } else if (entity.asset === 'passage') {
    // A permanent opening, not a controllable door. Rendering adds no slab,
    // collision, or inferred closed state; native navigation owns its topology.
    for (const part of passageFrameParts(size)) group.add(box(part.size, color, part.position));
  } else if (entity.asset === 'door') {
    // A door is represented at the engine-authored position; the state alone determines its pose.
    const hinge = new THREE.Group(); hinge.position.x = -size.x / 2;
    const slab = box([size.x, size.y, Math.max(.065, size.z)], color, [size.x / 2, size.y / 2, 0]);
    if (/open/i.test(entity.state ?? '')) hinge.rotation.y = Math.PI / 2;
    hinge.add(slab); group.add(hinge);
  } else group.add(box([size.x, size.y, size.z], color, [0, size.y / 2, 0]));
  return group;
}
function loadAsset(id) {
  const file = assetFiles[id]; if (!file) return Promise.resolve(null);
  if (!assets.has(file)) assets.set(file, loader.loadAsync(`/assets/${file}`).catch(error => { console.warn('Asset fallback:', file, error.message); return null; }));
  return assets.get(file);
}
function cloneAsset(gltf, entity) {
  const model = cloneSkeleton(gltf.scene), group = new THREE.Group();
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  const authoredSize = entity.size;
  const scalar = entity.kind === 'actor' ? (authoredSize?.y ?? 1.65) / Math.max(.001, size.y) : 1;
  if (entity.kind === 'actor') group.scale.setScalar(scalar);
  else if (authoredSize) group.scale.set(authoredSize.x / Math.max(.001, size.x), authoredSize.y / Math.max(.001, size.y), authoredSize.z / Math.max(.001, size.z));
  model.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  model.traverse(obj => { if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true;
    // Clone materials, so one actor selection/state never mutates another instance.
    if (Array.isArray(obj.material)) obj.material = obj.material.map(m => m.clone()); else obj.material = obj.material.clone();
    // Authored colors outrank the kit's default swatch: a green sofa stays green.
    if (entity.color && ['sofa', 'table', 'chair'].includes(entity.asset)) {
      for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) m.color?.set(entity.color);
    }
    if (entity.kind === 'actor' && entity.color && obj.name === 'torso') {
      // Tint only the shirt, never the face or skin. Every instance owns its
      // material, so a town resident's authored palette cannot recolor another.
      for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) m.color?.set(entity.color);
    }
  } });
  group.add(model);
  // These CC0 characters have animated arm meshes rather than hand bones.
  // Anchor near the visible right hand; this is presentation, not a world joint.
  const rightArm = model.getObjectByName('arm-right');
  let handAnchor = null;
  if (entity.kind === 'actor' && rightArm?.geometry) {
    rightArm.geometry.computeBoundingBox();
    const bounds = rightArm.geometry.boundingBox;
    if (bounds) {
      handAnchor = new THREE.Object3D();
      handAnchor.position.set((bounds.min.x + bounds.max.x) / 2, bounds.min.y + (bounds.max.y - bounds.min.y) * .12, bounds.max.z + .035);
      handAnchor.rotation.x = Math.PI / 2;
      rightArm.add(handAnchor);
    }
  }
  const mixer = gltf.animations.length ? new THREE.AnimationMixer(model) : null;
  return { group, mixer, clips: gltf.animations, handAnchor };
}
function setAnimation(node, name) {
  setPresentationAnimation(node, name, { loopOnce: THREE.LoopOnce, loopRepeat: THREE.LoopRepeat });
}
function ensureEntity(entity) {
  let node = nodes.get(entity.key);
  if (node && (node.asset !== entity.asset || node.entity.color !== entity.color || JSON.stringify(node.size) !== JSON.stringify(entity.size))) { removeEntity(entity.key); node = null; }
  if (!node) {
    const root = new THREE.Group(), view = fallback(entity); root.add(view); root.position.set(entity.position.x, entity.position.y, entity.position.z);
    root.rotation.y = entity.rotationY ?? 0; scene.add(root);
    node = { root, view, asset: entity.asset, size: entity.size, entity,
      mixer: null, clips: [], action: null, animation: '', loaded: false };
    nodes.set(entity.key, node);
    if (entity.kind === 'actor') {
      const label = document.createElement('div'); label.className = 'actor-label';
      safeText(label, 'span', '', 'label-dot').style.background = actorAccent(entity);
      safeText(label, 'span', entity.name); el('scene-labels').append(label); labels.set(entity.key, label);
    }
    if (scenarioAssets.has(entity.asset)) {
      const label = document.createElement('div'); label.className = 'prop-state-label';
      el('scene-labels').append(label); propStateLabels.set(entity.key, label);
    }
    if (entity.asset === 'lamp') {
      node.lampLight = new THREE.PointLight('#ffc36e', 0, 7, 2);
      node.lampLight.position.y = (entity.size?.y ?? 1.8) * .82;
      root.add(node.lampLight);
    }
    const generation = node;
    void loadAsset(entity.asset).then(gltf => {
      if (!gltf || nodes.get(entity.key) !== generation) return;
      const loaded = cloneAsset(gltf, generation.entity); generation.root.remove(generation.view); disposeTree(generation.view);
      generation.root.add(loaded.group); generation.view = loaded.group; generation.mixer = loaded.mixer; generation.clips = loaded.clips; generation.handAnchor = loaded.handAnchor; generation.loaded = true;
      setAnimation(generation, 'idle');
    });
  }
  if (['door', 'supply-box', 'tree'].includes(entity.asset) && node.entity.state !== entity.state) {
    node.root.remove(node.view); disposeTree(node.view); node.view = fallback(entity); node.root.add(node.view);
  }
  node.entity = entity;
  const wetness = wetnessPresentation(entity);
  const actorLabel = labels.get(entity.key);
  if (actorLabel) { actorLabel.lastChild.textContent = entity.name; actorLabel.dataset.condition = wetness?.label ?? ''; }
  if (entity.kind !== 'actor' && wetness?.label && !propStateLabels.has(entity.key)) {
    const label = document.createElement('div'); label.className = 'prop-state-label'; el('scene-labels').append(label); propStateLabels.set(entity.key, label);
  }
  if (!scenarioAssets.has(entity.asset) && !wetness?.label && propStateLabels.has(entity.key)) {
    propStateLabels.get(entity.key).remove(); propStateLabels.delete(entity.key);
  }
  const stateLabel = propStateLabels.get(entity.key);
  if (stateLabel) stateLabel.textContent = `${entity.name}${entity.state ? ` · ${entity.state}` : ''}${wetness?.label ? ` · ${wetness.label}` : ''}`;
  return node;
}
function removeEntity(key) {
  const node = nodes.get(key); if (!node) return;
  scene.remove(node.root); node.mixer?.stopAllAction();
  // GLB geometry is shared with the cached asset and other instances. Dispose only local materials.
  if (node.loaded) node.root.traverse(obj => { if (obj.material) for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) m.dispose(); });
  else disposeTree(node.root);
  nodes.delete(key); labels.get(key)?.remove(); labels.delete(key);
  propStateLabels.get(key)?.remove(); propStateLabels.delete(key);
}
function buildRoom(room, town = false) {
  const group = new THREE.Group(), { x, z, width, depth } = room.bounds;
  const street = outdoorRoom(room), floor = room.floor || (street ? '#778c67' : '#b9a785');
  group.add(box([width, .15, depth], floor, [x + width / 2, -.085, z + depth / 2]));
  if (!town) group.add(box([width + .10, .19, depth + .10], street ? '#4c5e5e' : '#55635b', [x + width / 2, -.24, z + depth / 2]));
  if (street) {
    if (!town) for (const part of outdoorPaths(room)) group.add(box(part.size, '#b3b09a', part.position));
  } else {
    const linePoints = [], step = .5;
    for (let at = step; at < depth; at += step) linePoints.push(new THREE.Vector3(x, .001, z + at), new THREE.Vector3(x + width, .001, z + at));
    for (let row = 0; row < depth / step; row++) for (let at = (row % 2 ? 1 : 2); at < width; at += 2) linePoints.push(new THREE.Vector3(x + at, .002, z + row * step), new THREE.Vector3(x + at, .002, z + Math.min(depth, (row + 1) * step)));
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(linePoints), new THREE.LineBasicMaterial({ color: '#796c50', transparent: true, opacity: .22 })); group.add(lines);
  }
  scene.add(group);
  const label = document.createElement('div'); label.className = 'room-label'; label.textContent = room.name; el('scene-labels').append(label);
  rooms.set(room.key, { group, room, label, signature: roomViewSignature(room) });
}
function syncWorld(next) {
  const changedSource = state && state.sourceId !== next.sourceId;
  const initializeOverview = shouldInitializeOverview(state, next);
  if (changedSource) {
    for (const key of [...nodes.keys()]) removeEntity(key);
    for (const row of rooms.values()) { scene.remove(row.group); disposeTree(row.group); row.label.remove(); }
    rooms.clear(); selectedKey = null; interiors = false;
    worldCommandPending = false; houseSpiritReceipt = null; worldCommandRequest++;
    el('god-command-input').value = ''; godPanelSignature = '';
  }
  const keys = new Set(next.entities.map(e => e.key));
  for (const key of nodes.keys()) if (!keys.has(key)) removeEntity(key);
  const roomKeys = new Set(next.rooms.map(r => r.key));
  let roomChanged = false;
  for (const [key, row] of rooms) if (!roomKeys.has(key)) { scene.remove(row.group); disposeTree(row.group); row.label.remove(); rooms.delete(key); roomChanged = true; }
  for (const room of next.rooms) {
    if (!roomExtents([room])) continue;
    const prior = rooms.get(room.key);
    if (prior?.signature === roomViewSignature(room)) continue;
    if (prior) { scene.remove(prior.group); disposeTree(prior.group); prior.label.remove(); }
    buildRoom(room, next.scenario?.id === 'town'); roomChanged = true;
  }
  const receivedAt = performance.now();
  motionPlayback.sync(next, receivedAt);
  environmentClock.sync(next, receivedAt); treeIncidents.sync(next);
  for (const entity of next.entities) {
    const node = ensureEntity(entity);
    node.root.visible = !outdoorPassage(entity, next.rooms);
    const shown = motionPlayback.sample(entity.key, receivedAt);
    node.root.position.set(shown.position.x, shown.position.y, shown.position.z); node.root.rotation.y = shown.yaw;
    if (entity.asset === 'wall' && next.scenario?.id !== 'town') {
      const room = next.rooms.find(r => r.id === entity.roomId);
      const nearWall = room && (entity.position.z > room.bounds.z + room.bounds.depth - .5 || entity.position.x > room.bounds.x + room.bounds.width - .5);
      node.view.traverse(obj => { if (obj.material) { obj.material.transparent = !!nearWall; obj.material.opacity = nearWall ? .16 : 1; obj.material.depthWrite = !nearWall; } });
    }
  }
  state = next;
  townLifeView = townLifePresentation(next);
  syncScenarioView(next);
  const architectureChanged = syncTownArchitecture(next);
  syncTownWeather(next);
  cueTracker.sync(next, performance.now());
  if (!selectedKey || !next.actors.some(a => a.key === selectedKey)) selectedKey = next.actors[0]?.key ?? null;
  if (roomChanged || changedSource || architectureChanged) fitWorldLighting();
  if (initializeOverview) homeCamera(false);
  syncTownVisibility();
  syncPanel();
}
function makeBuildingSign(text, width, height) {
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 128;
  const context = canvas.getContext('2d'); if (!context) return null;
  context.fillStyle = '#f6e9c5'; context.font = '600 48px Georgia, serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(text.toUpperCase(), 384, 66, 710);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
}
function syncTownArchitecture(snapshot) {
  const signature = townArchitectureSignature(snapshot);
  if (signature === architectureSignature) return false;
  architectureSignature = signature;
  if (townArchitecture) { scene.remove(townArchitecture.group); disposeTree(townArchitecture.group); }
  townArchitecture = createTownArchitecture(snapshot, { makeSign: makeBuildingSign });
  scene.add(townArchitecture.group); return true;
}
function syncTownVisibility() {
  if (!state) return;
  revealedRooms = revealedBuildingRooms(state, selectedKey, follow, interiors);
  if (townArchitecture) setTownInteriors(townArchitecture, revealedRooms);
  const hasBuildings = state.rooms.some(room => room.building);
  el('camera-interiors').hidden = !hasBuildings;
  el('camera-interiors').classList.toggle('active', interiors);
  el('camera-interiors').setAttribute('aria-pressed', String(interiors));
  for (const node of nodes.values()) {
    if (node.entity.asset !== 'wall') continue;
    const room = state.rooms.find(room => room.id === node.entity.roomId);
    if (!room?.building) continue;
    const reveal = buildingWallCutaway(node.entity, room, revealedRooms);
    // A true cutaway avoids transparent wall layers still occluding a resident.
    // Native wall entities and their collision geometry remain untouched.
    node.root.visible = !reveal;
    node.view.traverse(object => {
      for (const m of object.material ? Array.isArray(object.material) ? object.material : [object.material] : []) {
        if (m.transparent) m.needsUpdate = true;
        m.transparent = false; m.opacity = 1; m.depthWrite = true;
        if (room.building.wallColor) m.color?.set(room.building.wallColor);
      }
    });
  }
}
function cameraFramingEntities() {
  const entities = state?.entities ?? [];
  if (!townArchitecture?.group.children.length) return entities;
  // Presentation geometry (roofs/terrain) also has an envelope. This does not
  // add it to ECS, turn grass gaps into rooms, or grant collision authority.
  const bounds = new THREE.Box3().setFromObject(townArchitecture.group), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  return [...entities, { position: { x: center.x, y: bounds.min.y, z: center.z }, size: { x: size.x, y: size.y, z: size.z } }];
}
function syncScenarioView(snapshot) {
  const scenario = snapshot.scenario?.id === 'blackout' ? snapshot.scenario : null;
  const lighting = scenarioLighting(scenario);
  const theme = worldTheme(snapshot.scenario);
  const banner = el('scenario-banner'); banner.hidden = !scenario;
  if (scenario) {
    el('scenario-title').textContent = scenario.title;
    el('scenario-phase').textContent = scenario.phase;
    el('scenario-power').textContent = scenario.power === 'on' ? 'POWER ON' : scenario.power === 'off' ? 'POWER OFF' : 'POWER UNKNOWN';
    banner.classList.toggle('complete', scenario.complete === true);
    banner.classList.toggle('power-on', scenario.power === 'on');
  }
  el('stage').classList.toggle('blackout-active', lighting.dim);
  const apartmentId = snapshot.rooms.find(room => room.name === 'Apartment')?.id;
  const tint = (root, dim, wetness = null, floorTheme = null) => root.traverse(object => {
    for (const mat of object.material ? Array.isArray(object.material) ? object.material : [object.material] : []) {
      if (!mat.color) continue;
      if (!scenarioMaterialColors.has(mat)) scenarioMaterialColors.set(mat, mat.color.clone());
      mat.color.copy(scenarioMaterialColors.get(mat));
      if (Number.isFinite(mat.roughness)) {
        if (!materialRoughness.has(mat)) materialRoughness.set(mat, mat.roughness);
        mat.roughness = materialRoughness.get(mat);
      }
      if (dim) mat.color.multiplyScalar(.19);
      if (floorTheme) mat.color.lerp(new THREE.Color(floorTheme.groundTint), floorTheme.groundBlend);
      tintWetMaterial(mat, wetness);
    }
  });
  // Room-scoped surface dimming leaves the street/café daylight untouched. The
  // phone screen retains its own emissive light. No ECS material is modified.
  for (const row of rooms.values()) tint(row.group, lighting.dim && row.room.id === apartmentId, null, theme && row.room.environment === 'outdoor' ? theme : null);
  for (const node of nodes.values()) {
    tint(node.view, lighting.dim && node.entity.roomId === apartmentId, wetnessPresentation(node.entity));
    if (node.lampLight) node.lampLight.intensity = lighting.lampOn && node.entity.roomId === apartmentId ? 22 : 0;
  }
}
function fitWorldLighting() {
  if (!keyLight) return;
  const frame = overviewFrame(state?.rooms ?? [], cameraFramingEntities(), host.clientWidth, host.clientHeight);
  const span = Math.max(8, Math.hypot(frame.extents.width, frame.extents.depth) * .7);
  keyLight.target.position.set(frame.center.x, 0, frame.center.z);
  const distance = span * 1.75;
  keyLight.position.set(frame.center.x + SOLAR_DIRECTION.x * distance,
    SOLAR_DIRECTION.y * distance, frame.center.z + SOLAR_DIRECTION.z * distance);
  Object.assign(keyLight.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: .1, far: span * 5 });
  keyLight.shadow.camera.updateProjectionMatrix();
}
function syncTownWeather(snapshot) {
  const weather = weatherPresentation(snapshot);
  const theme = worldTheme(snapshot.scenario), lighting = sceneLighting(snapshot.scenario, weather);
  const signature = JSON.stringify([snapshot.sourceId, theme?.id, weather, snapshot.rooms.map(room => [room.id, room.bounds, room.environment, !!room.building])]);
  if (signature === weatherSignature) return;
  weatherSignature = signature;
  const condition = weather?.condition ?? 'clear';
  el('stage').dataset.weather = weather ? condition : '';
  el('stage').dataset.theme = theme?.id ?? '';
  if (keyLight) { keyLight.color.set(lighting.keyColor); keyLight.intensity = lighting.keyIntensity; }
  if (skyLight) { skyLight.color.set(lighting.skyColor); skyLight.groundColor.set(lighting.groundColor); skyLight.intensity = lighting.skyIntensity; }
  themeScene.sync(snapshot);
  weatherScene.sync(snapshot);
}
function poseTreeIncident(node, atSimMs) {
  if (node.entity.asset !== 'tree') return;
  const incident = treeIncidents.sample(node.entity.key, atSimMs);
  for (const mesh of node.view.children) {
    const canopy = mesh.userData.treeCanopy, branch = mesh.userData.brokenLimb;
    if (canopy) {
      mesh.position.y = canopy.positionY + (incident ? (canopy.normalPositionY - canopy.positionY) * (1 - incident.settle) : 0);
      mesh.scale.y = canopy.scaleY + (incident ? (canopy.normalScaleY - canopy.scaleY) * (1 - incident.settle) : 0);
      // A small canopy recoil, never a falling trunk or a new obstruction.
      mesh.rotation.z = incident?.recoil ?? 0;
    }
    if (branch) { mesh.position.y = branch.positionY + (incident?.branchLift ?? 0); mesh.rotation.z = incident?.branchRotationZ ?? branch.rotationZ; }
  }
}
function homeCamera(reset = true) {
  if (!controls) return;
  overviewMode = true; follow = false; el('camera-follow').classList.remove('active');
  syncTownVisibility();
  const frame = overviewFrame(state?.rooms ?? [], cameraFramingEntities(), host.clientWidth, host.clientHeight);
  requestedOverview = frame;
  applyOverviewFrame(camera, controls, frame);
  // Atmosphere extends beyond the town, but must not shrink its overview fit.
  camera.far = Math.max(camera.far, ENVIRONMENT_FAR); camera.updateProjectionMatrix();
  updateCameraDiagnostics();
  if (reset) notify('The whole world, at the same moment.');
}
function updateCameraDiagnostics() {
  // Read-only presentation telemetry: useful for debugging viewport/backing-size
  // mismatches without exposing simulation mutation or private actor state.
  const environment = weatherScene.diagnostics();
  const diagnostic = { viewport: [host.clientWidth, host.clientHeight], backing: renderer ? [renderer.domElement.width, renderer.domElement.height] : null,
    zoom: camera.zoom, fittedZoom: requestedOverview?.zoom ?? null, minZoom: controls?.minZoom ?? null,
    frustum: [camera.left, camera.right, camera.top, camera.bottom], mode: follow ? 'follow' : overviewMode ? 'overview' : 'user',
    renderCalls: renderer?.info.render.calls ?? null, triangles: renderer?.info.render.triangles ?? null,
    atmosphere: { active: environment.active, condition: environment.condition, cloudCount: environment.cloudCount, space: 'world' } };
  host.dataset.cameraDiagnostics = JSON.stringify(diagnostic);
}
function selectActor(key, open = false) {
  if (!state?.actors.some(a => a.key === key)) return;
  selectedKey = key; syncPanel(); syncTownVisibility();
  if (open && innerWidth < 760) el('app').classList.add('panel-open');
}
let panelSignature = '', messagesSignature = '', eventSignature = '';
function syncPanel() {
  if (!state) return;
  const actor = state.actors.find(a => a.key === selectedKey), view = state.entities.find(e => e.key === selectedKey);
  const clockSeconds = Math.floor(state.atSimMs / 1000);
  el('clock').textContent = `${String(Math.floor(clockSeconds / 60)).padStart(2, '0')}:${String(clockSeconds % 60).padStart(2, '0')}`;
  el('connection').textContent = state.running ? 'World is living' : state.status === 'stopped' ? 'World stopped' : 'Ready to begin';
  el('connection-dot').className = `status-dot ${state.running ? 'live' : ''}`;
  el('run-mode').textContent = state.mode === 'live' ? 'Live NPC cognition' : state.development?.enabled ? 'Manual NPCs · God AI available' : 'Manual test mode · no AI';
  el('start').hidden = state.running || state.status === 'stopped'; el('start').disabled = state.status !== 'ready';
  el('stop').hidden = !state.running; el('stop').disabled = !state.running;
  el('stop').textContent = 'Stop world';
  el('actor-count').textContent = `${state.actors.length} MINDS`;
  const presentation = worldPresentation(state);
  el('world-title').textContent = presentation.title; el('world-description').textContent = presentation.description;
  el('roster-title').textContent = presentation.rosterTitle;
  el('stage').classList.toggle('town-view', state.scenario?.id === 'town');
  el('camera-follow').disabled = !actor;
  const nextPanel = JSON.stringify([selectedKey, state.actors.map(a => [a.key, a.name, a.room, state.entities.find(e => e.key === a.key)?.color])]);
  if (nextPanel !== panelSignature) {
    panelSignature = nextPanel; const scrollTop = el('characters').scrollTop; el('characters').replaceChildren();
    state.actors.forEach(a => {
      const button = document.createElement('button'); button.className = `character-button${a.key === selectedKey ? ' selected' : ''}`;
      button.setAttribute('aria-pressed', String(a.key === selectedKey));
      const avatar = safeText(button, 'span', a.name.slice(0, 1), 'avatar');
      const accent = actorAccent(state.entities.find(e => e.key === a.key) ?? a);
      avatar.style.color = accent; avatar.style.background = `${accent}22`;
      const text = safeText(button, 'span', '');
      safeText(text, 'strong', a.name); safeText(text, 'small', a.room); button.addEventListener('click', () => selectActor(a.key)); el('characters').append(button);
    });
    el('characters').scrollTop = scrollTop;
  }
  const thought = actor?.thought;
  el('thought').textContent = thought?.text ? `“${thought.text}”` : state.mode === 'manual' ? 'Manual mode: no model-authored thoughts. Test a native action below.' : 'No articulated thought yet. Their actions don’t always need words.';
  el('thought').classList.toggle('empty', !thought?.text);
  el('thought-age').textContent = thought ? `${Math.max(0, Math.floor((state.atSimMs - thought.atSimMs) / 1000))}s AGO` : '—';
  el('activity').textContent = actor?.action || view?.activity?.action || 'No action underway';
  el('location').textContent = actor?.room ?? '—';
  const focus = actor?.focus;
  el('goal-heading').textContent = focus?.kind === 'activity' ? 'ONGOING ACTIVITY' : 'LEADING GOAL';
  el('current-goal').textContent = focus?.description || 'No active goal at the moment.';
  el('goal-note').textContent = focus?.kind === 'activity' ? 'The purpose they are carrying forward.' : 'An intention, not a guaranteed next action.';
  const needs = nativeNeeds(actor); el('needs-readout').hidden = !needs;
  for (const key of ['hunger', 'energy']) el(`need-${key}`).textContent = needs ? `${Math.round(needs[key] * 10) / 10} / 100` : '';
  el('phone-heading').textContent = actor ? `Text ${actor.name}` : 'A line into the world';
  el('phone-detail').textContent = actor?.canText === false ? 'No connected phone for this resident. You can still plant a thought.' : 'Text their phone. What they do with it is up to them.';
  const messages = actor?.messages ?? [];
  const nextMessages = JSON.stringify([selectedKey, messages]);
  if (nextMessages !== messagesSignature) {
    messagesSignature = nextMessages; const list = el('messages'); list.replaceChildren();
    if (!messages.length) { const empty = safeText(list, 'div', '', 'empty-messages'); safeText(empty, 'span', '↗'); safeText(empty, 'p', 'Start a conversation across the fourth wall.'); }
    for (const message of messages) {
      const inbound = message.direction === 'in';
      const bubble = safeText(list, 'div', message.text, `message-bubble ${inbound ? 'outbound' : ''}`);
      safeText(bubble, 'span', `${inbound ? 'YOU' : message.from} · ${message.status}`, 'message-meta');
    }
    list.scrollTop = list.scrollHeight;
  }
  const disabled = !actor || !state.running;
  for (const id of ['message-input', 'thought-input']) el(id).disabled = disabled;
  for (const form of ['message-form', 'thought-form', 'action-form']) for (const control of el(form).querySelectorAll('button,select,input')) control.disabled = disabled;
  for (const control of el('message-form').querySelectorAll('button,textarea')) control.disabled = disabled || actor?.canText === false;
  const authoredCafe = allowsAuthoredCafe(state.scenario) && state.growth.status !== 'gated';
  el('grow').hidden = !authoredCafe;
  el('grow').disabled = !authoredCafe || !state.running || state.growth.status === 'built';
  el('growth-heading').textContent = townLifeView ? 'Living world' : authoredCafe ? 'Beyond these walls' : 'World growth';
  el('growth-kind').textContent = townLifeView ? 'BEHIND THE SCENES' : 'WORLD BUILDING';
  el('growth-detail').textContent = townLifeView?.summary || presentation.growth;
  syncTownLifePanel();
  el('grow').querySelector('span:nth-child(2)').firstChild.textContent = state.growth.status === 'built' ? 'The café is part of the world' : 'Add the neighborhood café';
  el('world-stats').textContent = `${state.rooms.length} connected places · ${state.entities.length} visible entities\n${state.mode === 'live' ? 'Live decisions' : 'Operator test actions'} · ${state.tick} committed ticks\nSource ${state.sourceId.slice(0, 12)}\nView interpolates confirmed positions only.\n${authoredCafe ? 'Growth is an explicit authored test, not autonomous.' : state.growth.summary}`;
  el('action-content').placeholder = state.scenario?.id === 'blackout' ? 'Operation, e.g. inspect' : 'Operation, e.g. sit';
  const recentEvents = state.events.slice(-8).reverse(), nextEvents = JSON.stringify(recentEvents);
  if (nextEvents !== eventSignature) { eventSignature = nextEvents; el('event-list').replaceChildren(); for (const event of recentEvents) safeText(el('event-list'), 'div', `${(event.atSimMs / 1000).toFixed(1)}s · ${event.text}`, 'event-row'); }
  const receipt = latestNativeOutcome(state.events);
  el('action-receipt').textContent = receipt ? `Native outcome · ${(receipt.atSimMs / 1000).toFixed(1)}s\n${receipt.text}` : 'Dispatch is a request. Its native outcome appears here.';
  el('action-receipt').style.color = receipt?.kind === 'failed' || / · failed$/.test(receipt?.text ?? '') ? '#dba98f' : '';
  const actionType = el('action-type').value;
  const targets = operatorActionTargets(state, actionType, actor?.id);
  const targetSignature = JSON.stringify(targets.map(t => [t.key, t.name]));
  if (el('action-target').dataset.signature !== targetSignature) {
    const before = el('action-target').value; el('action-target').replaceChildren();
    for (const target of targets) { const option = document.createElement('option'); option.value = target.key; option.textContent = target.name; el('action-target').append(option); }
    if (targets.some(t => t.key === before)) el('action-target').value = before;
    el('action-target').dataset.signature = targetSignature;
  }
  for (const [key, label] of labels) label.classList.toggle('selected', key === selectedKey);
  syncHouseSpirit();
  syncGodControl();
  syncGeneratedDetails();
}
function syncTownLifePanel() {
  const section = el('town-life'); section.hidden = !townLifeView;
  const signature = JSON.stringify([state.sourceId, state.running, townLifeView]);
  if (signature === townLifeSignature) return;
  townLifeSignature = signature;
  el('town-spirits').replaceChildren(); el('town-changes').replaceChildren(); el('town-story').replaceChildren();
  el('town-story').hidden = !townLifeView?.story;
  if (!townLifeView) return;
  const { weather, spirits, changes, growth, story, mechanic } = townLifeView;
  el('town-weather-icon').textContent = weather?.condition === 'rain' ? '☂' : weather?.condition === 'cloudy' ? '☁' : '○';
  el('town-weather-label').textContent = weather?.label ?? 'Weather unreported';
  el('town-life-status').textContent = !townLifeView.enabled ? 'Not enabled' : state.running ? 'Active' : state.status === 'stopped' ? 'Stopped' : 'Ready';
  if (story) {
    const card = el('town-story'), heading = safeText(card, 'div', '', 'town-change-meta');
    safeText(heading, 'span', 'Story brief'); safeText(heading, 'strong', story.style);
    safeText(card, 'p', story.premise);
    safeText(card, 'small', story.lastReviewAtSimMs === null ? 'No completed Narrator review reported yet.'
      : `Last Narrator review · ${(story.lastReviewAtSimMs / 1000).toFixed(1)}s world time`);
    const reading = [story.phase ? `phase: ${story.phase}` : '', story.tension === null ? '' : `tension: ${Math.round(story.tension * 100)}%`].filter(Boolean);
    if (reading.length) safeText(card, 'p', `Narrator interpretation · ${reading.join(' · ')}. Not a physical world change.`);
    const counts = [story.observedEvents === null ? '' : `${story.observedEvents} observed events`,
      story.interventions === null ? '' : `${story.interventions} interventions reported`,
      story.remainingEvents === null ? '' : `${story.remainingEvents} branch event slots remaining`].filter(Boolean);
    if (counts.length) safeText(card, 'p', counts.join(' · '));
    safeText(card, 'small', 'Confirmed changes appear separately below.');
  }
  for (const spirit of spirits) {
    const row = safeText(el('town-spirits'), 'div', '', 'town-spirit');
    safeText(row, 'strong', spirit.name); safeText(row, 'span', spirit.status);
  }
  el('town-growth-budget').textContent = [growth.remaining === null ? '' : `${growth.remaining} construction slots remaining`, growth.summary].filter(Boolean).join(' · ');
  el('town-mechanic').hidden = !mechanic;
  el('town-mechanic').textContent = mechanic ? `Generated mechanics · ${mechanic.status}${mechanic.remaining === null ? '' : ` · ${mechanic.remaining} build slots remaining`}\n${mechanic.summary}` : '';
  el('town-changes-empty').hidden = changes.length > 0;
  for (const change of changes) {
    const row = safeText(el('town-changes'), 'li', '', `town-change ${change.status}`);
    const meta = safeText(row, 'div', '', 'town-change-meta');
    safeText(meta, 'span', change.spirit); safeText(meta, 'strong', change.label);
    safeText(row, 'p', change.summary);
    safeText(row, 'small', `${(change.atSimMs / 1000).toFixed(1)}s · world time`);
  }
}
function syncHouseSpirit() {
  const view = worldControlAvailability(state, worldCommandPending, connected);
  const section = el('house-spirit'); section.hidden = !view.visible;
  el('house-spirit-summary').textContent = view.summary;
  el('world-command-input').disabled = view.disabled;
  el('world-command-send').disabled = view.disabled;
  el('world-command-send').textContent = view.pending ? 'Considering…' : 'Ask the house spirit ↗';
  el('world-command-form').setAttribute('aria-busy', String(view.pending));
  for (const button of section.querySelectorAll('[data-world-example]')) button.disabled = view.disabled;
  const receipt = el('world-command-receipt');
  receipt.hidden = !view.pending && !houseSpiritReceipt;
  receipt.className = `world-command-receipt ${view.pending ? 'pending' : houseSpiritReceipt?.status ?? ''}`;
  el('world-command-outcome').textContent = view.pending ? worldCommandPending ? 'Considering your request' : 'The house spirit is busy' : houseSpiritReceipt?.title ?? '';
  el('world-command-detail').textContent = view.pending ? worldCommandPending ? 'Waiting for a confirmed outcome. Nothing is shown as changed yet.' : 'Another request is in progress. You can ask when it finishes.' : houseSpiritReceipt?.detail ?? '';
  el('world-command-time').textContent = !view.pending && Number.isFinite(houseSpiritReceipt?.atSimMs) ? `World time · ${(houseSpiritReceipt.atSimMs / 1000).toFixed(1)}s` : '';
}
async function submitWorldCommand() {
  const text = el('world-command-input').value.trim();
  if (!text || worldControlAvailability(state, worldCommandPending, connected).disabled) return;
  const sourceId = state.sourceId, requestId = ++worldCommandRequest;
  worldCommandPending = true; houseSpiritReceipt = null; syncHouseSpirit();
  try {
    const response = await api('/api/world-command', { text }, { timeoutMs: 30000 });
    if (!isCurrentWorldCommand(sourceId, requestId, state, worldCommandRequest)) return;
    houseSpiritReceipt = worldCommandReceipt(response);
    if (response.status !== 'rejected') el('world-command-input').value = '';
  } catch (error) {
    if (!isCurrentWorldCommand(sourceId, requestId, state, worldCommandRequest)) return;
    houseSpiritReceipt = { status: 'unconfirmed', title: 'Outcome unconfirmed', detail: `${error.message} No applied change has been confirmed to this view.` };
  } finally {
    if (isCurrentWorldCommand(sourceId, requestId, state, worldCommandRequest)) {
      worldCommandPending = false; syncHouseSpirit();
      // Refresh physical state, but never turn a successful receipt into a
      // network failure just because the following observation was interrupted.
      void pollOnce().catch(() => {});
    }
  }
}
function clearAcknowledgedGodDraft(acknowledgement) {
  if (acknowledgement?.acceptedText && el('god-command-input').value.trim() === acknowledgement.acceptedText)
    el('god-command-input').value = '';
}
function syncGodControl() {
  clearAcknowledgedGodDraft(godCommand.sync(state));
  const view = godCommand.view(state, connected);
  el('god-control').hidden = !view.visible;
  el('god-control-status').textContent = view.status;
  // Keep a composed next request while the server is busy. Only an uncertain
  // or in-flight transport locks its exact text for safe idempotent retry.
  el('god-command-input').disabled = !view.canCompose;
  el('god-command-input').readOnly = ['sending', 'unconfirmed'].includes(view.requestStatus);
  el('god-command-send').disabled = view.disabled;
  el('god-command-send').textContent = view.requestStatus === 'unconfirmed' ? 'Retry same request ↗' : view.pending ? 'Request in progress…' : 'Ask God ↗';
  el('god-command-form').setAttribute('aria-busy', String(view.pending));
  const notices = {
    sending: 'Sending your request. Delivery is not confirmed yet.',
    queued: 'Request queued. No native effect is confirmed by this acknowledgement.',
    working: 'God is working on the request. Replies and build jobs appear separately.',
    completed: 'Request complete. Check the reply, job status, and native world evidence separately.',
    failed: 'Request failed. This does not confirm that any proposed change was applied.',
    cancelled: 'Request cancelled. Check native world evidence for any effects already committed.',
    unconfirmed: `${view.requestDetail || 'Delivery could not be confirmed.'} Your draft is retained. Retry sends the same request ID, not a new job.`,
  };
  el('god-command-receipt').hidden = !view.requestStatus && !view.pending;
  el('god-command-receipt').textContent = notices[view.requestStatus] ?? (view.pending ? 'God is busy with another request. Your draft stays here until you send it.' : '');
  const signature = JSON.stringify([state?.sourceId, view.visible, view.capabilities, view.limits, view.messages, view.jobs]);
  if (signature === godPanelSignature) return;
  godPanelSignature = signature;
  el('god-capabilities').replaceChildren();
  for (const capability of view.capabilities) safeText(el('god-capabilities'), 'li', capability);
  if (!view.capabilities.length) safeText(el('god-capabilities'), 'li', 'No capabilities reported.');
  const limits = [view.limits.maxRequests === null ? 'Request limit unreported' : `Session request limit: ${view.limits.maxRequests}`,
    view.limits.maxBuildJobs === null ? 'Build-job limit unreported' : `Build-job limit: ${view.limits.maxBuildJobs}`];
  el('god-limits').textContent = limits.join(' · ');
  const messages = el('god-messages'), wasNearBottom = messages.scrollHeight - messages.clientHeight - messages.scrollTop < 30;
  messages.replaceChildren();
  if (!view.messages.length) safeText(messages, 'p', 'No operator requests yet.', 'section-copy');
  for (const message of view.messages) {
    const row = safeText(messages, 'div', '', `god-message ${message.role}`);
    safeText(row, 'strong', `${message.role === 'operator' ? 'You · operator' : 'God · response'} · ${message.label}`, 'message-meta');
    safeText(row, 'p', message.text);
    safeText(row, 'small', `${(message.atSimMs / 1000).toFixed(1)}s · world time`);
  }
  if (wasNearBottom) messages.scrollTop = messages.scrollHeight;
  el('god-jobs').replaceChildren(); el('god-builds').hidden = view.jobs.length === 0;
  for (const job of view.jobs) {
    const row = safeText(el('god-jobs'), 'li', '', 'town-change');
    safeText(row, 'strong', `Reported job status · ${job.status}`, 'message-meta');
    safeText(row, 'p', job.summary); safeText(row, 'small', `Job ${job.id}`);
  }
}
async function submitGodCommand() {
  let request;
  try { request = godCommand.begin(state, el('god-command-input').value, connected); }
  catch (error) { notify(error.message, true); return; }
  if (!request) return;
  syncGodControl();
  try {
    const response = await api('/api/god-command', { text: request.text, requestId: request.requestId });
    const acknowledgement = godCommand.receive(state, request, response);
    if (!acknowledgement) return;
    clearAcknowledgedGodDraft(acknowledgement); syncGodControl();
    void pollOnce().catch(() => {});
  } catch (error) {
    if (godCommand.fail(state, request, error.message)) syncGodControl();
  }
}
function syncGeneratedDetails() {
  const rows = generatedDetailsPresentation(state), signature = JSON.stringify([state?.sourceId, rows]);
  if (signature === generatedDetailsSignature) return;
  generatedDetailsSignature = signature;
  el('generated-details').hidden = rows.length === 0;
  const list = el('generated-details-list'); list.replaceChildren();
  for (const row of rows) {
    const card = safeText(list, 'div', '', 'town-change');
    safeText(card, 'strong', row.name, 'message-meta');
    for (const detail of row.details) safeText(card, 'p', `${detail.component}.${detail.field} = ${String(detail.value)}`);
  }
}
function projectLabel(label, point) {
  const projected = point.clone().project(camera); label.style.left = `${(projected.x * .5 + .5) * host.clientWidth}px`;
  label.style.top = `${(-projected.y * .5 + .5) * host.clientHeight}px`; label.style.opacity = isProjectedPointVisible(projected) ? '1' : '0';
}
function drawWorldCues(now) {
  // One current bubble of each kind per source entity; keep other characters'
  // simultaneous speech rather than stacking the same speaker's recent lines.
  const current = new Map();
  for (const cue of cueTracker.visible(now).sort((a, b) => a.updatedAtSimMs - b.updatedAtSimMs)) current.set(`${cue.entityKey}:${cue.kind}`, cue);
  const visible = [...current.values()], active = new Set(visible.map(c => c.id));
  for (const [id, label] of cueLabels) if (!active.has(id)) { label.remove(); cueLabels.delete(id); }
  const occupied = [];
  for (const cue of visible.filter(c => c.kind === 'speech').concat(visible.filter(c => c.kind !== 'speech'))) {
    const anchor = nodes.get(cue.entityKey); if (!anchor) continue;
    if (exteriorOccludes(anchor.entity, state?.rooms ?? [], revealedRooms)) { cueLabels.get(cue.id)?.remove(); cueLabels.delete(cue.id); continue; }
    let label = cueLabels.get(cue.id);
    if (!label) { label = document.createElement('div'); label.className = `world-cue cue-${cue.kind}`;
      safeText(label, 'small', '', 'cue-speaker'); safeText(label, 'span', '', 'cue-words');
      el('scene-labels').append(label); cueLabels.set(cue.id, label); }
    const speaker = label.querySelector('.cue-speaker'), words = label.querySelector('.cue-words');
    const sourceName = cue.kind === 'speech' || cue.kind === 'sound' ? anchor.entity.name : '';
    const shown = cue.kind === 'speech' && cue.text.length > 240 ? `…${cue.text.slice(-240)}` : cue.text;
    if (speaker.textContent !== sourceName) speaker.textContent = sourceName;
    if (words.textContent !== shown) words.textContent = shown;
    // Hand attachment is presentation-only; buzz follows the actual phone mesh.
    const point = cue.kind === 'sound' ? anchor.view.getWorldPosition(new THREE.Vector3())
      : anchor.root.position.clone();
    point.y += cue.kind === 'speech' ? (anchor.entity.size?.y ?? 1.65) + .65 : .65;
    const projected = point.project(camera);
    label.hidden = !isProjectedPointVisible(projected);
    if (label.hidden) continue;
    const width = label.offsetWidth, height = label.offsetHeight;
    let left = Math.max(8, Math.min(host.clientWidth - width - 8, (projected.x * .5 + .5) * host.clientWidth - width / 2));
    let top = Math.max(85, (-projected.y * .5 + .5) * host.clientHeight - height);
    for (let attempt = 0; attempt < 6; attempt++) {
      const collision = occupied.find(r => left < r.left + r.width + 8 && left + width + 8 > r.left && top < r.top + r.height + 8 && top + height + 8 > r.top);
      if (!collision) break;
      top = Math.max(80, collision.top - height - 10);
      if (top === 80) left = Math.max(8, Math.min(host.clientWidth - width - 8, collision.left + collision.width + 12));
    }
    label.style.left = `${left}px`; label.style.top = `${top}px`;
    occupied.push({ left, top, width, height });
  }
  const actor = state?.actors.find(a => a.key === selectedKey), selected = nodes.get(selectedKey);
  goalLabel.hidden = !selected || !actor?.focus || exteriorOccludes(selected.entity, state?.rooms ?? [], revealedRooms);
  if (!goalLabel.hidden) {
    const text = actor.focus.description;
    const shown = `${actor.focus.kind === 'activity' ? 'Doing' : 'Goal'} · ${text.length > 78 ? text.slice(0, 75) + '…' : text}`;
    if (goalLabel.textContent !== shown) goalLabel.textContent = shown;
    goalLabel.title = text;
    projectLabel(goalLabel, selected.root.position.clone().add(new THREE.Vector3(0, -.12, 0)));
  }
}
const heldPosition = new THREE.Vector3(), heldRotation = new THREE.Quaternion(), rootRotation = new THREE.Quaternion();
const fallbackPhoneRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
function poseHeldPhone(node) {
  if (node.entity.asset !== 'phone') return;
  const holderEntity = confirmedPhoneHolder(node.entity, state?.entities ?? []);
  const holder = holderEntity && nodes.get(holderEntity.key);
  // Ownership loss/drop restores the ordinary authoritative-world presentation.
  node.view.position.set(0, 0, 0); node.view.quaternion.identity();
  if (!holder) return;
  if (holder.handAnchor) {
    holder.handAnchor.getWorldPosition(heldPosition);
    holder.handAnchor.getWorldQuaternion(heldRotation);
  } else {
    // Honest approximate right-hand pose while the character asset is loading.
    const scale = (holder.entity.size?.y ?? 1.65) / 1.65;
    heldPosition.set(-.34 * scale, .85 * scale, .23 * scale);
    holder.root.localToWorld(heldPosition);
    holder.root.getWorldQuaternion(heldRotation); heldRotation.multiply(fallbackPhoneRotation);
  }
  node.root.worldToLocal(heldPosition); node.view.position.copy(heldPosition);
  node.root.getWorldQuaternion(rootRotation).invert();
  node.view.quaternion.copy(rootRotation.multiply(heldRotation));
}
function animate(now) {
  frame = requestAnimationFrame(animate); const delta = Math.min(.07, (now - previousFrameWall) / 1000); previousFrameWall = now;
  const environmentAt = environmentClock.sample(now);
  for (const [key, node] of nodes) {
    const shown = motionPlayback.sample(key, now);
    if (shown) { node.root.position.set(shown.position.x, shown.position.y, shown.position.z); node.root.rotation.y = shown.yaw; }
    setAnimation(node, animationFor(node.entity, shown?.moving === true));
    // No idle animation clock can move an entity root or alter its ECS state.
    node.mixer?.update(reducedMotion ? 0 : delta);
    poseTreeIncident(node, environmentAt);
    if (labels.has(key)) {
      const label = labels.get(key); label.hidden = exteriorOccludes(node.entity, state?.rooms ?? [], revealedRooms);
      if (!label.hidden) projectLabel(label, node.root.position.clone().add(new THREE.Vector3(0, (node.entity.size?.y ?? 1.65) + .27, 0)));
    }
  }
  // All holder roots and rig animations have advanced before presentation-only
  // attachments. Neither the phone root nor either entity's source data changes.
  for (const node of nodes.values()) poseHeldPhone(node);
  for (const [key, label] of propStateLabels) {
    const node = nodes.get(key);
    label.hidden = !node || exteriorOccludes(node.entity, state?.rooms ?? [], revealedRooms);
    if (node && !label.hidden) projectLabel(label, node.root.position.clone().add(new THREE.Vector3(0, (node.entity.size?.y ?? .4) + .16, 0)));
  }
  const selected = nodes.get(selectedKey); selectedRing.visible = !!selected && !exteriorOccludes(selected.entity, state?.rooms ?? [], revealedRooms);
  if (selected) { selectedRing.position.set(selected.root.position.x, selected.root.position.y + .008, selected.root.position.z);
    if (follow && controls) { const target = selected.root.position.clone().add(new THREE.Vector3(0, .6, 0)); const shift = target.sub(controls.target).multiplyScalar(reducedMotion ? 1 : .06); controls.target.add(shift); camera.position.add(shift); } }
  for (const row of rooms.values()) {
    const north = row.room.building?.front === 'north';
    projectLabel(row.label, new THREE.Vector3(row.room.bounds.x + row.room.bounds.width / 2, .03, north ? row.room.bounds.z - .45 : row.room.bounds.z + row.room.bounds.depth + .45));
  }
  controls?.update(); drawWorldCues(now);
  weatherScene.draw(environmentAt, { camera, interiors,
    focusPosition: selected && (follow || revealedRooms.has(selected.entity.roomId))
      ? selected.root.position.clone().add(new THREE.Vector3(0, (selected.entity.size?.y ?? 1.65) * .75, 0)) : null });
  if (renderer) renderer.render(scene, camera);
  if (now - lastGraphicsDiagnosticAt > 1000) { updateCameraDiagnostics(); lastGraphicsDiagnosticAt = now; }
}
function initializeRenderer() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3;
    host.append(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = !reducedMotion; controls.dampingFactor = .075;
    controls.minPolarAngle = Math.PI * .12; controls.maxPolarAngle = Math.PI * .43;
    controls.minZoom = .4; controls.maxZoom = 2.8; controls.enablePan = true;
    controls.addEventListener('start', () => { overviewMode = false; follow = false; el('camera-follow').classList.remove('active'); syncTownVisibility(); });
    controls.addEventListener('change', updateCameraDiagnostics);
    skyLight = new THREE.HemisphereLight('#d4e7e6', '#82704f', 2.1); scene.add(skyLight);
    keyLight = new THREE.DirectionalLight('#ffe4b7', 3.6); keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.normalBias = .045; keyLight.shadow.bias = -.0002; scene.add(keyLight, keyLight.target); scene.add(new THREE.AmbientLight('#bcd3d0', .4));
    fitWorldLighting();
    const resize = () => { const w = host.clientWidth, h = host.clientHeight, aspect = w / Math.max(1, h); const half = 8.8;
      camera.left = -half * aspect; camera.right = half * aspect; camera.top = half; camera.bottom = -half; camera.updateProjectionMatrix(); renderer.setSize(w, h);
      if (overviewMode) homeCamera(false); };
    new ResizeObserver(resize).observe(host); resize(); homeCamera(false);
    let down = null;
    renderer.domElement.addEventListener('pointerdown', event => { down = { x: event.clientX, y: event.clientY }; });
    renderer.domElement.addEventListener('pointerup', event => {
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
      const rect = host.getBoundingClientRect(); pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const actors = [...nodes].filter(([, n]) => n.entity.kind === 'actor');
      const hits = actors.flatMap(([key, node]) => raycaster.intersectObject(node.root, true).map(hit => ({ key, distance: hit.distance }))).sort((a, b) => a.distance - b.distance);
      if (hits[0]) selectActor(hits[0].key, true);
    });
    renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); el('renderer-error').hidden = false; el('renderer-error').textContent = 'The graphics context was interrupted. The simulation remains separate. Reload this page to reconnect the view.'; });
    frame = requestAnimationFrame(animate);
  } catch (error) { el('renderer-error').hidden = false; el('renderer-error').textContent = `The 3D view could not start: ${error.message}. The world controls remain available.`; }
}
async function handle(form, operation, success) {
  const buttons = [...form.querySelectorAll('button')]; buttons.forEach(b => b.disabled = true);
  try { await operation(); notify(success); await pollOnce(); }
  catch (error) { notify(error.message, true); }
  finally { buttons.forEach(b => b.disabled = false); syncPanel(); }
}
async function pollOnce() {
  const requestSequence = ++stateRequestSequence;
  const next = await api('/api/state');
  if (!next || !Array.isArray(next.entities) || !Array.isArray(next.rooms) || !Number.isFinite(next.atSimMs)) throw new Error('The world returned an invalid view.');
  // Overlapping poll/control refreshes cannot rewind an already observed source.
  if (requestSequence < acceptedStateRequest || state?.sourceId === next.sourceId && next.atSimMs < state.atSimMs) return;
  acceptedStateRequest = requestSequence;
  connected = true; syncWorld(next);
}
async function poll() {
  try { await pollOnce(); }
  catch (error) { connected = false; el('connection').textContent = 'Connection interrupted'; el('connection-dot').className = 'status-dot error'; if (!state) { el('run-mode').textContent = error.message; el('start').disabled = true; } syncHouseSpirit(); syncGodControl(); }
  setTimeout(poll, connected ? 250 : 2000);
}
el('brand-link').addEventListener('click', event => { event.preventDefault(); homeCamera(false); });
el('camera-home').addEventListener('click', () => homeCamera());
el('camera-follow').addEventListener('click', () => {
  if (!nodes.has(selectedKey)) return;
  follow = !follow; overviewMode = false; el('camera-follow').classList.toggle('active', follow);
  if (follow) { camera.zoom = Math.max(camera.zoom, 1.35); camera.updateProjectionMatrix(); }
  syncTownVisibility();
});
el('camera-interiors').addEventListener('click', () => { interiors = !interiors; syncTownVisibility(); });
el('toggle-panel').addEventListener('click', () => el('app').classList.toggle('panel-open'));
el('fullscreen').addEventListener('click', () => { if (document.fullscreenElement) void document.exitFullscreen(); else void el('app').requestFullscreen().catch(() => notify('Fullscreen is unavailable in this browser.')); });
el('start').addEventListener('click', () => handle(el('start').parentElement, () => api('/api/start', {}), 'The world is running.'));
el('stop').addEventListener('click', () => handle(el('stop').parentElement, () => api('/api/stop', {}), 'World stopped. This source will not resume.'));
el('grow').addEventListener('click', () => {
  if (!allowsAuthoredCafe(state?.scenario) || state?.growth.status === 'gated') return;
  void handle(el('grow').parentElement, () => api('/api/grow', {}), 'Café construction requested. Watch the world state.');
});
el('message-form').addEventListener('submit', event => { event.preventDefault(); const text = el('message-input').value.trim(); if (!text || !selectedKey) return;
  void handle(el('message-form'), async () => { await api('/api/message', { actorKey: selectedKey, text }); el('message-input').value = ''; }, 'Message delivered into the world.'); });
el('thought-form').addEventListener('submit', event => { event.preventDefault(); const text = el('thought-input').value.trim(); if (!text || !selectedKey) return;
  void handle(el('thought-form'), async () => { await api('/api/command', { actorKey: selectedKey, text }); el('thought-input').value = ''; }, 'A thought planted. The decision is theirs.'); });
el('world-command-form').addEventListener('submit', event => { event.preventDefault(); void submitWorldCommand(); });
el('god-command-form').addEventListener('submit', event => { event.preventDefault(); void submitGodCommand(); });
for (const button of el('house-spirit').querySelectorAll('[data-world-example]')) button.addEventListener('click', () => {
  el('world-command-input').value = button.dataset.worldExample; el('world-command-input').focus();
});
el('action-type').addEventListener('change', syncPanel);
el('action-form').addEventListener('submit', event => { event.preventDefault(); if (!selectedKey) return;
  void handle(el('action-form'), () => api('/api/action', { actorKey: selectedKey, type: el('action-type').value, targetKey: el('action-target').value, ...(el('action-content').value.trim() ? { content: el('action-content').value.trim() } : {}) }), 'Operator action submitted to the native executor.'); });
window.addEventListener('pagehide', () => cancelAnimationFrame(frame));
window.addEventListener('pageshow', event => { if (event.persisted) { previousFrameWall = performance.now(); frame = requestAnimationFrame(animate); } });
initializeRenderer(); void poll();
