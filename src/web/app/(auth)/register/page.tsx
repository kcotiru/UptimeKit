import { Suspense } from 'react';
import { RegisterForm } from '@/components/auth/register-form';

// Rendered on demand so the per-request CSP nonce from middleware reaches the
// HTML: Next stamps the nonce onto its script tags during server rendering,
// which a prerender has no request to supply. Costs a prerender, buys this page
// a nonce policy instead of the weaker unsafe-inline one. It handles
// credentials, so that is the right way round.
export const dynamic = 'force-dynamic';

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* RegisterForm reads the ?invite param, so it can't be prerendered. */}
      <Suspense>
        <RegisterForm />
      </Suspense>
    </div>
  );
}
