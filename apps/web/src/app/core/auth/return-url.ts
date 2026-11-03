/**
 * Accepts only same-origin application paths as a post-login destination.
 * Protocol-relative and absolute URLs are rejected, and `/login` itself is
 * replaced to avoid a redirect loop.
 */
const FALLBACK_URL = '/plans';

export function sanitizeReturnUrl(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return FALLBACK_URL;
  }

  const candidate = value.trim();
  if (
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    candidate.includes('\\')
  ) {
    return FALLBACK_URL;
  }

  try {
    const parsed = new URL(candidate, 'http://probedesk.local');
    if (parsed.origin !== 'http://probedesk.local') {
      return FALLBACK_URL;
    }

    if (parsed.pathname.startsWith('//') || parsed.pathname.includes('\\')) {
      return FALLBACK_URL;
    }

    if (parsed.pathname === '/login') {
      return FALLBACK_URL;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return FALLBACK_URL;
  }
}
