// ============================================================
// BABYLON RUNTIME / SCENE / LIGHTING
// ============================================================

import { GRID_SIZE, HEART_X, HEART_Z } from '../constants.js';
import { AssetLibrary } from './assets.js';
import { resolveQualityProfile } from './quality.js';

const BABYLON = window.BABYLON;

function requireBabylon() {
  if (!BABYLON) {
    throw new Error('Babylon.js must be loaded before importing core.js.');
  }
}

async function createEngine(canvas, options) {
  const engineOptions = {
    preserveDrawingBuffer: false,
    stencil: true,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
    doNotHandleContextLost: false,
    ...options.engineOptions,
  };

  const webgpuSupport = BABYLON.WebGPUEngine?.IsSupportedAsync;
  const canUseWebGPU = typeof webgpuSupport === 'function'
    ? await webgpuSupport.call(BABYLON.WebGPUEngine)
    : await webgpuSupport;
  if (options.preferWebGPU && BABYLON.WebGPUEngine && canUseWebGPU) {
    try {
      const webgpu = new BABYLON.WebGPUEngine(canvas, engineOptions);
      await webgpu.initAsync();
      return webgpu;
    } catch (error) {
      console.warn('WebGPU initialization failed; falling back to WebGL.', error);
    }
  }

  return new BABYLON.Engine(canvas, options.antialias !== false, engineOptions, false);
}

function createCamera(scene, canvas, options) {
  const target = options.cameraTarget || new BABYLON.Vector3(HEART_X, 0, HEART_Z);
  const camera = new BABYLON.ArcRotateCamera(
    'dungeonCamera',
    options.cameraAlpha ?? -Math.PI / 4,
    options.cameraBeta ?? Math.PI / 3.25,
    options.cameraRadius ?? 34,
    target,
    scene,
  );
  camera.minZ = 0.1;
  camera.maxZ = Math.max(180, GRID_SIZE * 3);
  camera.lowerRadiusLimit = 10;
  camera.upperRadiusLimit = 62;
  camera.lowerBetaLimit = Math.PI / 5;
  camera.upperBetaLimit = Math.PI / 2.18;
  camera.wheelPrecision = 18;
  camera.pinchPrecision = 45;
  camera.panningSensibility = 72;
  camera.inertia = 0.72;
  camera.useNaturalPinchZoom = true;
  camera.inputs.attached.keyboard?.detachControl?.();
  if (options.attachCameraControls !== false) camera.attachControl(canvas, true);
  return camera;
}

function createLights(scene) {
  const hemi = new BABYLON.HemisphericLight(
    'dungeonFill',
    new BABYLON.Vector3(-0.25, 1, 0.15),
    scene,
  );
  hemi.diffuse = BABYLON.Color3.FromHexString('#8b769c');
  hemi.groundColor = BABYLON.Color3.FromHexString('#21130f');
  hemi.intensity = 0.52;
  hemi.specular = BABYLON.Color3.FromHexString('#54445e');

  const sun = new BABYLON.DirectionalLight(
    'dungeonMoon',
    new BABYLON.Vector3(-0.48, -1, -0.35),
    scene,
  );
  sun.position = new BABYLON.Vector3(HEART_X + 24, 42, HEART_Z + 20);
  sun.diffuse = BABYLON.Color3.FromHexString('#bda4d2');
  sun.specular = BABYLON.Color3.FromHexString('#8f729d');
  sun.intensity = 1.25;
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = Math.max(90, GRID_SIZE * 1.6);
  return { hemi, sun };
}

function createShadows(scene, light, profile, options) {
  let shadows;
  if (options.cascadedShadows !== false && BABYLON.CascadedShadowGenerator) {
    shadows = new BABYLON.CascadedShadowGenerator(profile.shadowMapSize, light);
    shadows.numCascades = profile.shadowCascades;
    shadows.lambda = 0.65;
    shadows.cascadeBlendPercentage = 0.08;
    shadows.stabilizeCascades = true;
    shadows.autoCalcDepthBounds = false;
  } else {
    shadows = new BABYLON.ShadowGenerator(profile.shadowMapSize, light);
  }
  shadows.bias = 0.00055;
  shadows.normalBias = 0.025;
  shadows.darkness = 0.34;
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = profile.shadowFiltering === 'high'
    ? BABYLON.ShadowGenerator.QUALITY_HIGH
    : BABYLON.ShadowGenerator.QUALITY_MEDIUM;
  shadows.enableSoftTransparentShadow = false;
  shadows.transparencyShadow = false;
  return shadows;
}

function configureImageProcessing(scene) {
  const image = scene.imageProcessingConfiguration;
  image.isEnabled = true;
  image.toneMappingEnabled = true;
  image.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
  image.exposure = 1.15;
  image.contrast = 1.12;
  image.vignetteEnabled = true;
  image.vignetteWeight = 1.15;
  image.vignetteStretch = 0.18;
  image.vignetteColor = new BABYLON.Color4(0.08, 0.015, 0.025, 1);
  image.vignetteCameraFov = 0.62;
}

function configureEnvironment(scene, options) {
  if (!options.environmentUrl) return null;
  const texture = options.environmentUrl.toLowerCase().includes('.hdr')
    ? new BABYLON.HDRCubeTexture(options.environmentUrl, scene, options.environmentSize || 128)
    : BABYLON.CubeTexture.CreateFromPrefilteredData(options.environmentUrl, scene);
  scene.environmentTexture = texture;
  scene.environmentIntensity = options.environmentIntensity ?? 0.7;
  return texture;
}

function createPostProcessing(scene, camera, profile) {
  if (!BABYLON.DefaultRenderingPipeline) return null;
  const pipeline = new BABYLON.DefaultRenderingPipeline(
    'dungeonPipeline',
    true,
    scene,
    [camera],
  );
  pipeline.fxaaEnabled = profile.fxaa && profile.samples <= 1;
  pipeline.samples = profile.samples;
  pipeline.bloomEnabled = profile.bloom;
  pipeline.bloomThreshold = 0.72;
  pipeline.bloomWeight = 0.22;
  pipeline.bloomKernel = profile.name === 'ultra' ? 96 : 64;
  pipeline.bloomScale = 0.5;
  pipeline.sharpenEnabled = profile.sharpen;
  if (pipeline.sharpen) {
    pipeline.sharpen.edgeAmount = 0.16;
    pipeline.sharpen.colorAmount = 0.75;
  }
  return pipeline;
}

function applyHardwareScaling(engine, profile) {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, profile.maxDevicePixelRatio);
  engine.setHardwareScalingLevel(profile.hardwareScaling / pixelRatio);
}

class RuntimePerformance {
  constructor(engine, scene, captureGpuFrameTime = false) {
    this.engine = engine;
    this.scene = scene;
    this.sceneInstrumentation = BABYLON.SceneInstrumentation
      ? new BABYLON.SceneInstrumentation(scene)
      : null;
    this.engineInstrumentation = BABYLON.EngineInstrumentation
      ? new BABYLON.EngineInstrumentation(engine)
      : null;

    if (this.sceneInstrumentation) {
      this.sceneInstrumentation.captureFrameTime = true;
      this.sceneInstrumentation.captureRenderTime = true;
      this.sceneInstrumentation.captureActiveMeshesEvaluationTime = true;
    }
    if (this.engineInstrumentation && captureGpuFrameTime) {
      this.engineInstrumentation.captureGPUFrameTime = true;
    }
  }

  snapshot() {
    const sceneStats = this.sceneInstrumentation;
    const engineStats = this.engineInstrumentation;
    const gpuAverage = engineStats?.gpuFrameTimeCounter?.average;
    return {
      fps: Math.round(this.engine.getFps() * 10) / 10,
      frameMs: sceneStats?.frameTimeCounter?.average ?? this.engine.getDeltaTime(),
      renderMs: sceneStats?.renderTimeCounter?.average ?? null,
      gpuMs: Number.isFinite(gpuAverage) ? gpuAverage / 1e6 : null,
      activeMeshes: this.scene.getActiveMeshes().length,
      totalMeshes: this.scene.meshes.length,
      activeIndices: this.scene.getActiveIndices(),
      activeParticles: this.scene.getActiveParticles(),
      materials: this.scene.materials.length,
      textures: this.scene.textures.length,
      drawCalls: this.engine._drawCalls?.current ?? null,
    };
  }

  dispose() {
    this.sceneInstrumentation?.dispose();
    this.engineInstrumentation?.dispose();
  }
}

export async function createBabylonRuntime(options = {}) {
  requireBabylon();
  const canvas = options.canvas || document.getElementById(options.canvasId || 'renderCanvas');
  if (!canvas) throw new Error('A render canvas is required to initialize Babylon.js.');

  let quality = resolveQualityProfile(options.quality || 'auto');
  const engine = await createEngine(canvas, options);
  applyHardwareScaling(engine, quality);

  const scene = new BABYLON.Scene(engine);
  scene.clearColor = BABYLON.Color4.FromHexString('#08050aff');
  scene.ambientColor = BABYLON.Color3.FromHexString('#1b1018');
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
  scene.fogColor = BABYLON.Color3.FromHexString('#0b070d');
  scene.fogDensity = 0.014;
  scene.environmentIntensity = 0.7;
  scene.skipPointerMovePicking = true;
  scene.autoClear = true;

  const camera = createCamera(scene, canvas, options);
  const lights = createLights(scene);
  const shadows = createShadows(scene, lights.sun, quality, options);
  configureImageProcessing(scene);
  const environmentTexture = configureEnvironment(scene, options);
  const pipeline = createPostProcessing(scene, camera, quality);
  const glow = BABYLON.GlowLayer ? new BABYLON.GlowLayer('dungeonGlow', scene, {
    mainTextureFixedSize: quality.name === 'low' ? 256 : 512,
    blurKernelSize: quality.name === 'ultra' ? 48 : 32,
  }) : null;
  if (glow) {
    glow.intensity = 0.42;
    glow.isEnabled = quality.glow;
  }

  const performance = new RuntimePerformance(engine, scene, options.captureGpuFrameTime === true);
  const assetLibrary = options.assetLibrary || new AssetLibrary(scene, options.assets);
  let disposed = false;
  const resize = () => engine.resize();
  window.addEventListener('resize', resize, { passive: true });

  const runtime = {
    canvas,
    engine,
    scene,
    camera,
    lights,
    shadows,
    shadowGenerator: shadows,
    pipeline,
    glow,
    environmentTexture,
    performance,
    assetLibrary,
    assets: assetLibrary,
    get quality() { return quality; },
    addShadowCaster(mesh, includeDescendants = true) {
      shadows.addShadowCaster(mesh, includeDescendants);
    },
    removeShadowCaster(mesh, includeDescendants = true) {
      shadows.removeShadowCaster(mesh, includeDescendants);
    },
    setQuality(tier) {
      quality = resolveQualityProfile(tier);
      applyHardwareScaling(engine, quality);
      shadows.numCascades = quality.shadowCascades;
      shadows.filteringQuality = quality.shadowFiltering === 'high'
        ? BABYLON.ShadowGenerator.QUALITY_HIGH
        : BABYLON.ShadowGenerator.QUALITY_MEDIUM;
      shadows.getShadowMap()?.resize(quality.shadowMapSize);
      if (pipeline) {
        pipeline.fxaaEnabled = quality.fxaa && quality.samples <= 1;
        pipeline.samples = quality.samples;
        pipeline.bloomEnabled = quality.bloom;
        pipeline.sharpenEnabled = quality.sharpen;
      }
      if (glow) glow.isEnabled = quality.glow;
      engine.resize();
      return quality;
    },
    start(render = null) {
      if (disposed) return;
      engine.runRenderLoop(render || (() => scene.render()));
    },
    stop() {
      engine.stopRenderLoop();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('resize', resize);
      engine.stopRenderLoop();
      performance.dispose();
      assetLibrary.dispose();
      scene.dispose();
      engine.dispose();
    },
  };

  assetLibrary.setRuntime?.(runtime);

  return runtime;
}

export { AssetLibrary, resolveQualityProfile };
