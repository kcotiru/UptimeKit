import { Suspense } from 'react';
import { RegisterForm } from '@/components/auth/register-form';

// Rendered on demand for the CSP nonce; see middleware.ts for why.
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
