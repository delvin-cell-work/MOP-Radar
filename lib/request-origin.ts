/** Host and origin of an API request as the visitor saw it (Vercel sets the forwarded headers). */

function requestHost(request: Request): string {
  return request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
}

export function requestOrigin(request: Request): string {
  const protocol = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return `${protocol}://${requestHost(request)}`;
}

/** Browsers send Origin on cross-site POSTs; reject those. Requests without Origin (curl, tests) pass. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === requestHost(request);
  } catch {
    return false;
  }
}
