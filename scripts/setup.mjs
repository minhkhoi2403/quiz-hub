import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env')) console.log('.env already exists; keeping your configuration.');
else {
  writeFileSync('.env', readFileSync('.env.example', 'utf8').replace('replace-with-a-long-random-password', randomBytes(32).toString('hex')), { mode: 0o600 });
  console.log('Created .env with a random PostgreSQL password. Add OPENAI_API_KEY to enable AI.');
}
