import { Suspense } from 'react';
import { RegisterForm } from '@/components/auth/register-form';

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
