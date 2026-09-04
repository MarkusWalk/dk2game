// ============================================================
// BABYLON DUNGEON ENVIRONMENT
// ============================================================
// Centralises the scene's art direction and shared GPU resources.  Dungeon
// geometry is deliberately built from a small material atlas: fewer material
// switches matter much more than tiny geometric detail at an isometric camera
// distance.  The palette is PBR-ready, but all textures are optional so a GLB
// art pack can replace these procedural stand-ins incrementally.

const BABYLON = window.BABYLON;

function color(hex) {
  return BABYLON.Color3.FromHexString(hex);
}

function makeMaterial(scene, name, options) {
  const material = new BABYLON.PBRMaterial(`dungeon.${name}`, scene);
  material.albedoColor = color(options.color);
  material.metallic = options.metallic ?? 0;
  material.roughness = options.roughness ?? 0.82;
  material.environmentIntensity = options.environmentIntensity ?? 0.35;
  material.directIntensity = options.directIntensity ?? 1;
  material.specularIntensity = options.specularIntensity ?? 0.35;

  if (options.emissive) {
    material.emissiveColor = color(options.emissive);
    material.emissiveIntensity = options.emissiveIntensity ?? 1;
  }
  if (options.alpha !== undefined) {
    material.alpha = options.alpha;
    material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    material.backFaceCulling = false;
  }
  return material;
}

export class DungeonEnvironment {
  constructor(runtime) {
    if (!BABYLON) throw new Error('Babylon.js must be loaded before environment.js');
    if (!runtime || !runtime.scene) throw new Error('DungeonEnvironment requires runtime.scene');

    this.runtime = runtime;
    this.scene = runtime.scene;
    this.qualityName = runtime.quality?.name || runtime.quality || 'high';
    this.time = 0;
    this.animatedEmissives = [];
    this.materials = this._createMaterials();
    this._configureScene();
    this._adoptRuntimeLighting();
  }

  _configureScene() {
    const scene = this.scene;
    scene.clearColor = new BABYLON.Color4(0.008, 0.006, 0.014, 1);
    scene.ambientColor = color('#251a30');
    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogDensity = this.qualityName === 'low' ? 0.011 : 0.008;
    scene.fogColor = color('#100d18');
  }

  _createMaterials() {
    const scene = this.scene;
    const material = (name, options) => makeMaterial(scene, name, options);

    return {
      rock: material('rock', { color: '#211c2b', roughness: 0.96 }),
      rockEdge: material('rock-edge', { color: '#342940', roughness: 0.92 }),
      earth: material('earth', { color: '#34271f', roughness: 1 }),
      claimed: material('claimed', { color: '#5b2637', roughness: 0.78 }),
      claimedTrim: material('claimed-trim', {
        color: '#5a3325', metallic: 0.62, roughness: 0.42,
        emissive: '#421522', emissiveIntensity: 0.22,
      }),
      reinforced: material('reinforced', { color: '#54485c', metallic: 0.18, roughness: 0.64 }),
      reinforcedTrim: material('reinforced-trim', {
        color: '#927140', metallic: 0.84, roughness: 0.3,
        emissive: '#3a1907', emissiveIntensity: 0.16,
      }),
      gold: material('gold', {
        color: '#b87920', metallic: 0.92, roughness: 0.23,
        emissive: '#6f3106', emissiveIntensity: 0.42,
      }),
      water: material('water', {
        color: '#153c52', metallic: 0.12, roughness: 0.18,
        emissive: '#062b3c', emissiveIntensity: 0.3, alpha: 0.9,
      }),
      lava: material('lava', {
        color: '#721607', roughness: 0.34,
        emissive: '#ff3b08', emissiveIntensity: 1.55,
      }),
      lavaCrust: material('lava-crust', { color: '#21110d', metallic: 0.08, roughness: 0.92 }),
      portalStone: material('portal-stone', { color: '#30293c', metallic: 0.24, roughness: 0.6 }),
      portalEnergy: material('portal-energy', {
        color: '#54236e', roughness: 0.16,
        emissive: '#d252ff', emissiveIntensity: 1.65, alpha: 0.88,
      }),
      heartStone: material('heart-stone', { color: '#291c2d', metallic: 0.25, roughness: 0.58 }),
      heartCrystal: material('heart-crystal', {
        color: '#711425', roughness: 0.18,
        emissive: '#ff244f', emissiveIntensity: 1.7,
      }),
      fog: material('fog', {
        color: '#09080e', roughness: 1,
        emissive: '#05040a', emissiveIntensity: 0.15,
      }),
      mist: material('mist', {
        color: '#17111e', roughness: 1,
        emissive: '#0d0912', emissiveIntensity: 0.18, alpha: 0.38,
      }),
      blackIron: material('black-iron', { color: '#18151d', metallic: 0.78, roughness: 0.42 }),
      bone: material('bone', { color: '#b4aa88', roughness: 0.78 }),
      wood: material('wood', { color: '#4b291c', roughness: 0.9 }),
      leather: material('leather', { color: '#54202b', roughness: 0.84 }),
      straw: material('straw', { color: '#9c7a32', roughness: 1 }),
      blood: material('blood', { color: '#5b0812', roughness: 0.48 }),
      parchment: material('parchment', { color: '#ab9368', roughness: 0.88 }),
      blueRune: material('blue-rune', {
        color: '#27365d', roughness: 0.33,
        emissive: '#367df5', emissiveIntensity: 1.2,
      }),
      greenRune: material('green-rune', {
        color: '#214832', roughness: 0.34,
        emissive: '#36d47b', emissiveIntensity: 1.1,
      }),
      violetRune: material('violet-rune', {
        color: '#422859', roughness: 0.3,
        emissive: '#b35cff', emissiveIntensity: 1.25,
      }),
      fire: material('fire', {
        color: '#c33b08', roughness: 0.2,
        emissive: '#ff7a12', emissiveIntensity: 1.7,
      }),
    };
  }

  _adoptRuntimeLighting() {
    // core.js owns the global light, shadow and post-processing stack.  The
    // world only gives that stack its art direction; it never creates a second
    // set of lights or shadow maps.
    this.ambient = this.runtime.lights?.hemi || null;
    this.key = this.runtime.lights?.sun || null;
    this.shadowGenerator = this.runtime.shadows || this.runtime.shadowGenerator || null;
    this.glow = this.runtime.glow || null;
    if (this.ambient) {
      this.ambient.diffuse = color('#8b729d');
      this.ambient.groundColor = color('#180f16');
      this.ambient.specular = color('#3b3045');
    }
    if (this.key) {
      this.key.diffuse = color('#a68db7');
      this.key.specular = color('#c8aee8');
    }
  }

  registerEmissive(node, phase = 0, strength = 0.08) {
    this.animatedEmissives.push({ node, phase, strength });
    return node;
  }

  update(dt) {
    this.time += Math.min(dt || 0, 0.1);

    for (const entry of this.animatedEmissives) {
      if (!entry.node || entry.node.isDisposed?.()) continue;
      const pulse = 1 + Math.sin(this.time * 2.4 + entry.phase) * entry.strength;
      entry.node.scaling.setAll(pulse);
    }
  }

  dispose() {
    // Runtime-owned lighting, shadows and glow are disposed by core.js.
    for (const material of Object.values(this.materials)) material.dispose();
    this.animatedEmissives.length = 0;
  }
}

export function createDungeonEnvironment(runtime) {
  return new DungeonEnvironment(runtime);
}
