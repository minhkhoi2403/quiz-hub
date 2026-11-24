// Sends only a minimal synthetic request, never prints the credential or user files.
const key = process.env.OPENAI_API_KEY;
if (!key) { console.log('OPENAI_API_KEY is missing.'); process.exit(1); }
try {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', store: false, input: 'Reply with OK.', max_output_tokens: 16 })
  });
  const data = await response.json();
  const redact = s => String(s || '').split(key).join('[REDACTED]').replace(/sk-[\w*-]+/g, '[REDACTED]');
  console.log(JSON.stringify({ status: response.status, code: redact(data.error?.code), type: redact(data.error?.type), message: redact(data.error?.message), completed: data.status === 'completed' }));
} catch (error) { console.log(JSON.stringify({ connectionError: error.cause?.code || error.name })); process.exitCode = 1; }
