import sharp from 'sharp';
import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
for (const directory of ['generated', 'flat', 'recursive']) await rm(path.join(root, directory), { recursive: true, force: true });
await mkdir(path.join(root, 'generated'), { recursive: true });
await mkdir(path.join(root, 'photos'), { recursive: true });
sharp.concurrency(1);
const width = 3000, height = 2000;
const pixels = Buffer.alloc(width * height * 4);
let seed = 123456789;
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  const offset = (y * width + x) * 4;
  pixels[offset] = (x / width * 180 + (seed >>> 0) % 76) & 255;
  pixels[offset + 1] = (y / height * 180 + (seed >>> 8) % 76) & 255;
  pixels[offset + 2] = ((x ^ y) + (seed >>> 16) % 40) & 255;
  pixels[offset + 3] = x < width / 3 ? Math.round(x / (width / 3) * 255) : 255;
}
const raw = () => sharp(pixels, { raw: { width, height, channels: 4 } });
await raw().flatten({ background: '#fff' }).jpeg({ quality: 92 }).toFile(path.join(root, 'generated/noise.jpg'));
await raw().png().toFile(path.join(root, 'generated/alpha.png'));
await raw().avif({ quality: 70, effort: 2 }).toFile(path.join(root, 'generated/translucent.avif'));
const shapes = Array.from({ length: 1500 }, (_, i) => `<circle cx="${i * 137 % width}" cy="${i * 173 % height}" r="${10 + i % 60}" fill="hsl(${i % 360},60%,50%)" opacity="0.7"/>`).join('');
await writeFile(path.join(root, 'generated/vector.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#123"/>${shapes}</svg>`);
const sources = [
  { name: 'earth.jpg', sha256: 'd4dc80a6ef571939d0abe04a9bed3d3d1e6cd63e59514be1c5e43a6b069e6f1e', url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57730/land_ocean_ice_2048.jpg',
    credit: 'NASA Visible Earth, Blue Marble. NASA imagery usage guidelines apply.',
    license: 'https://www.nasa.gov/nasa-brand-center/images-and-media/' },
  { name: 'astronaut.png', sha256: '88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5', url: 'https://raw.githubusercontent.com/scikit-image/scikit-image/v0.19.3/skimage/data/astronaut.png',
    credit: 'NASA photograph of Eileen Collins, distributed by scikit-image as public domain.',
    license: 'https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut' },
];
for (const source of sources) {
  const target = path.join(root, 'photos', source.name);
  try { await readFile(target); }
  catch {
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`${source.url}: ${response.status}`);
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
  }
  if (createHash('sha256').update(await readFile(target)).digest('hex') !== source.sha256) throw new Error(`Photo hash mismatch: ${target}`);
}
const fixtureNames = ['generated/noise.jpg', 'generated/alpha.png', 'generated/translucent.avif', 'generated/vector.svg', ...sources.map(s => `photos/${s.name}`)];
const manifest = { generator: 'fixtures.mjs xorshift32 seed=123456789, 3000x2000 RGBA', versions: sharp.versions, sources, files: [] };
for (const name of fixtureNames) {
  const bytes = await readFile(path.join(root, name));
  const metadata = await sharp(bytes).metadata();
  manifest.files.push({ path: name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    width: metadata.width, height: metadata.height, format: metadata.format });
  for (const directory of ['flat', 'recursive/nested']) {
    await mkdir(path.join(root, directory), { recursive: true });
    await copyFile(path.join(root, name), path.join(root, directory, path.basename(name)));
  }
}
await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
