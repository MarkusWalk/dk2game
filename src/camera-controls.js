// ============================================================
// CAMERA CONTROLS — pan / zoom / rotate
// ============================================================
// State-driven camera. Inputs mutate `cameraControls`; placeCameraPos reads
// state to reposition the camera each frame. This decouples "what the player
// wants to see" from how we render it, so we can smoothly pan, zoom with
// mouse wheel / pinch, and spin the iso yaw with Q/E — all without fighting
// the render loop.

import {
  GRID_SIZE, HEART_X, HEART_Z, CAM_DEFAULTS,
  CAM_ZOOM_MIN, CAM_ZOOM_MAX, CAM_PAN_MARGIN, ISO_ZOOM_LANDSCAPE,
} from './constants.js';
import { cameraControls, camKeys } from './state.js';
import { renderer, sun } from './scene.js';

const THREE = window.THREE;

// Fixed isometric (orthographic, ~30° pitch). Base zoom still adapts to aspect
// ratio; cameraControls.zoomMul then scales this per user input.
export function computeIsoZoom() {
  const aspect = window.innerWidth / window.innerHeight;
  if (aspect >= 1) return ISO_ZOOM_LANDSCAPE;
  return ISO_ZOOM_LANDSCAPE / Math.max(aspect, 0.5);
}
export function effectiveZoom() {
  return computeIsoZoom() / cameraControls.zoomMul;
}
export function placeCameraPos(cam) {
  const t = cameraControls.target;
  cam.position.set(
    t.x + Math.sin(cameraControls.yaw) * cameraControls.distance,
    cameraControls.height,
    t.z + Math.cos(cameraControls.yaw) * cameraControls.distance
  );
  cam.lookAt(t.x, 0, t.z);
}
export function makeCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  const zoom = effectiveZoom();
  const cam = new THREE.OrthographicCamera(
    -zoom * aspect, zoom * aspect,
    zoom, -zoom,
    0.1, 200
  );
  placeCameraPos(cam);
  return cam;
}

// cameraRef is a mutable reference so other modules can grab the current
// camera (rebuilt on resize) without import races.
export const cameraRef = { camera: makeCamera() };

export function updateCameraProjection() {
  const aspect = window.innerWidth / window.innerHeight;
  const zoom = effectiveZoom();
  const camera = cameraRef.camera;
  camera.left = -zoom * aspect;
  camera.right = zoom * aspect;
  camera.top = zoom;
  camera.bottom = -zoom;
  camera.updateProjectionMatrix();
}
export function clampCamTarget() {
  const m = CAM_PAN_MARGIN;
  cameraControls.target.x = Math.max(-m, Math.min(GRID_SIZE - 1 + m, cameraControls.target.x));
  cameraControls.target.z = Math.max(-m, Math.min(GRID_SIZE - 1 + m, cameraControls.target.z));
}
export function recenterCamera() {
  cameraControls.target.x = HEART_X;
  cameraControls.target.z = HEART_Z;
  cameraControls.yaw = CAM_DEFAULTS.yaw;
  cameraControls.zoomMul = 1.0;
  updateCameraProjection();
}

export function onResize() {
  // Rebuild with new aspect but preserve the user's pan/zoom/yaw state
  cameraRef.camera = makeCamera();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ============================================================
// CAMERA INPUT — keyboard, wheel, two-finger pinch/pan
// ============================================================
// Keyboard: arrows/WASD-minus-D pan, Q/E rotate, Z/X zoom, Space or C recenter.
// (D is dig mode, so WA_S_ only — keeps old bindings intact.)
// Wheel: zoom. Two-finger drag: pan. Pinch: zoom.
export function installCameraInput() {
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  window.addEventListener('keydown', (ev) => {
    const k = ev.key.toLowerCase();
    const camKeySet = ['arrowup','arrowdown','arrowleft','arrowright','w','a','s','q','e','z','x','+','=','-','_'];
    if (camKeySet.includes(k)) {
      camKeys.add(k);
      if (k.startsWith('arrow')) ev.preventDefault();
    }
    if (k === ' ' || k === 'c') { recenterCamera(); ev.preventDefault(); }
  });
  window.addEventListener('keyup', (ev) => camKeys.delete(ev.key.toLowerCase()));
  window.addEventListener('blur', () => camKeys.clear());

  // Mouse wheel zoom — exponential feel, clamped
  renderer.domElement.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const factor = ev.deltaY > 0 ? 1 / 1.12 : 1.12;
    cameraControls.zoomMul = Math.max(CAM_ZOOM_MIN, Math.min(CAM_ZOOM_MAX, cameraControls.zoomMul * factor));
    updateCameraProjection();
  }, { passive: false });

  // Two-finger touch: pan via midpoint delta, zoom via finger distance ratio.
  // Runs BEFORE (same element, different listener) the existing single-touch
  // drag-select handler. When a 2nd finger lands, we cancel the drag-select
  // (existing handler already does this) and take over gesture tracking.
  let twoFinger = null;   // { lastMidX, lastMidY, lastDist }
  function _screenToWorldPxFactor() {
    // World units per screen pixel on the vertical axis of the ortho frustum.
    return (2 * effectiveZoom()) / window.innerHeight;
  }
  renderer.domElement.addEventListener('touchstart', (ev) => {
    if (ev.touches.length === 2) {
      const t0 = ev.touches[0], t1 = ev.touches[1];
      twoFinger = {
        lastMidX: (t0.clientX + t1.clientX) / 2,
        lastMidY: (t0.clientY + t1.clientY) / 2,
        lastDist: Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY),
      };
      ev.preventDefault();
    }
  }, { passive: false });
  renderer.domElement.addEventListener('touchmove', (ev) => {
    if (twoFinger && ev.touches.length === 2) {
      const t0 = ev.touches[0], t1 = ev.touches[1];
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const dx = midX - twoFinger.lastMidX;
      const dy = midY - twoFinger.lastMidY;
      const pxw = _screenToWorldPxFactor();
      // Camera-right and camera-up in world XZ (horizontal projection).
      // Content follows fingers → target moves opposite to drag direction.
      const y = cameraControls.yaw;
      const rightX = -Math.cos(y),  rightZ = Math.sin(y);   // camera right in XZ
      const upX    =  Math.sin(y),  upZ    = Math.cos(y);   // screen-up in XZ (forward)
      cameraControls.target.x -= (rightX * dx + upX * (-dy)) * pxw;
      cameraControls.target.z -= (rightZ * dx + upZ * (-dy)) * pxw;
      clampCamTarget();
      // Pinch zoom
      if (twoFinger.lastDist > 0) {
        const f = dist / twoFinger.lastDist;
        cameraControls.zoomMul = Math.max(CAM_ZOOM_MIN, Math.min(CAM_ZOOM_MAX, cameraControls.zoomMul * f));
        updateCameraProjection();
      }
      twoFinger.lastMidX = midX;
      twoFinger.lastMidY = midY;
      twoFinger.lastDist = dist;
      ev.preventDefault();
    }
  }, { passive: false });
  renderer.domElement.addEventListener('touchend', (ev) => {
    if (ev.touches.length < 2) twoFinger = null;
  }, { passive: false });
}

// Per-frame camera update — applies held keys + writes final camera position
// + keeps the sun light following the camera target so shadows stay in frame.
export function tickCamera(dt) {
  let moveF = 0, moveR = 0, rot = 0, zoomK = 0;
  if (camKeys.has('arrowup')    || camKeys.has('w')) moveF += 1;
  if (camKeys.has('arrowdown')  || camKeys.has('s')) moveF -= 1;
  if (camKeys.has('arrowleft')  || camKeys.has('a')) moveR -= 1;
  if (camKeys.has('arrowright'))                     moveR += 1;  // 'd' is dig, not pan
  if (camKeys.has('q')) rot -= 1;
  if (camKeys.has('e')) rot += 1;
  if (camKeys.has('z') || camKeys.has('+') || camKeys.has('=')) zoomK += 1;
  if (camKeys.has('x') || camKeys.has('-') || camKeys.has('_')) zoomK -= 1;

  if (moveF || moveR) {
    const y = cameraControls.yaw;
    const fx = -Math.sin(y), fz = -Math.cos(y);   // forward in XZ
    const rx = -Math.cos(y), rz =  Math.sin(y);   // right in XZ
    const speed = 14 / cameraControls.zoomMul;
    cameraControls.target.x += (fx * moveF + rx * moveR) * speed * dt;
    cameraControls.target.z += (fz * moveF + rz * moveR) * speed * dt;
    clampCamTarget();
  }
  if (rot) cameraControls.yaw += rot * 1.3 * dt;
  if (zoomK) {
    cameraControls.zoomMul = Math.max(CAM_ZOOM_MIN, Math.min(CAM_ZOOM_MAX,
      cameraControls.zoomMul * Math.pow(1.6, zoomK * dt)));
    updateCameraProjection();
  }

  placeCameraPos(cameraRef.camera);

  // Apply additive screen-shake offsets AFTER placeCameraPos so the base
  // position isn't drifted by the shake (shake decays back to zero).
  if (_shakeRemaining > 0) {
    _shakeRemaining = Math.max(0, _shakeRemaining - dt);
    const k = _shakeRemaining / _shakeDuration;  // 1 at start → 0 at end
    const amp = _shakeAmplitude * k;
    cameraRef.camera.position.x += (Math.random() - 0.5) * amp;
    cameraRef.camera.position.y += (Math.random() - 0.5) * amp * 0.5;
    cameraRef.camera.position.z += (Math.random() - 0.5) * amp;
  }

  // Keep sun light following so shadow camera frustum covers what's visible.
  const t = cameraControls.target;
  sun.position.set(t.x + 15, 30, t.z + 15);
  sun.target.position.set(t.x, 0, t.z);
}

// ============================================================
// SCREEN SHAKE
// ============================================================
// Additive camera jitter applied each frame after base placement. Callers
// push amplitude + duration; subsequent calls take the max of existing
// and new, so a big hit during a small one's decay doesn't regress.
let _shakeRemaining = 0;   // seconds left on current shake
let _shakeDuration  = 0;   // total duration of current shake (for normalized decay)
let _shakeAmplitude = 0;   // world-unit peak offset
export function addScreenShake(amplitude, duration) {
  if (amplitude > _shakeAmplitude * (_shakeRemaining / (_shakeDuration || 1))) {
    _shakeAmplitude = amplitude;
    _shakeDuration = duration;
    _shakeRemaining = duration;
  }
}
