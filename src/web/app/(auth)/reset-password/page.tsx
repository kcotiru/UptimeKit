import { ResetPasswordForm } from '@/components/auth/reset-password-form';

// Rendered on demand for the CSP nonce; see middleware.ts for why.
export const dynamic = 'force-dynamic';

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <ResetPasswordForm />
    </div>
  );
}
