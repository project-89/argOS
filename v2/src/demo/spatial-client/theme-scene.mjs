import * as THREE from 'three';
import { decorativeCoastBounds, worldTheme } from './theme-view.mjs';

/** Static set dressing only. Deliberately outside townArchitecture's framing
 * envelope and never offered as an entity, route, weather event or light state. */
export function createThemeScene(scene) {
  const root = new THREE.Group(); root.name = 'theme-presentation-only'; root.userData.presentationOnly = true;
  scene.add(root);
  const originalFog = scene.fog;
  let signature = '', sea = null, lights = [], disposed = false, haze = null;
  const clear = () => {
    root.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); object.dispose?.(); });
    root.clear(); sea = null; lights = [];
    if (scene.fog === haze) scene.fog = originalFog;
    haze = null;
  };
  return {
    sync(snapshot) {
      if (disposed) return;
      const theme = worldTheme(snapshot.scenario);
      const next = JSON.stringify([snapshot.sourceId, theme?.id, snapshot.rooms.map(room => [room.id, room.bounds, room.environment, !!room.building])]);
      if (signature === next) return;
      signature = next; clear();
      const coast = theme && decorativeCoastBounds(snapshot.rooms);
      if (!coast) return;
      haze = new THREE.FogExp2(theme.hazeColor, theme.hazeDensity); scene.fog = haze;
      sea = new THREE.Mesh(new THREE.PlaneGeometry(coast.width, coast.depth),
        new THREE.MeshStandardMaterial({ color: theme.seaColor, roughness: .7, metalness: .08, side: THREE.DoubleSide }));
      sea.name = 'decorative-sea-not-a-room'; sea.userData.presentationOnly = true;
      sea.rotation.x = -Math.PI / 2;
      sea.position.set(coast.x + coast.width / 2, coast.y, coast.z + coast.depth / 2); root.add(sea);
      // A few fixed surface strokes read as distant water, not an animated
      // current, an incident, sound, rain or a traversable extension of land.
      const points = [];
      for (let row = 0; row < 9; row++) {
        const x = coast.x + coast.width * (.06 + (row % 3) * .18), z = coast.z + coast.depth * (.12 + row * .095);
        points.push(x, coast.y + .012, z, x + coast.width * (.20 + row % 2 * .08), coast.y + .012, z);
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      root.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: theme.seaLine, transparent: true, opacity: .3 })));
      // Soft art-direction fill, not activation of a native lamp or power grid.
      for (const room of snapshot.rooms.filter(room => room.environment === 'indoor' && room.building).slice(0, 12)) {
        const b = room.bounds;
        if (![b?.x, b?.z, b?.width, b?.depth].every(Number.isFinite) || b.width <= 0 || b.depth <= 0) continue;
        const light = new THREE.PointLight(theme.interiorColor, theme.interiorIntensity, Math.min(14, Math.max(b.width, b.depth) * 1.25), 2);
        light.name = 'decorative-interior-fill'; light.position.set(b.x + b.width / 2, 2.2, b.z + b.depth / 2);
        light.castShadow = false; root.add(light); lights.push(light);
      }
    },
    dispose() { if (disposed) return; clear(); root.removeFromParent(); disposed = true; },
    diagnostics: () => ({ root, sea, lights: [...lights], disposed }),
  };
}
