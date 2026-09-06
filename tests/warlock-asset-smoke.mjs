// Validate the exported warlock contract without installing dependencies.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = readFileSync(new URL('../assets/models/warlock.glb', import.meta.url));
assert.equal(file.readUInt32LE(0), 0x46546c67, 'GLB magic');
assert.equal(file.readUInt32LE(4), 2, 'glTF 2');
assert.equal(file.readUInt32LE(8), file.length, 'complete file');
const jsonLength = file.readUInt32LE(12);
const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
const binary = file.subarray(28 + jsonLength);
assert.equal(gltf.buffers.length, 1);
assert.equal(gltf.buffers[0].uri, undefined, 'self-contained binary');
assert.equal(gltf.skins.length, 1);
assert.equal(gltf.skins[0].joints.length, 22, 'body rig plus spine, beard, eyes, staff and orb bones');
for (const bone of ['spine', 'beard', 'eye.L', 'eye.R', 'staff', 'orb', 'hand.R']) {
  assert.ok(gltf.nodes.some(n => n.name === bone), `${bone} bone exported`);
}
assert.equal(gltf.materials.length, 4, 'atlas plus glowing eyes, orb and orb core');
const atlas = gltf.materials.find(m => m.name.includes('baked 2K'));
assert.ok(atlas.pbrMetallicRoughness.baseColorTexture, 'baked base color');
assert.ok(atlas.pbrMetallicRoughness.metallicRoughnessTexture, 'baked roughness and metallic');
assert.ok(atlas.normalTexture, 'baked surface normals');
// The warlock's eyes and staff orb glow violet; every kept material must emit light.
for (const glow of gltf.materials.filter(m => m !== atlas)) {
  assert.ok(glow.emissiveFactor && Math.max(...glow.emissiveFactor) > 0, `${glow.name} glows`);
  assert.ok(glow.extensions?.KHR_materials_emissive_strength?.emissiveStrength > 1, `${glow.name} has HDR emission`);
}
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
const idle = gltf.animations.find(a => a.name === 'Idle');
{
  // The staff orb pulses while the warlock idles.
  const channel = idle.channels.find(c => gltf.nodes[c.target.node].name === 'orb' && c.target.path === 'scale');
  assert.ok(channel, 'orb has a pulse channel');
  const output = idle.samplers[channel.sampler].output;
  const scales = Array.from({ length: gltf.accessors[output].count }, (_, i) => floatSample(output, i));
  const spread = Math.max(...scales.map(s => Math.max(...s))) - Math.min(...scales.map(s => Math.min(...s)));
  assert.ok(spread > .02, 'orb visibly pulses');
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
assert.ok(Math.abs(minY) < .02, 'feet at ground');
assert.ok(maxY > 1.75 && maxY < 1.95, 'fits the warlock scale');
assert.ok(triangles < 100000, 'high fidelity geometry budget');
assert.ok(file.length < 15 * 1024 * 1024, 'self-contained asset under 15 MiB');
console.log(`ok - warlock GLB: ${triangles} triangles, 22 bones, 5 seamless/one-shot clips, pulsing orb, ${(maxY - minY).toFixed(3)} units tall`);
