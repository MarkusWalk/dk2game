// Validate the exported knight contract without installing dependencies.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = readFileSync(new URL('../assets/models/knight.glb', import.meta.url));
assert.equal(file.readUInt32LE(0), 0x46546c67, 'GLB magic');
assert.equal(file.readUInt32LE(4), 2, 'glTF 2');
assert.equal(file.readUInt32LE(8), file.length, 'complete file');
const jsonLength = file.readUInt32LE(12);
const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
const binary = file.subarray(28 + jsonLength);
assert.equal(gltf.buffers.length, 1);
assert.equal(gltf.buffers[0].uri, undefined, 'self-contained binary');
assert.equal(gltf.skins.length, 1);
assert.equal(gltf.skins[0].joints.length, 20, 'body rig plus plume, sword and shield bones');
// The plume trails the helm, and the two pieces of war gear are animated in their own
// right: the shield hitches up the forearm and the longsword swings from the fist.
for (const bone of ['head', 'plume', 'sword', 'shield', 'hand.R', 'forearm.L']) {
  assert.ok(gltf.nodes.some(n => n.name === bone), `${bone} bone exported`);
}
assert.equal(gltf.materials.length, 1, 'one baked atlas; the knight has nothing emissive');
const atlas = gltf.materials.find(m => m.name.includes('baked 2K'));
assert.ok(atlas, 'baked atlas material');
assert.ok(atlas.pbrMetallicRoughness.baseColorTexture, 'baked base color');
assert.ok(atlas.pbrMetallicRoughness.metallicRoughnessTexture, 'baked roughness and metallic');
assert.ok(atlas.normalTexture, 'baked surface normals');
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
function moves(animation, bone, path, threshold) {
  const channel = animation.channels.find(c => gltf.nodes[c.target.node].name === bone && c.target.path === path);
  assert.ok(channel, `${animation.name} drives ${bone} ${path}`);
  const output = animation.samplers[channel.sampler].output;
  const first = floatSample(output, 0);
  return Array.from({ length: gltf.accessors[output].count }, (_, i) => floatSample(output, i))
    .some(v => v.some((c, i) => Math.abs(c - first[i]) > threshold));
}
// The idle has to breathe rather than freeze: the helm sweeps the room, the plume
// trails it a beat later, and the shield is hitched back up the arm twice.
const idle = gltf.animations.find(a => a.name === 'Idle');
for (const bone of ['head', 'plume', 'shield', 'chest']) {
  assert.ok(moves(idle, bone, 'rotation', .004), `${bone} is alive during Idle`);
}
// The attack is a real sword swing, not a wrist flick, and the shield steps with it.
const attack = gltf.animations.find(a => a.name === 'Attack');
assert.ok(moves(attack, 'upper_arm.R', 'rotation', .30), 'the sword arm winds up and chops');
assert.ok(moves(attack, 'shield', 'rotation', .02), 'the shield is brought across during Attack');
// Hit and Death are one-shots that must actually end somewhere other than they started.
for (const name of ['Hit', 'Death']) {
  const clip = gltf.animations.find(a => a.name === name);
  const channel = clip.channels.find(c => gltf.nodes[c.target.node].name === 'chest' && c.target.path === 'rotation');
  const output = clip.samplers[channel.sampler].output;
  const first = floatSample(output, 0);
  const middle = floatSample(output, Math.floor(gltf.accessors[output].count / 2));
  assert.ok(first.some((v, i) => Math.abs(v - middle[i]) > .02), `${name} displaces the torso`);
}
const death = gltf.animations.find(a => a.name === 'Death');
const root = death.channels.find(c => gltf.nodes[c.target.node].name === 'root' && c.target.path === 'translation');
const rootOut = death.samplers[root.sampler].output;
const dropped = Array.from({ length: gltf.accessors[rootOut].count }, (_, i) => floatSample(rootOut, i));
assert.ok(Math.min(...dropped.map(v => v[1])) < -.15, 'the knight actually goes down in Death');
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
assert.ok(Math.abs(minY) < .02, 'sabatons at ground');
// The champion stands a head taller than the other heroes; the plume tip is the top.
assert.ok(maxY > 1.85 && maxY < 2.05, 'tall armoured champion with the plume tip on top');
assert.ok(triangles > 60000, 'sculpted at the pipeline fidelity, not a low-poly stand-in');
assert.ok(triangles < 100000, 'high fidelity geometry budget');
assert.ok(file.length < 15 * 1024 * 1024, 'self-contained asset under 15 MiB');
console.log(`ok - knight GLB: ${triangles} triangles, 20 bones, 5 clips (3 seamless loops, 2 one-shot), plume trail, shield hitch and sword swing, ${(maxY - minY).toFixed(3)} units tall to the plume tip`);
