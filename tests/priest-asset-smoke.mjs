// Validate the exported priest contract without installing dependencies.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = readFileSync(new URL('../assets/models/priest.glb', import.meta.url));
assert.equal(file.readUInt32LE(0), 0x46546c67, 'GLB magic');
assert.equal(file.readUInt32LE(4), 2, 'glTF 2');
assert.equal(file.readUInt32LE(8), file.length, 'complete file');
const jsonLength = file.readUInt32LE(12);
const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
const binary = file.subarray(28 + jsonLength);
assert.equal(gltf.buffers.length, 1);
assert.equal(gltf.buffers[0].uri, undefined, 'self-contained binary');
assert.equal(gltf.skins.length, 1);
assert.equal(gltf.skins[0].joints.length, 20, 'body rig plus eye, staff and crystal bones');
for (const bone of ['eye.L', 'eye.R', 'hand.R', 'staff', 'crystal']) {
  assert.ok(gltf.nodes.some(n => n.name === bone), `${bone} bone exported`);
}
assert.equal(gltf.materials.length, 3, 'atlas plus the eye glow and staff crystal glow');
const atlas = gltf.materials.find(m => m.name.includes('baked 2K'));
assert.ok(atlas.pbrMetallicRoughness.baseColorTexture, 'baked base color');
assert.ok(atlas.pbrMetallicRoughness.metallicRoughnessTexture, 'baked roughness and metallic');
assert.ok(atlas.normalTexture, 'baked surface normals');
// The priest's calm eyes and the staff crystal are kept out of the atlas so their
// emission survives export, matching the fallback's magicBlue glow.
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
    // Idle, Walk and Attack all loop seamlessly; only Hit and Death play once and hold.
    if (!['Hit', 'Death'].includes(animation.name)) {
      const output = gltf.accessors[sampler.output];
      const first = floatSample(sampler.output, 0);
      const last = floatSample(sampler.output, output.count - 1);
      assert.ok(first.every((v, i) => Math.abs(v - last[i]) < .0001), `${animation.name} loops without a pose jump`);
    }
  }
}
const idle = gltf.animations.find(a => a.name === 'Idle');
function channelValues(animation, boneName, path) {
  const channel = animation.channels.find(c => gltf.nodes[c.target.node].name === boneName && c.target.path === path);
  assert.ok(channel, `${boneName} ${path} animates during ${animation.name}`);
  const output = animation.samplers[channel.sampler].output;
  return Array.from({ length: gltf.accessors[output].count }, (_, i) => floatSample(output, i));
}
// The crystal pulses by scale during Idle.
const crystalScales = channelValues(idle, 'crystal', 'scale');
assert.ok(crystalScales.some(v => Math.max(...v) > 1.05), 'crystal swells during its Idle pulse');
assert.ok(crystalScales.some(v => Math.max(...v) < 1.02), 'crystal settles back down between pulses');
// The free left hand lifts into a blessing gesture and returns during Idle.
const blessRotation = channelValues(idle, 'upper_arm.L', 'rotation');
const restPose = blessRotation[0];
assert.ok(blessRotation.some(q => q.some((v, i) => Math.abs(v - restPose[i]) > .05)), 'left arm lifts for the blessing gesture');
// The Attack clip raises the staff and flares the crystal.
const attack = gltf.animations.find(a => a.name === 'Attack');
const raise = channelValues(attack, 'upper_arm.R', 'rotation');
assert.ok(raise.some((q, i) => q.some((v, j) => Math.abs(v - raise[0][j]) > .2)), 'staff arm raises during Attack');
const flare = channelValues(attack, 'crystal', 'scale');
assert.ok(flare.some(v => Math.max(...v) > 1.1), 'halo crystal flares during Attack');
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
// The standing body (feet to mitre tip) is ~1.9 units; the tall staff and its halo,
// held above the head, push the mesh's own bounding height higher than that.
assert.ok(maxY > 1.9 && maxY < 2.4, 'tall gold staff and halo held above the mitre');
assert.ok(triangles < 100000, 'high fidelity geometry budget');
assert.ok(file.length < 15 * 1024 * 1024, 'self-contained asset under 15 MiB');
console.log(`ok - priest GLB: ${triangles} triangles, 20 bones, 5 clips (3 seamless loops, 2 one-shot), crystal pulse and blessing gesture, ${(maxY - minY).toFixed(3)} units tall including the staff`);
