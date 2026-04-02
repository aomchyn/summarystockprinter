"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface AuditLog {
  id: string;
  created_at: string;
  user_email: string | null;
  action: string;
  module: string;
  description: string;
  metadata: Record<string, any> | null;
}

export default function LogsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<string>('');
  
  // Filters
  const [filterModule, setFilterModule] = useState<string>('all');
  const [filterAction, setFilterAction] = useState<string>('all');

  useEffect(() => {
    fetchLogs();
    
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const email = session.user.email || '';
        const displayName =
          session.user.user_metadata?.full_name ||
          session.user.user_metadata?.name ||
          (email ? email.split('@')[0] : 'ผู้ใช้');
        setCurrentUser(displayName);
      }
    });

    // Optional: Real-time subscription to logs
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'audit_logs',
        },
        (payload) => {
          setLogs((currentLogs) => [payload.new as AuditLog, ...currentLogs]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100); // Limit to recent 100 logs for performance

      if (error) throw error;
      setLogs(data || []);
    } catch (err: any) {
      console.error('Error fetching logs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const formatDate = (isoString: string) => {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(d);
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'CREATE': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
      case 'UPDATE': return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'DELETE': return 'text-red-400 bg-red-500/10 border-red-500/30';
      case 'EXPORT': return 'text-sky-400 bg-sky-500/10 border-sky-500/30';
      default: return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
    }
  };

  const getModuleLabel = (module: string) => {
    switch (module) {
      case 'orders': return 'สั่งพิมพ์';
      case 'stock': return 'สต็อคกระดาษ';
      case 'products': return 'สินค้า';
      case 'dashboard': return 'หน้าหลัก (Dashboard)';
      default: return module;
    }
  };

  const filteredLogs = logs.filter(log => {
      const matchModule = filterModule === 'all' || log.module === filterModule;
      const matchAction = filterAction === 'all' || log.action === filterAction;
      return matchModule && matchAction;
  });

  return (
    <div className="dashboard-container animate-fade-in min-h-screen">
      {/* Header */}
      <header className="dashboard-header glass-panel sticky top-0 z-50">
        <div className="header-content container mx-auto flex items-center justify-between h-16">
          <div className="brand flex items-center gap-2">
            <span className="logo-icon text-xl">📋</span>
            <span className="brand-name font-bold">WorkTracker</span>
          </div>

          <nav className="main-nav flex gap-6 text-sm font-medium">
            <Link href="/dashboard" className="nav-link">หน้าหลัก</Link>
            <Link href="/products" className="nav-link">จัดการสินค้า</Link>
            <Link href="/orders" className="nav-link">สั่งพิมพ์</Link>
            <Link href="/stock" className="nav-link">สต็อคกระดาษ</Link>
            <Link href="/logs" className="nav-link active text-accent-primary">ประวัติการใช้งาน</Link>
          </nav>

          <div className="user-section flex items-center gap-4">
            <span className="user-name text-sm">สวัสดี, {currentUser || 'ผู้ใช้'}</span>
            <button onClick={handleLogout} className="btn btn-outline btn-sm px-4 py-1.5 rounded-full border border-slate-600 text-slate-300 hover:bg-slate-800">
              ออกจากระบบ
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 dashboard-main">
        <div className="page-title glass-panel mb-6 p-6 rounded-2xl border border-white/5 bg-slate-900/40">
          <h1 className="text-2xl font-bold text-white">ประวัติการใช้งานระบบ (Audit Logs)</h1>
          <p className="text-slate-400 mt-2 text-sm">บันทึกการทำรายการทั้งหมดในระบบ (แสดง 100 รายการล่าสุด)</p>
        </div>

        <div className="glass-panel p-6 rounded-2xl border border-white/5 bg-slate-900/40">
            {/* Filters */}
            <div className="flex flex-wrap gap-4 mb-6">
                <div className="form-group flex-1 min-w-[200px]">
                    <label className="text-xs text-slate-400 mb-1 block">กรองตามส่วนงาน</label>
                    <select 
                        className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg p-2.5 focus:border-accent-primary outline-none cursor-pointer"
                        value={filterModule}
                        onChange={(e) => setFilterModule(e.target.value)}
                    >
                        <option value="all">ทั้งหมด</option>
                        <option value="orders">สั่งพิมพ์</option>
                        <option value="stock">สต็อคกระดาษ</option>
                        <option value="products">จัดการสินค้า</option>
                        <option value="dashboard">หน้ารวม (Dashboard)</option>
                    </select>
                </div>
                <div className="form-group flex-1 min-w-[200px]">
                    <label className="text-xs text-slate-400 mb-1 block">กรองตามประเภทการกระทำ</label>
                    <select 
                        className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg p-2.5 focus:border-accent-primary outline-none cursor-pointer"
                        value={filterAction}
                        onChange={(e) => setFilterAction(e.target.value)}
                    >
                        <option value="all">ทั้งหมด</option>
                        <option value="CREATE">เพิ่มข้อมูล (CREATE)</option>
                        <option value="UPDATE">แก้ไขข้อมูล (UPDATE)</option>
                        <option value="DELETE">ลบข้อมูล (DELETE)</option>
                        <option value="EXPORT">ส่งออกข้อมูล (EXPORT)</option>
                    </select>
                </div>
            </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-800/80 text-slate-300">
                <tr>
                  <th className="px-4 py-3 font-medium w-48">วัน-เวลา</th>
                  <th className="px-4 py-3 font-medium w-48">ผู้ใช้งาน</th>
                  <th className="px-4 py-3 font-medium w-32">การกระทำ</th>
                  <th className="px-4 py-3 font-medium w-32">ส่วนงาน</th>
                  <th className="px-4 py-3 font-medium">รายละเอียด</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                      กำลังโหลดประวัติการใช้งาน...
                    </td>
                  </tr>
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                      ไม่พบประวัติการใช้งานที่ตรงกับเงื่อนไข
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {formatDate(log.created_at)}
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {log.user_email?.split('@')[0] || 'Unknown'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded border text-[10px] font-bold tracking-wider ${getActionColor(log.action)}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {getModuleLabel(log.module)}
                      </td>
                      <td className="px-4 py-3 text-slate-200">
                        <div className="font-medium">{log.description}</div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
