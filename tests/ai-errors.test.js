import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiErrorMessage, generateQuiz } from '../server/ai.js';

test('OpenAI errors distinguish credentials, model, quota and throttling', () => {
  assert.match(apiErrorMessage(401, { code: 'invalid_api_key' }), /invalid_api_key/);
  assert.match(apiErrorMessage(403), /quyền truy cập/);
  assert.match(apiErrorMessage(404, { code: 'model_not_found' }), /Model/);
  assert.match(apiErrorMessage(429, { code: 'insufficient_quota' }), /số dư/);
  assert.match(apiErrorMessage(429, { code: 'credit_balance_exhausted' }), /số dư/);
  assert.match(apiErrorMessage(429, { code: 'project_spend_limit_exceeded' }), /chi tiêu/);
  assert.match(apiErrorMessage(429, { code: 'rate_limit_exceeded' }), /tốc độ/);
  assert.match(apiErrorMessage(500), /quá tải/);
});

test('failed generation reports actionable error without disclosing upstream secrets', async () => {
  const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only-secret';
  try {
    for (const invalidJson of [false, true]) {
      await assert.rejects(generateQuiz({ prompt: 'test', count: 1, images: [], fetcher: async () => ({
        ok: false, status: 401,
        json: async () => { if (invalidJson) throw new Error('HTML response'); return { error: { code: 'invalid_api_key', message: 'Incorrect key: test-only-secret' } }; }
      }) }), error => {
        assert.equal(error.status, 502);
        assert.match(error.message, /401/);
        assert.ok(!error.message.includes('test-only-secret'));
        return true;
      });
    }
  } finally { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; }
});
