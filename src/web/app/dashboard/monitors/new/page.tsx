import { Header } from '@/components/layout/header';
import { CreateMonitorForm } from '@/components/monitors/create-monitor-form';

export default function NewMonitorPage() {
  return (
    <div className="space-y-6">
      <Header title="Add New Monitor" subtitle="Configure new HTTP/HTTPS target health check" />
      <CreateMonitorForm />
    </div>
  );
}
