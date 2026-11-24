import { openDatabase } from './db.js';
import { createApp } from './app.js';
const db = await openDatabase();
const server = createApp(db).listen(Number(process.env.PORT || 3100), '0.0.0.0', () => console.log(`Quiz Hub: http://localhost:${process.env.PORT || 3100}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await db.close(); process.exit(0); }));
