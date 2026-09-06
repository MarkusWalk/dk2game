// Validate the exported troll contract without installing dependencies.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = readFileSync(new URL('../assets/models/troll.glb', import.meta.url));
assert.equal(file.readUInt32LE(0), 0x46546c67, 'GLB magic');
assert.equal(file.readUInt32LE(4), 2, 'glTF 2');
assert.equal(file.readUInt32LE(8), file.length, 'complete file');
const jsonLength = file.readUInt32LE(12);
const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
const binary = file.subarray(28 + jsonLength);
assert.equal(gltf.buffers.length, 1);
assert.equal(gltf.buffers[0].uri, undefined, 'self-contained binary');
assert.equal(gltf.skins.length, 1);
assert.equal(gltf.skins[0].joints.length, 22, 'body rig plus jaw, blinking eye bones and ear bones');
for (const bone of ['jaw', 'eye.L', 'eye.R', 'ear.L', 'ear.R', 'hand.R', 'foot.L']) {
  assert.ok(gltf.nodes.some(n => n.name === bone), `${bone} bone exported`);
}
assert.equal(gltf.materials.length, 2, 'atlas plus the amber eye material');
const atlas = gltf.materials.find(m => m.name.includes('baked 2K'));
assert.ok(atlas.pbrMetallicRoughness.baseColorTexture, 'baked base color');
assert.ok(atlas.pbrMetallicRoughness.metallicRoughnessTexture, 'baked roughness and metallic');
assert.ok(atlas.normalTexture, 'baked surface normals');
// The troll's eyes are dull amber embers, not the imp's lanterns: they emit, but
// the emission is kept below 1 so no KHR_materials_emissive_strength is needed.
const eyes = gltf.materials.find(m => m !== atlas);
assert.ok(eyes.emissiveFactor && Math.max(...eyes.emissiveFactor) > 0, `${eyes.name} glows`);
assert.ok(Math.max(...eyes.emissiveFactor) < 1, `${eyes.name} stays a low ember`);
assert.equal(gltf.images.length, 3, 'three embedded PBR maps');
for (const image of gltf.images) {
  assert.equal(image.uri, undefined, 'no external image dependencies');
  const view = gltf.bufferViews[image.bufferView];
  const png = binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
  assert.equal(png.readUInt32BE(16), 2048, '2K texture width');
  assert.equal(png.readUInt32BE(20), 2048, '2K texture height');
}
// Work is the blacksmith clip the game matches for the workshop room.
assert.deepEqual(gltf.animations.map(a => a.name).sort(), ['Attack', 'Death', 'Hit', 'Idle', 'Walk', 'Work']);
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
function moves(animation, bone, path, threshold) {
  const channel = animation.channels.find(c => gltf.nodes[c.target.node].name === bone && c.target.path === path);
  assert.ok(channel, `${bone} has ${path} keys in ${animation.name}`);
  const output = animation.samplers[channel.sampler].output;
  const first = floatSample(output, 0);
  const samples = Array.from({ length: gltf.accessors[output].count }, (_, i) => floatSample(output, i));
  assert.ok(samples.some(v => v.some((x, i) => Math.abs(x - first[i]) > threshold)),
    `${bone} actually moves in ${animation.name}`);
  return samples;
}
const clips = Object.fromEntries(gltf.animations.map(a => [a.name, a]));
// The forge blow: the hammer arm has to swing, and the jaw has to grunt with it.
moves(clips.Work, 'upper_arm.R', 'rotation', .05);
moves(clips.Work, 'jaw', 'rotation', .02);
// The overhead smash roars: the jaw opens much wider than during the work loop.
moves(clips.Attack, 'jaw', 'rotation', .10);
moves(clips.Walk, 'thigh.L', 'rotation', .05);
for (const ear of ['ear.L', 'ear.R']) moves(clips.Idle, ear, 'rotation', .02);
for (const eye of ['eye.L', 'eye.R']) {
  const scales = moves(clips.Idle, eye, 'scale', .05);
  assert.ok(scales.some(v => Math.min(...v) < .3), `${eye} closes during blink`);
  assert.ok(scales.some(v => Math.min(...v) > .99), `${eye} reopens`);
}
// Death is a one-shot that ends collapsed, and the eyes stay shut when it does.
const deathEye = clips.Death.channels.find(c => gltf.nodes[c.target.node].name === 'eye.L' && c.target.path === 'scale');
const deathScale = floatSample(clips.Death.samplers[deathEye.sampler].output,
  gltf.accessors[clips.Death.samplers[deathEye.sampler].output].count - 1);
assert.ok(Math.min(...deathScale) < .3, 'the troll dies with his eyes closed');
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
assert.ok(maxY > 1.65 && maxY < 1.85, 'hunched troll height before the 1.05 game scale');
assert.ok(triangles > 60000, 'sculpted rather than blocked out');
assert.ok(triangles < 100000, 'high fidelity geometry budget');
assert.ok(file.length < 15 * 1024 * 1024, 'self-contained asset under 15 MiB');
console.log(`ok - troll GLB: ${triangles} triangles, 22 bones, 6 seamless/one-shot clips including Work, ${(maxY - minY).toFixed(3)} units tall`);
