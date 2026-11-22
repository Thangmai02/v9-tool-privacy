import { mkdir, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
await mkdir(join(root, 'public'), { recursive: true });
for (const file of ['privacy-policy.html', 'terms.html', 'data-deletion.html', 'style.css', 'logo.svg']) {
  await copyFile(join(root, file), join(root, 'public', file));
}
