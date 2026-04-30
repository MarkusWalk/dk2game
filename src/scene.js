// ============================================================
// SCENE / RENDERER / LIGHTING
// ============================================================
// Owns the singleton Three.js scene, renderer, and directional sun light.
// The camera itself lives in camera-controls.js so pan/zoom state is local
// to that module; but makeCamera() is re-invoked here on resize.

import { HEART_X, HEART_Z } from './constants.js';

const THREE = window.THREE;

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0508);
scene.fog = new THREE.Fog(0x0a0508, 24, 52);

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;   // bumped 1.1 → 1.35 so the dungeon reads warmer
document.body.appendChild(renderer.domElement);

// ============================================================
// LIGHTING
// ============================================================
// Bumped from 0.35 → 0.55 so undiscovered rock doesn't read as a black void.
// Slight warm shift makes torches still read as the warm light source.
export const ambient = new THREE.AmbientLight(0x4a3528, 0.55);
scene.add(ambient);

// Moon-ish directional for gentle shape definition + shadows. Bumped 0.4 →
// 0.55 to lift the overall scene without washing out shadows.
export const sun = new THREE.DirectionalLight(0x9a7aaa, 0.55);
sun.position.set(HEART_X + 15, 30, HEART_Z + 15);
sun.target.position.set(HEART_X, 0, HEART_Z);
sun.castShadow = true;
// 2048² → 1024² — the visual difference is barely perceptible at iso zoom and
// the shadow pass is ~4× cheaper. The 64×64 map renders thousands of meshes
// per frame; halving each axis makes the shadow texture write a quarter as
// many pixels and the depth-only pass that fills it shorter accordingly.
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -36;
sun.shadow.camera.right = 36;
sun.shadow.camera.top = 36;
sun.shadow.camera.bottom = -36;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 140;
sun.shadow.bias = -0.0008;
scene.add(sun);
scene.add(sun.target);

// Shared tile container — rocks / floors / walls / portals all parent to this
export const tileGroup = new THREE.Group();
scene.add(tileGroup);

// Imp + creature containers — separate so hit-testing can target them cheaply
export const impGroup = new THREE.Group();
scene.add(impGroup);

export const creatureGroup = new THREE.Group();
scene.add(creatureGroup);
