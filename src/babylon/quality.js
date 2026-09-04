// ============================================================
// BABYLON QUALITY PROFILES
// ============================================================
// Hardware scaling values are multipliers on the capped device-pixel-ratio
// baseline: larger values render fewer pixels.

export const QUALITY_TIERS = Object.freeze({
  low: Object.freeze({
    maxDevicePixelRatio: 1.25,
    hardwareScaling: 1.45,
    shadowMapSize: 512,
    shadowCascades: 2,
    shadowFiltering: 'medium',
    samples: 1,
    fxaa: true,
    bloom: false,
    glow: false,
    sharpen: false,
    particlesScale: 0.45,
  }),
  medium: Object.freeze({
    maxDevicePixelRatio: 1.5,
    hardwareScaling: 1.2,
    shadowMapSize: 1024,
    shadowCascades: 2,
    shadowFiltering: 'medium',
    samples: 1,
    fxaa: true,
    bloom: true,
    glow: true,
    sharpen: false,
    particlesScale: 0.7,
  }),
  high: Object.freeze({
    maxDevicePixelRatio: 2,
    hardwareScaling: 1,
    shadowMapSize: 2048,
    shadowCascades: 3,
    shadowFiltering: 'high',
    samples: 2,
    fxaa: true,
    bloom: true,
    glow: true,
    sharpen: true,
    particlesScale: 1,
  }),
  ultra: Object.freeze({
    maxDevicePixelRatio: 2,
    hardwareScaling: 0.85,
    shadowMapSize: 2048,
    shadowCascades: 4,
    shadowFiltering: 'high',
    samples: 4,
    fxaa: true,
    bloom: true,
    glow: true,
    sharpen: true,
    particlesScale: 1.25,
  }),
});

export function selectQualityTier() {
  const memory = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const mobile = matchMedia('(pointer: coarse)').matches;

  if (memory <= 2 || cores <= 2) return 'low';
  if (mobile || memory <= 4 || cores <= 4) return 'medium';
  if (memory >= 8 && cores >= 8) return 'high';
  return 'medium';
}

export function resolveQualityProfile(tier = 'auto') {
  const name = tier === 'auto' ? selectQualityTier() : tier;
  if (!QUALITY_TIERS[name]) {
    throw new Error(`Unknown Babylon quality tier: ${name}`);
  }
  return { name, ...QUALITY_TIERS[name] };
}
