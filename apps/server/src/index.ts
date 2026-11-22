import { loadConfig } from './config.js';
import { makeDatabase } from './db.js';
import { buildApp } from './app.js';

const config = loadConfig();
const db = makeDatabase(config.DATABASE_URL);
const app = await buildApp({ config, db });
app.addHook('onClose', async () => { await db.end?.(); });
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { void app.close(); });
await app.listen({ port: config.PORT, host: '0.0.0.0' });
