/**
 * The check the middleware can run.
 *
 * Middleware executes on the edge runtime, where `node:crypto` is unavailable,
 * so this verifies the shape and the expiry only. The signature is checked
 * again in the route handlers and pages that actually read data — the middleware
 * is a redirect, not the security boundary.
 */
export function looksLikeSession(cookie: string | undefined): boolean {
  if (cookie === undefined) return false;

  const [expiresAt, signature] = cookie.split('.');
  if (expiresAt === undefined || signature === undefined || signature === '') return false;

  const expiry = Number(expiresAt);
  return Number.isFinite(expiry) && expiry > Date.now();
}
