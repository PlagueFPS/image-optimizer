import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const sharp = createRequire(path.resolve(process.argv[2], 'package.json'))('sharp');
const report = JSON.parse(await readFile(process.argv[3], 'utf8'));
const images = [];
for (const record of report.records) {
  for (const image of record.verification.images) {
    const metadata = await sharp(image.file).metadata();
    const retained = ['icc', 'exif', 'xmp', 'iptc'].filter(key => metadata[key]?.length);
    images.push({ file: image.file, retained });
    if (retained.length) throw Error(`${image.file}: retained ${retained}`);
  }
}
console.log(JSON.stringify({ count: images.length, failures: 0, images }, null, 2));
