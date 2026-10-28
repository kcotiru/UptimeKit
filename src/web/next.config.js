const { buildCsp } = require('./lib/shared/csp');

// The paths middleware gives a per-request nonce CSP to. They are excluded from
// the static policy below because two CSP headers both apply: the static one's
// 'unsafe-inline' would not loosen the nonce policy, it would only mislead
// whoever debugs a violation report next. Keep this in step with the middleware
// matcher, minus '/', which deliberately keeps the static policy.
//
// Each alternative carries its own boundary so a path that merely starts with
// one of these names, say /logintest, still gets a policy rather than none:
// middleware would not match it either, so nothing else would cover it.
const NONCE_PATHS = [
  'dashboard/',
  'dashboard$',
  'share/',
  'share$',
  'login$',
  'register$',
  'forgot-password$',
  'reset-password$',
].join('|');

// No Strict-Transport-Security: Vercel already sends max-age=63072000 on custom
// domains and two sources for one header is how it drifts.
// No X-Frame-Options: frame-ancestors 'none' in the CSP obsoletes it, per OWASP.
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** @type {import('next').NextConfig} */
module.exports = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      {
        // Everything middleware does not nonce: '/', /auth/callback and
        // /opengraph-image. Enforcing after a clean browser
        // pass over all of them; it shipped report-only until that pass.
        source: `/((?!${NONCE_PATHS}).*)`,
        headers: [{ key: 'Content-Security-Policy', value: buildCsp() }],
      },
    ];
  },
  // Future option, not this task: experimental.sri adds subresource integrity
  // hashes to Next's own script tags.
};
