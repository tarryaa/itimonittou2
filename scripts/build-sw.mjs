import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve('dist');
async function walk(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? walk(path.join(folder, entry.name)) : path.join(folder, entry.name)));
  return nested.flat();
}
const files = (await walk(root)).filter(file => path.basename(file) !== 'sw.js').sort();
const hash = createHash('sha256');
for (const file of files) {
  hash.update(path.relative(root, file));
  hash.update(await readFile(file));
}
const version = hash.digest('hex').slice(0, 20);
const precache = files.map(file => './' + path.relative(root, file).split(path.sep).join('/'));
const source = await readFile('public/sw.js', 'utf8');
await writeFile(path.join(root, 'sw.js'), source.replace('__CACHE_VERSION__', version).replace(/\/\*__PRECACHE__\*\/ \[.*?\]/, JSON.stringify(precache)));
console.log(`Service Worker ${version}: ${precache.length} files precached`);
