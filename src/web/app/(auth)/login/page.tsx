import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/login-form';

// Rendered on demand so the per-request CSP nonce from middleware reaches the
// HTML: Next stamps the nonce onto its script tags during server rendering,
// which a prerender has no request to supply. Costs a prerender, buys this page
// a nonce policy instead of the weaker unsafe-inline one. It handles
// credentials, so that is the right way round.
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* LoginForm reads the ?redirect param, so it can't be prerendered. */}
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
