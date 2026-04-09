"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function SidebarLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<string>('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const email = session.user.email || '';
        const displayName = session.user.user_metadata?.full_name || session.user.user_metadata?.name || (email ? email.split('@')[0] : 'ผู้ใช้');
        setCurrentUser(displayName);
      }
    });
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const navItems = [
    { name: 'หน้าหลัก', path: '/dashboard', icon: '📊' },
    { name: 'สั่งพิมพ์', path: '/orders', icon: '📝' },
    { name: 'จัดการสินค้า', path: '/products', icon: '📦' },
    { name: 'สต็อคกระดาษ', path: '/stock', icon: '📄' },
    { name: 'ประวัติการใช้งาน', path: '/logs', icon: '🕰️' },
  ];

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden text-slate-800">
      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-slate-800/50 z-40 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 transform transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex flex-col h-full">
          {/* Brand */}
          <div className="h-16 flex items-center px-6 border-b border-slate-100">
            <span className="text-xl mr-2">✨</span>
            <span className="text-lg font-bold bg-gradient-to-r from-sky-600 to-blue-600 bg-clip-text text-transparent">WorkTracker</span>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const isActive = pathname === item.path;
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium transition-colors ${
                    isActive 
                      ? 'bg-sky-50 text-sky-700' 
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span className="text-lg">{item.icon}</span>
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* User Section (Bottom Sidebar) */}
          <div className="p-4 border-t border-slate-100">
            <div className="flex items-center gap-3 px-3 py-2.5 bg-slate-50 rounded-lg">
              <div className="h-8 w-8 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center font-bold">
                {currentUser ? currentUser.charAt(0).toUpperCase() : 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-700 truncate">
                  {currentUser || 'กำลังโหลด...'}
                </p>
                <button 
                  onClick={handleLogout}
                  className="text-xs text-slate-500 hover:text-red-500 font-medium transition-colors text-left"
                >
                  ออกจากระบบ
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content wrapper */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:hidden shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xl">✨</span>
            <span className="text-lg font-bold text-slate-800">WorkTracker</span>
          </div>
          <button 
            onClick={() => setIsMobileMenuOpen(true)}
            className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 lg:p-8 max-w-7xl mx-auto pb-24">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
