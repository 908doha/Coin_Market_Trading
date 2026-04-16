/**
 * JWT 유틸 — 외부 패키지 없이 Node.js 내장 crypto만 사용
 *
 * JWT_SIGNING_KEY 환경변수가 설정되어 있으면 HS256 서명 검증 (타이밍 안전).
 * 미설정 시 서명 검증 없이 payload 디코드 (경고 로그).
 */

import crypto from 'crypto';

const pad = (s: string) => s + '='.repeat((4 - (s.length % 4)) % 4);

function decodePayload(b64url: string): Record<string, any> | null {
  try {
    return JSON.parse(Buffer.from(pad(b64url), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Authorization 헤더에서 user_id / id / sub 를 꺼내 반환.
 * 토큰이 없거나 검증 실패 시 null.
 */
export function getUserIdFromRequest(req: any, label: string): string | null {
  try {
    const auth  = (req.headers?.authorization ?? req.headers?.Authorization ?? '') as string;
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const secret = process.env.JWT_SIGNING_KEY;

    if (secret) {
      // HS256 서명 검증 (타이밍 안전)
      const sigInput  = `${parts[0]}.${parts[1]}`;
      const expected  = crypto.createHmac('sha256', secret).update(sigInput).digest();
      const actual    = Buffer.from(parts[2], 'base64url');
      if (
        expected.length !== actual.length ||
        !crypto.timingSafeEqual(expected, actual)
      ) {
        return null;
      }
    } else {
      console.warn(`[${label}] JWT_SIGNING_KEY not set — skipping signature verification`);
    }

    const payload = decodePayload(parts[1]);
    if (!payload) return null;

    const id = payload.user_id ?? payload.id ?? payload.sub;
    return id != null ? String(id) : null;
  } catch {
    return null;
  }
}
