import { ImageResponse } from 'next/og';

// ponytail: load-bearing. On the Node runtime, prerendering this route fails the
// build with `Invalid URL at fileURLToPath` inside @vercel/og (Next 14, Windows).
// Edge skips that prerender; `next start` serves it as 200 image/png. Remove
// once a Next/@vercel/og upgrade fixes the Node prerender.
export const runtime = 'edge';

export const size = { width: 1200, height: 630 };
export const alt = 'UptimeKit: know the moment it breaks';
export const contentType = 'image/png';

export default function Image(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#121212',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: 96,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <svg width="112" height="112" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="7" fill="#4f46e5" />
            <g transform="translate(6 6) scale(0.833)" fill="none" stroke="#a5b4fc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
            </g>
          </svg>
          <div style={{ marginLeft: 32, fontSize: 96, fontWeight: 700, color: '#f8fafc' }}>UptimeKit</div>
        </div>
        <div style={{ marginTop: 40, fontSize: 40, color: '#94a3b8' }}>
          Know the moment it breaks. And how slow it was before.
        </div>
      </div>
    ),
    size
  );
}
