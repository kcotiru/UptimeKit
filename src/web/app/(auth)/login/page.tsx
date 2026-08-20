import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/login-form';

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
