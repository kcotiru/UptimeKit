// Single source for both Content-Security-Policy variants, so the static header
// in next.config.js and the per-request nonce header in middleware cannot drift.
//
// Plain JavaScript on purpose: next.config.js is loaded by Node, which cannot
// require a TypeScript module on every supported Node version. The JSDoc below
// is what middleware.ts type checks against.

/**
 * Builds a CSP header value.
 *
 * Why CSP carries the weight here: @supabase/ssr sets httpOnly false by design,
 * because the browser client has to read the refresh token. The session token is
 * therefore readable by page JavaScript, which makes this policy the primary
 * control against an XSS turning into session theft.
 *
 * @param {string} [nonce] Per-request nonce. Omit for the static variant.
 * @returns {string} The header value.
 */
function buildCsp(nonce) {
  // The browser Supabase client talks to the project origin directly for all
  // auth, so connect-src 'self' on its own breaks sign-in. Throwing rather than
  // omitting it: a policy built without this is syntactically valid and blocks
  // every auth call, and NEXT_PUBLIC_* is inlined at build time, so the damage
  // would be baked into the bundle with no signal anywhere. The app is already
  // unusable without this variable, so failing the build is strictly better than
  // failing in someone's browser.
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabase) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL is required to build the Content-Security-Policy: ' +
        "without it connect-src would be 'self' only and every Supabase auth call " +
        'would be blocked in the browser.'
    );
  }

  // With a nonce: 'strict-dynamic' lets a nonced bootstrap script load the rest
  // of the chunks, and browsers ignore 'unsafe-inline' entirely once a nonce is
  // present, so it is left out rather than kept as a fallback.
  //
  // Without a nonce: WEAKER, deliberately and knowingly. Next injects inline
  // bootstrap scripts, and a static page has no request to carry a nonce, so
  // the only alternative to 'unsafe-inline' is making the page dynamic. This
  // variant is defensible only where it is used: '/' renders no session and no
  // user-controlled data, and middleware redirects signed-in visitors away from
  // it, so an injected script there has nothing to steal. Do not call it strict
  // and do not move it onto a page that renders a session.
  //
  // 'unsafe-eval' is a DEVELOPMENT-ONLY concession. `next dev` uses webpack's
  // eval-based source maps and React Refresh, both of which need eval, so
  // without it no page hydrates locally. Production bundles use neither, and
  // NODE_ENV is 'production' for `next build` and `next start`, so the shipped
  // policy never carries it. This is what Next's own CSP guide does.
  const evalSrc = process.env.NODE_ENV !== 'production' ? " 'unsafe-eval'" : '';
  const scriptSrc =
    (nonce ? `'nonce-${nonce}' 'strict-dynamic'` : "'self' 'unsafe-inline'") + evalSrc;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Recharts emits inline styles, and the share page, the chart components and
    // opengraph-image.tsx use inline style attributes. A style-src concession
    // only: it must never bleed into script-src.
    "style-src 'self' 'unsafe-inline'",
    // blob: covers canvas work in the chart tree; no remote image host is used.
    "img-src 'self' data: blob:",
    // next/font/google self-hosts at build time, so no font is fetched cross origin.
    "font-src 'self'",
    `connect-src 'self' ${supabase}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // OWASP treats frame-ancestors as obsoleting X-Frame-Options, so that
    // header is deliberately absent rather than forgotten.
    "frame-ancestors 'none'",
  ].join('; ');
}

module.exports = { buildCsp };
