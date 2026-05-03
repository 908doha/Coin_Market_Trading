import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

export function getUserId(req: any): string | null {
  if (!JWT_SECRET) return null;
  const auth = (req.headers?.authorization ?? req.headers?.Authorization ?? '') as string;
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    const id = payload.user_id ?? payload.id ?? payload.sub;
    return id != null ? String(id) : null;
  } catch {
    return null;
  }
}

export function setCors(res: any, methods = 'GET,POST,OPTIONS') {
  const origin = process.env.FRONTEND_URL ?? '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  if (origin !== '*') res.setHeader('Vary', 'Origin');
}
