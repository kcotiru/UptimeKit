import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'UptimeKit Dashboard | High-Precision Health & Metric Monitoring',
  description: 'Enterprise HTTP monitor management and time-series performance analytics dashboard.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${inter.variable}`}>
      <body className="min-h-screen bg-background text-slate-100 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
