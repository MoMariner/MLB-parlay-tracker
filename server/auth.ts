/**
 * Password gate.
 *
 * The tracker is meant to be reachable from a phone anywhere, which means it
 * sits on the open internet. A single shared password is the right weight for
 * this: it is one person's bet slips, not a multi-user product.
 *
 * Set APP_PASSWORD to switch it on. Left unset (local development) the app is
 * open, so nothing changes when running on your own machine.
 */

import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const COOKIE = 'mlb_session';
const MAX_AGE_DAYS = 30;

const password = process.env.APP_PASSWORD ?? '';
/**
 * Signing key. A generated fallback keeps things working without extra config,
 * at the cost of logging everyone out when the process restarts -- so a
 * deployment should set AUTH_SECRET explicitly.
 */
const secret = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');

export const authRequired = password.length > 0;

function sign(value: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

/** Token is "<expiry>.<hmac>", so it carries its own lifetime. */
function issueToken(): string {
  const expires = Date.now() + MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return `${expires}.${sign(String(expires))}`;
}

function tokenValid(token: string | undefined): boolean {
  if (!token) return false;
  const [expires, mac] = token.split('.');
  if (!expires || !mac) return false;
  if (Number(expires) < Date.now()) return false;

  const expected = sign(expires);
  // Both are same-length hex strings, so a timing-safe compare is meaningful.
  if (mac.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export function isAuthed(req: { headers: { cookie?: string } }): boolean {
  if (!authRequired) return true;
  return tokenValid(readCookie(req.headers.cookie, COOKIE));
}

/** Constant-time password check, so a wrong guess leaks nothing by timing. */
export function passwordMatches(attempt: unknown): boolean {
  if (typeof attempt !== 'string' || attempt.length === 0) return false;
  const a = crypto.createHash('sha256').update(attempt).digest();
  const b = crypto.createHash('sha256').update(password).digest();
  return crypto.timingSafeEqual(a, b);
}

export function setSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', [
    `${COOKIE}=${issueToken()}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE_DAYS * 24 * 60 * 60}`,
    ...(secure ? ['Secure'] : []),
  ].join('; '));
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

/** Guards the API. The SPA shell itself is public -- it only renders a login box. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Not authenticated', code: 'AUTH_REQUIRED' });
}
