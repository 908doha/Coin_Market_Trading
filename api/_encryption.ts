import crypto from 'crypto';

function getKey(): Buffer {
  const secret = process.env.ACCOUNTS_ENCRYPTION_KEY;
  if (!secret) throw new Error('ACCOUNTS_ENCRYPTION_KEY is required');
  return crypto.scryptSync(secret, 'accounts_salt_v1', 32);
}

export function encrypt(plain: string): string {
  const key = getKey();
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), enc.toString('hex'), tag.toString('hex')].join(':');
}

export function decrypt(encoded: string): string {
  const parts = encoded.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted data format');
  const [ivHex, encHex, tagHex] = parts;
  const key = getKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(encHex, 'hex')).toString('utf8') + decipher.final('utf8');
}
