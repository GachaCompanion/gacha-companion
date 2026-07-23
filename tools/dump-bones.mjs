// Dumps all bone names for every cached HSR character.
// Usage: node tools/dump-bones.mjs
import fs from 'fs';
import path from 'path';
import os from 'os';

const hsr = path.join(os.homedir(), 'AppData/Roaming/gacha-companion/storage/live2d/hsr');
const STUB_TEXTURE = { getImage: () => ({ width: 2, height: 2 }), setFilters() {}, setWraps() {}, dispose() {} };

const core = await import('@esotericsoftware/spine-core');
const { TextureAtlas, AtlasAttachmentLoader, SkeletonBinary, Skeleton } = core;

const ids = fs.readdirSync(hsr).filter(d => fs.statSync(path.join(hsr, d)).isDirectory()).sort();

for (const id of ids) {
  const dir = path.join(hsr, id);
  const atlasFiles = fs.readdirSync(dir).filter(f => f.endsWith('.atlas'));
  const bases = atlasFiles.map(f => f.replace('.atlas', ''));

  try {
    for (const base of bases) {
      const atlasText = fs.readFileSync(path.join(dir, `${base}.atlas`), 'utf8');
      const atlas = new TextureAtlas(atlasText);
      for (const page of atlas.pages) page.texture = STUB_TEXTURE;
      for (const region of atlas.regions) region.texture = STUB_TEXTURE;

      const skelBuf = new Uint8Array(fs.readFileSync(path.join(dir, `${base}.skel`)));
      const skelData = new SkeletonBinary(new AtlasAttachmentLoader(atlas)).readSkeletonData(skelBuf);
      const skeleton = new Skeleton(skelData);
      skeleton.setToSetupPose();
      skeleton.updateWorldTransform();

      const boneNames = skelData.bones.map(b => b.name);
      console.log(`${id} (${base}): ${boneNames.join(', ')}`);
    }
  } catch (e) {
    console.log(`${id}: ERROR — ${e.message}`);
  }
}
