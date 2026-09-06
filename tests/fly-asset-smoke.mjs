// Validate the exported giant Fly contract without installing dependencies.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = readFileSync(new URL('../assets/models/fly.glb', import.meta.url));
assert.equal(file.readUInt32LE(0), 0x46546c67, 'GLB magic');
assert.equal(file.readUInt32LE(4), 2, 'glTF 2');
assert.equal(file.readUInt32LE(8), file.length, 'complete file');
const jsonLength = file.readUInt32LE(12);
const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
const binary = file.subarray(28 + jsonLength);
assert.equal(gltf.buffers.length, 1);
assert.equal(gltf.buffers[0].uri, undefined, 'self-contained binary');
assert.equal(gltf.skins.length, 1);
// root, body, head, abdomen, four wing bones, six legs x (hip + knee).
assert.equal(gltf.skins[0].joints.length, 20, 'body/head/abdomen rig plus four wing bones and twelve leg bones');
for (const bone of ['root', 'body', 'head', 'abdomen', 'wing.FL', 'wing.FR', 'wing.BL', 'wing.BR',
  'leg_front.L', 'leg_front_knee.R', 'leg_mid.L', 'leg_back_knee.R']) {
  assert.ok(gltf.nodes.some(n => n.name === bone), `${bone} bone exported`);
}
assert.equal(gltf.materials.length, 3, 'atlas plus the kept eye and wing materials');
const atlas = gltf.materials.find(m => m.name.includes('baked 2K'));
assert.ok(atlas, 'baked atlas material present');
assert.ok(atlas.pbrMetallicRoughness.baseColorTexture, 'baked base color');
assert.ok(atlas.pbrMetallicRoughness.metallicRoughnessTexture, 'baked roughness and metallic');
assert.ok(atlas.normalTexture, 'baked surface normals');
// The compound eyes are a kept, unbaked emissive material -- pupil-less glowing red, like the imp's eyes.
const eye = gltf.materials.find(m => m.name.includes('Eyes'));
assert.ok(eye, 'eye material kept out of the atlas');
assert.ok(eye.emissiveFactor && Math.max(...eye.emissiveFactor) > 0, 'eye material glows');
assert.ok(eye.extensions?.KHR_materials_emissive_strength?.emissiveStrength > 1, 'eye material has HDR emission');
// The wings are a kept, unbaked translucent material.
const wing = gltf.materials.find(m => m.name.includes('Wings'));
assert.ok(wing, 'wing material kept out of the atlas');
assert.equal(wing.alphaMode, 'BLEND', 'wing material is alpha-blended');
assert.ok(wing.pbrMetallicRoughness.baseColorFactor[3] < 1, 'wing material is translucent');
assert.equal(gltf.images.length, 3, 'three embedded PBR maps');
for (const image of gltf.images) {
  assert.equal(image.uri, undefined, 'no external image dependencies');
  const view = gltf.bufferViews[image.bufferView];
  const png = binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
  assert.equal(png.readUInt32BE(16), 2048, '2K texture width');
  assert.equal(png.readUInt32BE(20), 2048, '2K texture height');
}
assert.deepEqual(gltf.animations.map(a => a.name).sort(), ['Attack', 'Death', 'Hit', 'Idle', 'Walk']);
function floatSample(index, sample) {
  const accessor = gltf.accessors[index];
  const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[accessor.type];
  const view = gltf.bufferViews[accessor.bufferView];
  const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0) + sample * (view.byteStride || width * 4);
  return Array.from({ length: width }, (_, n) => binary.readFloatLE(offset + n * 4));
}
for (const animation of gltf.animations) {
  assert.ok(animation.channels.length > 0, `${animation.name} contains animation`);
  for (const sampler of animation.samplers) {
    const time = gltf.accessors[sampler.input];
    assert.ok(time.max[0] > time.min[0], `${animation.name} has duration`);
    if (!['Hit', 'Death'].includes(animation.name)) {
      const output = gltf.accessors[sampler.output];
      const first = floatSample(sampler.output, 0);
      const last = floatSample(sampler.output, output.count - 1);
      assert.ok(first.every((v, i) => Math.abs(v - last[i]) < .0001), `${animation.name} loops without a pose jump`);
    }
  }
}
// Idle must actually flutter the wings (several beats) rather than hold them still.
const idle = gltf.animations.find(a => a.name === 'Idle');
for (const wingBone of ['wing.FL', 'wing.FR', 'wing.BL', 'wing.BR']) {
  const channel = idle.channels.find(c => gltf.nodes[c.target.node].name === wingBone && c.target.path === 'rotation');
  assert.ok(channel, `${wingBone} animates during Idle`);
  const output = idle.samplers[channel.sampler].output;
  const samples = Array.from({ length: gltf.accessors[output].count }, (_, i) => floatSample(output, i));
  const first = samples[0];
  const moved = samples.some(q => q.some((v, i) => Math.abs(v - first[i]) > .05));
  assert.ok(moved, `${wingBone} actually beats`);
  // Several beats per loop: track angular distance from rest (quaternion dot product,
  // sign-independent) rather than a single raw component -- each wing bone has its own
  // rest orientation, so "the flap axis" is not the same quaternion index for every wing.
  const dist = samples.map(q => 1 - Math.abs(q[0] * first[0] + q[1] * first[1] + q[2] * first[2] + q[3] * first[3]));
  let peaks = 0;
  for (let i = 1; i < dist.length - 1; i++) {
    if (dist[i] > dist[i - 1] && dist[i] > dist[i + 1] && dist[i] > 0.01) peaks++;
  }
  assert.ok(peaks >= 4, `${wingBone} beats several times per Idle loop (saw ${peaks} peaks)`);
}
let triangles = 0;
let minY = Infinity;
let maxY = -Infinity;
for (const mesh of gltf.meshes) {
  for (const primitive of mesh.primitives) {
    assert.equal(primitive.mode ?? 4, 4, 'triangulated');
    triangles += gltf.accessors[primitive.indices].count / 3;
    const positions = gltf.accessors[primitive.attributes.POSITION];
    minY = Math.min(minY, positions.min[1]);
    maxY = Math.max(maxY, positions.max[1]);
    assert.ok(primitive.attributes.JOINTS_0 != null, 'skinned geometry');
    assert.ok(primitive.attributes.TEXCOORD_0 != null, 'UV coordinates');
    const weights = gltf.accessors[primitive.attributes.WEIGHTS_0];
    assert.equal(weights.componentType, 5126, 'floating-point skin weights');
    const view = gltf.bufferViews[weights.bufferView];
    for (let i = 0; i < weights.count; i++) {
      const offset = (view.byteOffset || 0) + (weights.byteOffset || 0) + i * (view.byteStride || 16);
      const sum = [0, 4, 8, 12].reduce((s, n) => s + binary.readFloatLE(offset + n), 0);
      assert.ok(Math.abs(sum - 1) < 0.0001, 'every vertex has normalized skin weights');
    }
  }
}
// A hovering creature does not touch the ground: the leg tips (the lowest point)
// hang partway up, unlike the imp's feet-at-origin contract.
assert.ok(minY > 0.3 && minY < 0.5, `leg tips hover between 0.3 and 0.5 units (got ${minY.toFixed(3)})`);
assert.ok(maxY > 1.0 && maxY < 1.4, `wingtips reach roughly 1.0-1.4 units (got ${maxY.toFixed(3)})`);
assert.ok(triangles >= 40000 && triangles <= 90000, `triangle budget 40k-90k (got ${triangles})`);
assert.ok(file.length < 15 * 1024 * 1024, 'self-contained asset under 15 MiB');
console.log(`ok - fly GLB: ${triangles} triangles, 20 bones, 5 clips (3 looping, 2 one-shot), wings flutter, hovers ${minY.toFixed(3)}-${maxY.toFixed(3)} units`);
