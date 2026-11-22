import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  META_APP_ID: z.string().regex(/^\d*$/).default(''),
  META_APP_SECRET: z.string().default(''),
  META_LOGIN_CONFIG_ID: z.string().regex(/^\d*$/).default(''),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.0$/).default('v27.0'),
  // Request commenting permissions only when the operator enables that feature.
  META_ENABLE_COMMENTS: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  TOKEN_ENCRYPTION_KEY: z.string().refine(v => Buffer.from(v, 'base64').length === 32, 'TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
  PAGE_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3600).default(15),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7)
});
export type Config = z.infer<typeof envSchema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = envSchema.parse(env);
  const u = new URL(c.PUBLIC_BASE_URL);
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) throw new Error('PUBLIC_BASE_URL must be the origin, without a path, credentials, query, or fragment.');
  if (c.NODE_ENV === 'production' && u.protocol !== 'https:') throw new Error('Production PUBLIC_BASE_URL must use HTTPS.');
  if (!['https:', 'http:'].includes(u.protocol)) throw new Error('Unsupported public URL protocol.');
  if (u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) throw new Error('HTTP is allowed only for local development.');
  c.PUBLIC_BASE_URL = u.origin;
  return c;
}
export const META_SCOPES = ['public_profile', 'pages_show_list', 'pages_read_engagement', 'pages_manage_posts'];
export const META_COMMENT_SCOPES = ['pages_read_user_content', 'pages_manage_engagement'];
export function loginConfigured(c: Config): boolean { return Boolean(c.META_APP_ID && c.META_APP_SECRET); }
