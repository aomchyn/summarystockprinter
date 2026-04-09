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
      case 'CREATE': return 'text-emerald-700 bg-emerald-50 border-emerald-200';
      case 'UPDATE': return 'text-amber-700 bg-amber-50 border-amber-200';
      case 'DELETE': return 'text-red-700 bg-red-50 border-red-200';
      case 'EXPORT': return 'text-sky-700 bg-sky-50 border-sky-200';
      default: return 'text-slate-700 bg-slate-50 border-slate-200';
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
    <div className="animate-fade-in">
      <div className="w-full max-w-6xl mx-auto flex flex-col gap-6">
        <div className="glass-panel p-6 text-center delay-100 animate-fade-in">
          <h1 className="text-2xl font-bold text-slate-800 m-0">ประวัติการใช้งานระบบ (Audit Logs)</h1>
          <p className="text-slate-500 mt-2">บันทึกการทำรายการทั้งหมดในระบบ (แสดง 100 รายการล่าสุด)</p>
        </div>

        <div className="glass-panel p-6 rounded-xl border border-slate-200 bg-white">
            {/* Filters */}
            <div className="flex flex-wrap gap-4 mb-6">
                <div className="form-group flex-1 min-w-[200px] mb-0">
                    <label className="text-sm font-semibold text-slate-600 mb-2 block">กรองตามส่วนงาน</label>
                    <select 
                        className="input-field cursor-pointer"
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
                <div className="form-group flex-1 min-w-[200px] mb-0">
                    <label className="text-sm font-semibold text-slate-600 mb-2 block">กรองตามประเภท</label>
                    <select 
                        className="input-field cursor-pointer"
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
          <div className="table-container">
            <table className="table-main">
              <thead>
                <tr>
                  <th className="w-48">วัน-เวลา</th>
                  <th className="w-48">ผู้ใช้งาน</th>
                  <th className="w-32">การกระทำ</th>
                  <th className="w-48">ส่วนงาน</th>
                  <th>รายละเอียด</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-500">
                      กำลังโหลดประวัติการใช้งาน...
                    </td>
                  </tr>
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-500">
                      ไม่พบประวัติการใช้งานที่ตรงกับเงื่อนไข
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="text-slate-500">
                        {formatDate(log.created_at)}
                      </td>
                      <td className="font-medium text-slate-700">
                        {log.user_email?.split('@')[0] || 'Unknown'}
                      </td>
                      <td>
                        <span className={`px-2.5 py-1 rounded-md border text-xs font-bold tracking-wider ${getActionColor(log.action)}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="text-slate-600 font-medium">
                        {getModuleLabel(log.module)}
                      </td>
                      <td className="text-slate-800">
                        {log.description}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
