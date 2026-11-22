import { readFile, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(root, '.env');
try {
  await access(target);
  console.error('Đã có .env. Giữ nguyên tệp hiện tại; không tự ghi đè khóa mã hóa.');
  process.exitCode = 1;
} catch {
  const password = randomBytes(32).toString('hex');
  const key = randomBytes(32).toString('base64');
  const template = await readFile(join(root, '.env.example'), 'utf8');
  const content = template.replace('POSTGRES_PASSWORD=\n', `POSTGRES_PASSWORD=${password}\n`)
    .replace('TOKEN_ENCRYPTION_KEY=\n', `TOKEN_ENCRYPTION_KEY=${key}\n`)
    .replace('v9:CHANGE_ME@localhost', `v9:${password}@localhost`);
  await writeFile(target, content, { mode: 0o600, flag: 'wx' });
  console.log('Đã tạo .env với mật khẩu DB và khóa mã hóa ngẫu nhiên.');
  console.log('Mở .env trên máy chủ để điền tên miền, App ID, App Secret và Login Config ID.');
  console.log('Giữ bản sao an toàn của .env. Không đưa .env lên GitHub hoặc gửi vào chat.');
}
