import { supabase } from './supabase';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'EXPORT';
export type AuditModule = 'orders' | 'stock' | 'products' | 'dashboard';

export async function logAction(
  action: AuditAction,
  module: AuditModule,
  description: string,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    await supabase.from('audit_logs').insert([{
      user_id: session?.user?.id ?? null,
      user_email: session?.user?.email ?? null,
      action,
      module,
      description,
      metadata: metadata ?? null,
    }]);
  } catch (err) {
    // Non-blocking — log errors to console only
    console.error('[auditLog] failed to write log:', err);
  }
}
