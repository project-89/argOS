import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roomExtents } from './framing-view.mjs';
import { worldTheme } from './theme-view.mjs';

/** Appearance only: the real walls, passages, trees and walkable rooms remain
 * native ECS entities. An open passage never acquires a decorative door slab. */
export function buildingLayout(room, entities = []) {
  if (!['cottage', 'cafe', 'workshop'].includes(room.building?.style)) return null;
  const { x, z, width, depth } = room.bounds, south = room.building.front !== 'north';
  const frontZ = south ? z + depth : z, centerX = x + width / 2;
  const entrance = entities.filter(entity => ['door', 'passage'].includes(entity.asset)
    && Number.isFinite(entity.position?.x) && Number.isFinite(entity.position?.z)
    && entity.position.x > x && entity.position.x < x + width && Math.abs(entity.position.z - frontZ) < .45)
    .sort((a, b) => Math.abs(a.position.x - centerX) - Math.abs(b.position.x - centerX))[0];
  return { x, z, width, depth, centerX, centerZ: z + depth / 2, frontZ, direction: south ? 1 : -1,
    doorX: entrance?.position.x ?? centerX, doorWidth: Math.max(1, entrance?.size?.x ?? 1.2),
    entranceKey: entrance?.key ?? null, style: room.building.style,
    wallColor: room.building.wallColor || '#ded5ba', roofColor: room.building.roofColor || '#66797b' };
}

export function revealedBuildingRooms(snapshot, selectedKey, follow, interiors) {
  const selected = snapshot?.entities.find(entity => entity.key === selectedKey && entity.kind === 'actor');
  return new Set((snapshot?.rooms ?? []).filter(room => room.building
    && (interiors || follow && room.id === selected?.roomId)).map(room => room.id));
}

export function exteriorOccludes(entity, rooms, revealed) {
  const room = rooms.find(room => room.id === entity?.roomId);
  return !!room?.building && !revealed.has(room.id);
}

export function buildingWallCutaway(entity, room, revealed) {
  if (entity.asset !== 'wall' || !room?.building || !revealed.has(room.id)) return false;
  const front = room.building.front === 'north' ? room.bounds.z : room.bounds.z + room.bounds.depth;
  return Math.abs(entity.position.z - front) < .3
    || entity.position.x > room.bounds.x + room.bounds.width - .3
    || entity.position.z > room.bounds.z + room.bounds.depth - .3;
}

/** A native outdoor connection is a route boundary, not a freestanding door.
 * Only explicit outdoor rooms on both sides permit hiding the frame. */
export function outdoorPassage(entity, rooms) {
  if (entity.asset !== 'passage' || !entity.position) return false;
  const { x, z } = entity.position;
  const touching = rooms.filter(room => {
    const b = room.bounds;
    return x >= b.x - .2 && x <= b.x + b.width + .2 && z >= b.z - .2 && z <= b.z + b.depth + .2;
  });
  return touching.length >= 2 && touching.every(room => room.environment === 'outdoor');
}

export function townArchitectureSignature(snapshot) {
  return JSON.stringify([snapshot.scenario?.id, worldTheme(snapshot.scenario)?.id, snapshot.rooms.map(room => [room.id, room.name, room.bounds, room.environment, room.building]),
    snapshot.entities.filter(entity => ['door', 'passage'].includes(entity.asset)).map(entity => [entity.key, entity.position, entity.size])]);
}

const mat = color => new THREE.MeshStandardMaterial({ color, roughness: .94, metalness: 0, flatShading: true });
/** Merge static trim/flowers by material inside each independent reveal group.
 * Roof visibility remains independent; hundreds of windows need not mean
 * hundreds of draw calls. Textured signs stay separate. */
function batchStaticMeshes(group) {
  group.updateMatrixWorld(true);
  const inverse = group.matrixWorld.clone().invert(), buckets = new Map();
  group.traverse(object => {
    if (!object.isMesh || Array.isArray(object.material) || object.material.map || object.material.transparent) return;
    const key = `${object.material.color.getHexString()}:${object.material.side}:${object.material.emissive.getHexString()}:${object.material.emissiveIntensity}`;
    let bucket = buckets.get(key); if (!bucket) { bucket = []; buckets.set(key, bucket); } bucket.push(object);
  });
  for (const meshes of buckets.values()) {
    const geometries = meshes.map(mesh => {
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      return geometry.applyMatrix4(inverse.clone().multiply(mesh.matrixWorld));
    });
    const merged = mergeGeometries(geometries); for (const geometry of geometries) geometry.dispose();
    if (!merged) continue;
    const material = meshes[0].material.clone(), mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    for (const source of meshes) { source.removeFromParent(); source.geometry.dispose(); source.material.dispose(); }
    group.add(mesh);
  }
}
function block(parent, size, color, position, rotationY = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat(color)); mesh.position.set(...position);
  mesh.rotation.y = rotationY; mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function disc(parent, radius, color, x, z, y = .015, scaleZ = 1) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 20), mat(color));
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); mesh.scale.y = scaleZ; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function gable(parent, width, rise, y, x, z, color) {
  const shape = new THREE.Shape(); shape.moveTo(-width / 2, 0); shape.lineTo(0, rise); shape.lineTo(width / 2, 0); shape.closePath();
  const material = mat(color); material.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material); mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh);
}
function windowFrame(parent, x, y, z, width = 1.15, height = 1.04, rotationY = 0, shutter = '#769184', theme = null) {
  const frame = new THREE.Group(); frame.position.set(x, y, z); frame.rotation.y = rotationY; parent.add(frame);
  block(frame, [width + .19, height + .18, .11], '#f2e9d3', [0, 0, 0]);
  const glass = block(frame, [width, height, .12], theme?.windowColor ?? '#8faeb1', [0, 0, .025]);
  if (theme) { glass.material.emissive.set(theme.windowGlow); glass.material.emissiveIntensity = theme.windowIntensity; }
  block(frame, [.055, height, .045], '#f4eedb', [0, 0, .10]); block(frame, [width, .055, .045], '#f4eedb', [0, 0, .10]);
  block(frame, [width + .32, .12, .26], '#d4ccb2', [0, -height / 2 - .12, .05]);
  for (const side of [-1, 1]) {
    block(frame, [.30, height + .10, .08], shutter, [side * (width / 2 + .26), 0, -.01]);
    for (let row = 0; row < 4; row++) block(frame, [.23, .035, .035], '#445e58', [side * (width / 2 + .26), -.34 + row * .22, .05]);
  }
}
function awning(parent, centerX, z, direction, width, color, striped = false) {
  const roof = block(parent, [width, .11, .95], color, [centerX, 2.48, z + direction * .43]); roof.rotation.x = direction * .12;
  block(parent, [width, .22, .08], color, [centerX, 2.30, z + direction * .92]);
  if (striped) for (let x = -width / 2 + .16; x < width / 2; x += .56) {
    const stripe = block(parent, [.25, .015, .96], '#f2e8cc', [centerX + x, 2.54, z + direction * .43]); stripe.rotation.x = direction * .12;
    block(parent, [.25, .23, .012], '#f2e8cc', [centerX + x, 2.30, z + direction * .965]);
  }
}

function buildHouse(room, entities, makeSign, theme) {
  const layout = buildingLayout(room, entities); if (!layout) return null;
  const { x, z, width, depth, centerX, centerZ, frontZ, direction, doorX, doorWidth, style, wallColor, roofColor } = layout;
  const group = new THREE.Group(), roof = new THREE.Group(), facade = new THREE.Group(), fixed = new THREE.Group();
  group.add(fixed, facade, roof);
  const eavesY = 2.6, rise = style === 'workshop' ? 1.25 : 1.8, halfSpan = width / 2 + .35;
  // Foundations meet the shared ground; this is not a floating floor island.
  block(fixed, [width + .20, .23, depth + .20], '#a7a38d', [centerX, -.10, centerZ]);
  // Native walls provide the opaque building shell. Corner pilasters and eaves
  // give it architectural depth without inventing solid surfaces over openings.
  for (const cornerX of [x, x + width]) for (const cornerZ of [z, z + depth]) {
    block(facade, [.18, 2.6, .18], '#eee3c8', [cornerX, 1.3, cornerZ]);
  }
  for (const sideZ of [z, z + depth]) block(roof, [width + .5, .19, .25], '#eee4cc', [centerX, eavesY, sideZ]);
  const slopeLength = Math.hypot(halfSpan, rise), angle = Math.atan2(rise, halfSpan);
  for (const side of [-1, 1]) {
    const slope = block(roof, [slopeLength, .17, depth + .7], roofColor,
      [centerX + side * halfSpan / 2, eavesY + rise / 2, centerZ]); slope.rotation.z = -side * angle;
    // Regular raised seams keep the roof legible at an isometric overview.
    for (let at = z - .25; at <= z + depth + .25; at += .6) {
      const seam = block(roof, [slopeLength, .025, .026], new THREE.Color(roofColor).multiplyScalar(.82),
        [centerX + side * halfSpan / 2, eavesY + rise / 2 + .095, at]); seam.rotation.z = -side * angle;
    }
  }
  block(roof, [.20, .17, depth + .82], new THREE.Color(roofColor).multiplyScalar(.78), [centerX, eavesY + rise + .06, centerZ]);
  for (const sideZ of [z - .025, z + depth + .025]) gable(roof, width, rise, eavesY, centerX, sideZ, wallColor);
  const chimneyX = x + width * .72, chimneyZ = z + depth * .30;
  block(roof, [.57, 1.6, .66], '#b47b5f', [chimneyX, eavesY + rise * .72, chimneyZ]);
  block(roof, [.73, .16, .81], '#d0b99b', [chimneyX, eavesY + rise * .72 + .87, chimneyZ]);
  block(roof, [.39, .04, .45], '#56483f', [chimneyX, eavesY + rise * .72 + .96, chimneyZ]);
  // An open portal stays visibly open: jambs/header only, never a fake door leaf.
  for (const side of [-1, 1]) block(facade, [.14, 2.24, .17], '#f2e9d3', [doorX + side * (doorWidth / 2 + .10), 1.12, frontZ + direction * .075]);
  block(facade, [doorWidth + .34, .17, .19], '#f2e9d3', [doorX, 2.24, frontZ + direction * .075]);
  block(fixed, [doorWidth + .65, .07, .73], '#d1c8ae', [doorX, -.015, frontZ + direction * .34]);
  const facing = direction === 1 ? 0 : Math.PI;
  const windowZ = frontZ + direction * .07;
  for (const windowX of [x + width * .23, x + width * .77]) {
    if (Math.abs(windowX - doorX) > doorWidth / 2 + .65) windowFrame(facade, windowX, 1.55, windowZ, style === 'cafe' ? 1.50 : 1.10, 1.04, facing, roofColor, theme);
  }
  // Side and rear windows make every approach look inhabited, not just one set.
  windowFrame(facade, x + width + .07, 1.55, centerZ, 1.3, 1.04, Math.PI / 2, roofColor, theme);
  windowFrame(facade, x - .07, 1.55, centerZ, 1.3, 1.04, -Math.PI / 2, roofColor, theme);
  const backZ = direction === 1 ? z : z + depth;
  for (const side of [-1, 1]) windowFrame(facade, centerX + side * width * .23, 1.55, backZ - direction * .07, 1.1, 1.0, facing + Math.PI, roofColor, theme);
  if (style === 'cottage') {
    awning(facade, doorX, frontZ, direction, doorWidth + .85, roofColor);
    for (const side of [-1, 1]) block(facade, [.075, 2.32, .075], '#e4d8bc', [doorX + side * (doorWidth / 2 + .32), 1.16, frontZ + direction * .80]);
  } else {
    awning(facade, centerX, frontZ, direction, width - .60, style === 'cafe' ? '#7e493e' : '#617575', style === 'cafe');
    const signWidth = Math.min(3.9, width * .55);
    block(roof, [signWidth, .55, .15], style === 'cafe' ? '#354e45' : '#394b51', [centerX, 3.20, windowZ]);
    const sign = makeSign?.(room.name, signWidth, .55);
    if (sign) { sign.position.set(centerX, 3.20, windowZ + direction * .09); sign.rotation.y = facing; roof.add(sign); }
    if (style === 'workshop') {
      for (const side of [-1, 1]) block(facade, [.16, 2.45, .16], '#72664c', [x + .18 + (side > 0 ? width - .36 : 0), 1.225, windowZ]);
    }
  }
  for (const section of [roof, facade, fixed]) batchStaticMeshes(section);
  return { group, roof, facade, fixed, roomId: room.id, layout };
}

function roundedGround(parent, bounds) {
  const width = bounds.width + 6, depth = bounds.depth + 6, radius = 2;
  const shape = new THREE.Shape(), left = -width / 2, right = width / 2, bottom = -depth / 2, top = depth / 2;
  shape.moveTo(left + radius, bottom); shape.lineTo(right - radius, bottom); shape.quadraticCurveTo(right, bottom, right, bottom + radius);
  shape.lineTo(right, top - radius); shape.quadraticCurveTo(right, top, right - radius, top); shape.lineTo(left + radius, top);
  shape.quadraticCurveTo(left, top, left, top - radius); shape.lineTo(left, bottom + radius); shape.quadraticCurveTo(left, bottom, left + radius, bottom);
  const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: .30, bevelEnabled: true, bevelThickness: .10, bevelSize: .22, bevelSegments: 2, steps: 1 }), mat('#8ba16c'));
  mesh.rotation.x = -Math.PI / 2; mesh.position.set((bounds.minX + bounds.maxX) / 2, -.47, (bounds.minZ + bounds.maxZ) / 2);
  mesh.receiveShadow = true; parent.add(mesh);
}
function path(parent, x, z, width, depth) {
  block(parent, [width + .18, .045, depth + .18], '#aaa98e', [x, -.002, z]);
  block(parent, [width, .048, depth], '#d0cbb0', [x, .005, z]);
  const horizontal = width > depth, length = horizontal ? width : depth;
  for (let at = -length / 2 + 1.2; at < length / 2; at += 1.2) block(parent,
    horizontal ? [.022, .007, depth] : [width, .007, .022], '#a9aa93', [x + (horizontal ? at : 0), .034, z + (horizontal ? 0 : at)]);
}
function flowers(parent, x, z, seed) {
  const colors = ['#ebbc79', '#d6858f', '#e9d797', '#b4bfe0'];
  for (let i = 0; i < 5; i++) {
    const angle = i * 2.399 + seed, radius = .12 + (i % 3) * .12;
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(.08, 0), mat(colors[(seed + i) % colors.length]));
    mesh.position.set(x + Math.cos(angle) * radius, .13 + (i % 2) * .06, z + Math.sin(angle) * radius); parent.add(mesh);
    block(parent, [.018, .10, .018], '#58774b', [mesh.position.x, .05, mesh.position.z]);
  }
}
function parkGround(parent, rooms, layouts) {
  for (const room of rooms.filter(room => room.environment === 'outdoor')) {
    const { x, z, width, depth } = room.bounds, garden = /garden/i.test(room.name);
    if (garden) {
      path(parent, x + width / 2, z + depth / 2, width - .4, 1.1);
      path(parent, x + width / 2, z + depth / 2, 1.1, depth - .4);
    } else if (width > depth * 1.4) {
      path(parent, x + width / 2, z + depth / 2, width - .3, 2.7);
      path(parent, x + width / 2, z + 1.1, width - .3, 1.65);
      path(parent, x + width / 2, z + depth - 1.1, width - .3, 1.65);
      const entrances = [...new Set(layouts.filter(layout => Math.abs(layout.frontZ - z) < .6 || Math.abs(layout.frontZ - z - depth) < .6).map(layout => layout.doorX))];
      for (const entranceX of entrances) path(parent, entranceX, z + depth / 2, 1.30, depth);
    }
    // Small flowers/low groundcover are nonblocking decoration. Native trees
    // are separate entities with real trunk colliders and exact positions.
    const count = Math.min(16, Math.floor(width / 2));
    for (let i = 0; i < count; i++) {
      const flowerX = x + .65 + (width - 1.3) * (i + .5) / count;
      for (const flowerZ of [z + .40, z + depth - .40]) {
        if (layouts.some(layout => Math.abs(layout.doorX - flowerX) < 1.5 && Math.abs(layout.frontZ - flowerZ) < 1)) continue;
        disc(parent, .42, '#77925c', flowerX, flowerZ, .014, .7); flowers(parent, flowerX, flowerZ, i);
      }
    }
  }
}

export function createTownArchitecture(snapshot, { makeSign } = {}) {
  const group = new THREE.Group(), buildings = new Map(); group.name = 'town-presentation-only';
  const bounds = roomExtents(snapshot.rooms);
  if (snapshot.scenario?.id !== 'town' || !bounds) return { group, buildings };
  const theme = worldTheme(snapshot.scenario);
  const grounds = new THREE.Group(); group.add(grounds); roundedGround(grounds, bounds);
  for (const room of snapshot.rooms) {
    const house = buildHouse(room, snapshot.entities, makeSign, theme); if (!house) continue;
    group.add(house.group); buildings.set(room.id, house);
  }
  parkGround(grounds, snapshot.rooms, [...buildings.values()].map(value => value.layout));
  batchStaticMeshes(grounds);
  if (theme) {
    const tint = new THREE.Color(theme.architectureTint);
    group.traverse(object => {
      const material = object.material;
      if (material?.color && !material.map && !material.emissive?.getHex()) material.color.lerp(tint, theme.architectureBlend);
    });
  }
  return { group, buildings };
}

export function setTownInteriors(architecture, revealed) {
  for (const [id, building] of architecture.buildings) {
    building.roof.visible = !revealed.has(id); building.facade.visible = !revealed.has(id);
  }
}
