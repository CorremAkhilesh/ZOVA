import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { Logo } from '@/components/common/Logo';

/** The centered glass card shared by the email, code and name steps. */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex h-full items-center justify-center overflow-y-auto p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
        className="glass w-full max-w-md rounded-3xl border p-8 shadow-lg"
      >
        <Logo withName />
        <h1 className="mt-8 text-3xl font-bold tracking-tight">{title}</h1>
        {subtitle ? <div className="mt-2 text-text-muted">{subtitle}</div> : null}
        <div className="mt-8">{children}</div>
      </motion.div>
    </main>
  );
}

export function FormError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="text-sm font-medium text-danger">
      {children}
    </p>
  );
}
