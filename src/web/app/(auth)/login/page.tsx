import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/login-form';

// Rendered on demand for the CSP nonce; see middleware.ts for why.
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
