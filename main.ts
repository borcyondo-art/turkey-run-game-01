// SPDX-License-Identifier: MIT
// Hand-off program for the turkey-run-game-01 bounty: it copies the
// finished game and its screenshots into the output directory, then
// writes the dossier the scorer rebuilds from those same files.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

function copyTree(name) {
  const source = join(repoRoot, name);
  if (!existsSync(source)) {
    throw new Error(`missing ${name}/ next to main.ts`);
  }
  cpSync(source, join(outputDir, name), { recursive: true, dereference: false });
}

if (!existsSync(join(repoRoot, 'game', 'index.html'))) {
  throw new Error('missing game/index.html next to main.ts');
}

mkdirSync(outputDir, { recursive: true });
// Clear only the contents of the output directory, never the directory
// itself: the grader may run with a read-only parent directory, so
// removing outputDir and recreating it can fail, while removing the
// entries inside it always leaves a usable, empty directory behind.
for (const entry of readdirSync(outputDir)) {
  rmSync(join(outputDir, entry), { recursive: true, force: true });
}

copyTree('game');
copyTree('screenshots');

const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
// buildDossier returns the dossier bytes; write them as-is rather than
// stringifying them, falling back to text/JSON only for other shapes.
const dossierBytes =
  typeof dossier === 'string'
    ? Buffer.from(dossier)
    : dossier instanceof Uint8Array
      ? dossier
      : Buffer.from(JSON.stringify(dossier, null, 2));
writeFileSync(join(outputDir, 'dossier.json'), dossierBytes);
console.log(`wrote dossier.json (${dossierBytes.byteLength} bytes) to ${outputDir}`);
