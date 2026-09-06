// Validate the exported bile demon contract without installing dependencies.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = readFileSync(new URL('../assets/models/bile-demon.glb', import.meta.url));
assert.equal(file.readUInt32LE(0), 0x46546c67, 'GLB magic');
assert.equal(file.readUInt32LE(4), 2, 'glTF 2');
assert.equal(file.readUInt32LE(8), file.length, 'complete file');
const jsonLength = file.readUInt32LE(12);
const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
const binary = file.subarray(28 + jsonLength);
assert.equal(gltf.buffers.length, 1);
assert.equal(gltf.buffers[0].uri, undefined, 'self-contained binary');
assert.equal(gltf.skins.length, 1);
assert.equal(gltf.skins[0].joints.length, 19, 'body rig plus the gut bone and two blinking eye bones');
// 'belly' drives the gut jiggle; without it the demon is a rigid barrel.
for (const bone of ['belly', 'eye.L', 'eye.R', 'hand.L', 'hand.R', 'foot.L', 'foot.R']) {
  assert.ok(gltf.nodes.some(n => n.name === bone), `${bone} bone exported`);
}
assert.equal(gltf.materials.length, 3, 'atlas plus two eye materials');
const atlas = gltf.materials.find(m => m.name.includes('baked 2K'));
assert.ok(atlas.pbrMetallicRoughness.baseColorTexture, 'baked base color');
assert.ok(atlas.pbrMetallicRoughness.metallicRoughnessTexture, 'baked roughness and metallic');
assert.ok(atlas.normalTexture, 'baked surface normals');
// DK2 bile demons peer out of the brow shadow with two tiny red coals.
for (const eye of gltf.materials.filter(m => m !== atlas)) {
  const [r, g, b] = eye.emissiveFactor || [];
  assert.ok(eye.emissiveFactor && Math.max(r, g, b) > 0, `${eye.name} glows`);
  assert.ok(r > g && r > b, `${eye.name} glows red rather than the imp's amber`);
  assert.ok(eye.extensions?.KHR_materials_emissive_strength?.emissiveStrength > 1, `${eye.name} has HDR emission`);
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
function samples(animation, bone, path) {
  const channel = animation.channels.find(c => gltf.nodes[c.target.node].name === bone && c.target.path === path);
  if (!channel) return null;
  const output = animation.samplers[channel.sampler].output;
  return Array.from({ length: gltf.accessors[output].count }, (_, i) => floatSample(output, i));
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
const walk = gltf.animations.find(a => a.name === 'Walk');
// The gut has to heave in Idle and slosh in Walk; it is the whole silhouette.
for (const clip of [idle, walk]) {
  const gut = samples(clip, 'belly', 'scale');
  assert.ok(gut, `belly is scaled during ${clip.name}`);
  assert.ok(gut.some(s => s.some(v => Math.abs(v - 1) > .015)), `the gut swells during ${clip.name}`);
}
for (const eye of ['eye.L', 'eye.R']) {
  const scales = samples(idle, eye, 'scale');
  assert.ok(scales, `${eye} has blink animation`);
  assert.ok(scales.some(v => Math.min(...v) < .3), `${eye} closes during blink`);
  assert.ok(scales.some(v => Math.min(...v) > .99), `${eye} reopens`);
}
// Death topples the whole bulk onto its back rather than sinking it through the floor.
const topple = samples(gltf.animations.find(a => a.name === 'Death'), 'root', 'rotation');
assert.ok(topple, 'Death rotates the root');
assert.ok(topple.some(q => q.some((v, i) => Math.abs(v - topple[0][i]) > .4)), 'Death falls over');
let triangles = 0;
let minY = Infinity;
let maxY = -Infinity;
let minX = Infinity;
let maxX = -Infinity;
for (const mesh of gltf.meshes) {
  for (const primitive of mesh.primitives) {
    assert.equal(primitive.mode ?? 4, 4, 'triangulated');
    triangles += gltf.accessors[primitive.indices].count / 3;
    const positions = gltf.accessors[primitive.attributes.POSITION];
    minY = Math.min(minY, positions.min[1]);
    maxY = Math.max(maxY, positions.max[1]);
    minX = Math.min(minX, positions.min[0]);
    maxX = Math.max(maxX, positions.max[0]);
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
const height = maxY - minY;
const width = maxX - minX;
assert.ok(Math.abs(minY) < .02, 'feet at ground');
assert.ok(height > 1.65 && height < 1.85, 'bile demon scale, twice the imp and then some');
// Almost as wide as it is tall: the silhouette is the entire character.
assert.ok(width > 1.45, 'colossal shoulder-to-shoulder span');
assert.ok(width > height * .85, 'nearly as wide as it is tall');
assert.ok(triangles < 100000, 'high fidelity geometry budget');
assert.ok(file.length < 15 * 1024 * 1024, 'self-contained asset under 15 MiB');
console.log(`ok - bile demon GLB: ${triangles} triangles, 19 bones, 5 seamless/one-shot clips, `
  + `jiggling gut and glowing coal eyes, ${height.toFixed(3)} units tall by ${width.toFixed(3)} wide`);
