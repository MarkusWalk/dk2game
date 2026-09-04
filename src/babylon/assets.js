// ============================================================
// BABYLON ASSET LIBRARY
// ============================================================
// Cached AssetContainers keep authored GLB models out of the live scene until
// needed. Instantiations share geometry and materials unless explicitly asked
// to clone materials.

const BABYLON = window.BABYLON;

function requireBabylon() {
  if (!BABYLON) {
    throw new Error('Babylon.js must be loaded before importing assets.js.');
  }
}

function splitAssetUrl(source) {
  const absolute = new URL(source, document.baseURI).href;
  const slash = absolute.lastIndexOf('/');
  return {
    rootUrl: absolute.slice(0, slash + 1),
    fileName: absolute.slice(slash + 1),
  };
}

function setVector(target, value) {
  if (!target || value == null) return;
  if (Array.isArray(value)) target.set(value[0], value[1], value[2]);
  else if (typeof value === 'number') target.setAll(value);
  else target.copyFrom(value);
}

function disposeInstance(instance) {
  for (const animation of instance.animationGroups || []) animation.dispose();
  // Instantiations share the container's materials and geometry by default.
  instance.root?.dispose(false, false);
  for (const skeleton of instance.skeletons || []) skeleton.dispose();
}

export function createDungeonMaterial(scene, name, options = {}) {
  requireBabylon();
  const material = new BABYLON.PBRMaterial(name, scene);
  material.albedoColor = BABYLON.Color3.FromHexString(options.color || '#6f6258');
  material.metallic = options.metallic ?? 0.05;
  material.roughness = options.roughness ?? 0.78;
  material.environmentIntensity = options.environmentIntensity ?? 0.65;
  material.directIntensity = options.directIntensity ?? 1;
  material.emissiveIntensity = options.emissiveIntensity ?? 1;
  material.maxSimultaneousLights = options.maxLights ?? 4;

  if (options.emissive) {
    material.emissiveColor = BABYLON.Color3.FromHexString(options.emissive);
  }
  if (options.alpha != null) {
    material.alpha = options.alpha;
    material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
  }
  return material;
}

export function createFallbackMaterialPalette(scene) {
  return Object.freeze({
    stone: createDungeonMaterial(scene, 'fallback:stone', {
      color: '#514842', roughness: 0.92,
    }),
    floor: createDungeonMaterial(scene, 'fallback:floor', {
      color: '#392f2b', roughness: 0.86,
    }),
    claimed: createDungeonMaterial(scene, 'fallback:claimed', {
      color: '#632827', emissive: '#170403', roughness: 0.72,
    }),
    skin: createDungeonMaterial(scene, 'fallback:skin', {
      color: '#913f30', roughness: 0.74,
    }),
    iron: createDungeonMaterial(scene, 'fallback:iron', {
      color: '#57545b', metallic: 0.72, roughness: 0.42,
    }),
    gold: createDungeonMaterial(scene, 'fallback:gold', {
      color: '#d18a24', emissive: '#241000', metallic: 0.78, roughness: 0.3,
    }),
    magic: createDungeonMaterial(scene, 'fallback:magic', {
      color: '#8b2739', emissive: '#8b1129', metallic: 0.12, roughness: 0.38,
    }),
  });
}

export class AssetLibrary {
  constructor(scene, options = {}) {
    requireBabylon();
    if (!scene) throw new Error('AssetLibrary requires a Babylon scene.');

    this.scene = scene;
    this.baseUrl = options.baseUrl || './assets/models/';
    this.containers = new Map();
    this.pending = new Map();
    this.instances = new Set();
    this.materials = options.materials || createFallbackMaterialPalette(scene);
    this.onProgress = options.onProgress || null;
    this.runtime = options.runtime || null;
    this.shadowGenerator = options.shadowGenerator || options.shadows || null;
    this.disposed = false;
  }

  setRuntime(runtime) {
    this.runtime = runtime || null;
    this.shadowGenerator = runtime?.shadowGenerator || runtime?.shadows || this.shadowGenerator;
    return this;
  }

  has(key) {
    return this.containers.has(key);
  }

  get(key) {
    return this.containers.get(key) || null;
  }

  async load(key, source = `${key}.glb`, options = {}) {
    if (this.disposed) throw new Error('AssetLibrary has been disposed.');
    if (this.containers.has(key)) return this.containers.get(key);
    if (this.pending.has(key)) return this.pending.get(key);

    if (!BABYLON.SceneLoader?.LoadAssetContainerAsync) {
      throw new Error('Babylon glTF loader is unavailable. Load babylonjs.loaders.min.js before main.js.');
    }

    const url = /^(?:[a-z]+:|\/|\.\.?\/)/i.test(source) ? source : `${this.baseUrl}${source}`;
    const { rootUrl, fileName } = splitAssetUrl(url);
    const request = BABYLON.SceneLoader.LoadAssetContainerAsync(
      rootUrl,
      fileName,
      this.scene,
      options.onProgress || this.onProgress,
      '.glb',
    ).then((container) => {
      if (this.disposed) {
        container.dispose();
        throw new Error('AssetLibrary was disposed while loading.');
      }
      this.#prepareContainer(container, options);
      this.containers.set(key, container);
      return container;
    }).finally(() => {
      this.pending.delete(key);
    });

    this.pending.set(key, request);
    return request;
  }

  async loadManifest(manifest, options = {}) {
    const normaliseEntry = (entry, fallbackKey) => {
      if (typeof entry === 'string') return { key: fallbackKey, source: entry, options: {} };
      if (!entry || typeof entry !== 'object') return { key: fallbackKey, source: entry, options: {} };
      return {
        key: entry.key || fallbackKey,
        source: entry.source ?? entry.url ?? entry.file,
        options: entry.options && typeof entry.options === 'object' ? entry.options : {},
      };
    };
    const entries = Array.isArray(manifest)
      ? manifest.map((entry, index) => normaliseEntry(entry, entry?.key || `asset-${index + 1}`))
      : Object.entries(manifest).map(([key, entry]) => normaliseEntry(entry, key));
    const { continueOnError = false, timeoutMs = 12000, ...loadOptions } = options;
    const defaultTimeout = Math.max(1, Number(timeoutMs) || 12000);
    const loadWithTimeout = (entry) => {
      const entryTimeout = Math.max(1, Number(entry.options.timeoutMs) || defaultTimeout);
      const request = this.load(entry.key, entry.source, { ...loadOptions, ...entry.options });
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          reject(new Error(`Timed out loading optional asset "${entry.key}" after ${entryTimeout}ms.`));
        }, entryTimeout);
        request.then(
          (result) => { window.clearTimeout(timer); resolve(result); },
          (error) => { window.clearTimeout(timer); reject(error); },
        );
      });
    };
    const tasks = entries.map(loadWithTimeout);

    if (!continueOnError) return Promise.all(tasks);
    return Promise.allSettled(tasks);
  }

  instantiate(key, options = {}) {
    const container = this.containers.get(key);
    if (!container) throw new Error(`Asset "${key}" has not been loaded.`);

    const prefix = options.name || key;
    const result = container.instantiateModelsToScene(
      (sourceName) => `${prefix}:${sourceName}`,
      options.cloneMaterials === true,
      { doNotInstantiate: options.forceClone === true },
    );
    const root = new BABYLON.TransformNode(prefix, this.scene);
    for (const node of result.rootNodes) node.parent = root;

    setVector(root.position, options.position);
    setVector(root.rotation, options.rotation);
    setVector(root.scaling, options.scaling ?? 1);
    if (options.parent) root.parent = options.parent;
    root.metadata = { assetKey: key, ...options.metadata };

    const shadowCasters = options.castShadows === false
      ? []
      : this.#registerShadowCasters(result.rootNodes);

    const instance = {
      key,
      root,
      rootNodes: result.rootNodes,
      skeletons: result.skeletons,
      animationGroups: result.animationGroups,
      dispose: () => {
        if (!this.instances.delete(instance)) return;
        const shadowGenerator = this.#getShadowGenerator();
        if (shadowGenerator) {
          for (const mesh of shadowCasters) shadowGenerator.removeShadowCaster?.(mesh, false);
        }
        disposeInstance(instance);
      },
    };
    this.instances.add(instance);

    const animation = this.#findAnimation(result.animationGroups, options.animation);
    if (animation && options.autoPlay !== false) {
      animation.start(options.loopAnimation !== false, options.animationSpeed ?? 1);
    }
    return instance;
  }

  async loadAndInstantiate(key, source, options = {}) {
    await this.load(key, source, options);
    return this.instantiate(key, options);
  }

  disposeAsset(key, options = {}) {
    const container = this.containers.get(key);
    if (!container) return false;
    const live = [...this.instances].filter((instance) => instance.key === key);
    if (live.length && !options.force) return false;
    for (const instance of live) instance.dispose();
    container.dispose();
    this.containers.delete(key);
    return true;
  }

  getStats() {
    return {
      loaded: this.containers.size,
      loading: this.pending.size,
      liveInstances: this.instances.size,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const instance of [...this.instances]) instance.dispose();
    for (const container of this.containers.values()) container.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
    this.containers.clear();
    this.pending.clear();
  }

  #prepareContainer(container, options) {
    for (const material of container.materials) {
      material.maxSimultaneousLights = options.maxLights ?? 4;
      if ('environmentIntensity' in material) {
        material.environmentIntensity = options.environmentIntensity ?? 0.7;
      }
      if ('roughness' in material && material.roughness == null) material.roughness = 0.75;
    }

    for (const mesh of container.meshes) {
      if (mesh.getTotalVertices?.() > 0 && !mesh.material) {
        mesh.material = this.materials[options.fallbackMaterial || 'stone'];
      }
      mesh.receiveShadows = options.receiveShadows !== false;
      mesh.isPickable = options.isPickable !== false;
      mesh.alwaysSelectAsActiveMesh = false;
    }
  }

  #getShadowGenerator() {
    if (this.runtime?.shadowGenerator || this.runtime?.shadows) {
      return this.runtime.shadowGenerator || this.runtime.shadows;
    }
    if (this.shadowGenerator) return this.shadowGenerator;
    for (const light of this.scene.lights || []) {
      const generator = light.getShadowGenerator?.() || light._shadowGenerator;
      if (generator) return generator;
    }
    return null;
  }

  #registerShadowCasters(rootNodes) {
    const shadowGenerator = this.#getShadowGenerator();
    if (!shadowGenerator) return [];
    const meshes = new Set();
    for (const root of rootNodes || []) {
      if (root.getTotalVertices?.() > 0) meshes.add(root);
      for (const mesh of root.getChildMeshes?.(false) || []) {
        if (mesh.getTotalVertices?.() > 0) meshes.add(mesh);
      }
    }
    for (const mesh of meshes) shadowGenerator.addShadowCaster(mesh, false);
    return [...meshes];
  }

  #findAnimation(groups, requested) {
    if (!groups.length || requested === false) return null;
    if (!requested) return groups[0];
    const normalized = String(requested).toLowerCase();
    return groups.find((group) => group.name.toLowerCase() === normalized)
      || groups.find((group) => group.name.toLowerCase().includes(normalized))
      || null;
  }
}
