import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomToken(bytes = 32): string { return randomBytes(bytes).toString('base64url'); }
export function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
function keyBytes(key: string): Buffer {
  const bytes = Buffer.from(key, 'base64');
  if (bytes.length !== 32) throw new Error('Encryption key must encode 32 bytes.');
  return bytes;
}
export function encryptToken(value: string, key: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
export function decryptToken(envelope: string, key: string, context: string): string {
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Unsupported token envelope.');
  const iv = Buffer.from(parts[1]!, 'base64url');
  const tag = Buffer.from(parts[2]!, 'base64url');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid token envelope.');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), iv);
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(parts[3]!, 'base64url')), decipher.final()]).toString('utf8');
}
export function makeAppSecretProof(token: string, secret: string): string { return createHmac('sha256', secret).update(token).digest('hex'); }
export function verifySignedRequest(signed: string, appSecret: string, nowSeconds = Math.floor(Date.now() / 1000)): { user_id: string; issued_at: number; [key: string]: unknown } {
  if (signed.length > 20_000) throw new Error('Invalid signed request.');
  const parts = signed.split('.');
  if (parts.length !== 2 || !parts.every(v => /^[A-Za-z0-9_-]+$/.test(v))) throw new Error('Invalid signed request.');
  const signature = Buffer.from(parts[0]!, 'base64url');
  const expected = createHmac('sha256', appSecret).update(parts[1]!).digest();
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new Error('Invalid signed request.');
  const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
  if (payload?.algorithm !== 'HMAC-SHA256' || typeof payload.user_id !== 'string' || !/^\d{1,64}$/.test(payload.user_id) ||
      !Number.isSafeInteger(payload.issued_at) || payload.issued_at > nowSeconds + 300 || payload.issued_at < nowSeconds - 7 * 86400) throw new Error('Invalid signed request.');
  return payload;
}
