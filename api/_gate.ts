import crypto from 'crypto';

export function gateSign(
  apiSecret: string, method: string, path: string,
  query: string, ts: string,
): string {
  const bodyHash = crypto.createHash('sha512').update('').digest('hex');
  return crypto.createHmac('sha512', apiSecret)
    .update(`${method}\n${path}\n${query}\n${bodyHash}\n${ts}`)
    .digest('hex');
}

export async function gateGet(
  apiKey: string, apiSecret: string,
  path: string, query: string,
): Promise<any> {
  const method = 'GET';
  const ts  = Math.floor(Date.now() / 1000).toString();
  const sig = gateSign(apiSecret, method, path, query, ts);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(`https://api.gateio.ws${path}${query ? '?' + query : ''}`, {
      method,
      headers: { KEY: apiKey, Timestamp: ts, SIGN: sig, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Gate.io ${path}: ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}
