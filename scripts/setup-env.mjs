import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function normalizeDomain(input) {
  const domain = String(input).trim().toLowerCase();
  const labels = domain.split('.');
  if (domain.length > 253 || labels.length < 2 || labels.some(label =>
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    !/^[a-z]{2,63}$/.test(labels.at(-1))) {
    throw new Error('Dùng tên miền đầy đủ, ví dụ studio.tenmiencuaban.vn; không thêm https://, cổng hoặc đường dẫn.');
  }
  return domain;
}

export async function createEnvironment(root = projectRoot, domainInput) {
  const domain = domainInput === undefined ? undefined : normalizeDomain(domainInput);
  const password = randomBytes(32).toString('hex');
  const key = randomBytes(32).toString('base64');
  const template = await readFile(join(root, '.env.example'), 'utf8');
  let content = template.replace(/^POSTGRES_PASSWORD=.*$/m, `POSTGRES_PASSWORD=${password}`)
    .replace(/^TOKEN_ENCRYPTION_KEY=.*$/m, `TOKEN_ENCRYPTION_KEY=${key}`)
    .replace('v9:CHANGE_ME@localhost', `v9:${password}@localhost`);
  if (domain) {
    content = content.replace(/^APP_DOMAIN=.*$/m, `APP_DOMAIN=${domain}`)
      .replace(/^PUBLIC_BASE_URL=.*$/m, `PUBLIC_BASE_URL=https://${domain}`);
  }
  try {
    // Exclusive creation also protects against two setup commands racing.
    await writeFile(join(root, '.env'), content, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Đã có .env. Giữ nguyên tệp hiện tại; không ghi đè khóa mã hóa.');
    throw new Error('Không tạo được .env. Kiểm tra quyền ghi tại thư mục dự án.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length > 3) throw new Error('Cách dùng: node scripts/setup-env.mjs [studio.tenmiencuaban.vn]');
    await createEnvironment(projectRoot, process.argv[2]);
    console.log('Đã tạo .env với mật khẩu DB và khóa mã hóa ngẫu nhiên.');
    console.log('Mở .env trên máy chủ để điền thông tin Meta và kiểm tra tên miền.');
    console.log('Lưu bản sao an toàn của .env. Không đưa .env lên GitHub hoặc gửi vào chat.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
