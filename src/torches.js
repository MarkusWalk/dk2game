// ============================================================
// TORCHES
// ============================================================
// Short stubby cylinder + icosahedron flame + warm point light. Each torch
// has its own flickerPhase so the flame noise decorrelates between copies.
// The animation loop flickers light.intensity + flame.scale each frame.

const THREE = window.THREE;

export function createTorch(x, z) {
  const group = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.05, 0.45, 6),
    new THREE.MeshStandardMaterial({ color: 0x1a1008, roughness: 0.9 })
  );
  base.position.y = 0.3;
  base.castShadow = true;
  group.add(base);

  const flame = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.1, 0),
    new THREE.MeshStandardMaterial({
      color: 0xffb040, emissive: 0xff7010, emissiveIntensity: 2.5, roughness: 0.4
    })
  );
  flame.position.y = 0.6;
  group.add(flame);

  const light = new THREE.PointLight(0xff8030, 1.6, 6, 1.8);
  light.position.y = 0.65;
  group.add(light);

  group.position.set(x, 0, z);
  group.userData = {
    flame, light,
    baseIntensity: 1.6,
    flickerPhase: Math.random() * 100
  };
  return group;
}
