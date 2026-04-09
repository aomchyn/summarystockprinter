"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("กรุณากรอกอีเมลและรหัสผ่าน");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      router.push("/dashboard");
      router.refresh();
    } catch (error: any) {
      console.error("Login Error:", error);
      setError("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-md glass-panel p-8 sm:p-10 flex flex-col gap-8 animate-fade-in">
        <div className="text-center delay-100 animate-fade-in">
          <div className="text-5xl mb-4 bg-gradient-to-br from-sky-500 to-sky-700 inline-block text-transparent bg-clip-text">✨</div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">ยินดีต้อนรับกลับมา</h1>
          <p className="text-slate-500 text-sm mt-2">กรุณาเข้าสู่ระบบเพื่อบันทึกการทำงานของคุณ</p>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-6 delay-200 animate-fade-in">
          <div className="form-group mb-0">
            <label className="form-label" htmlFor="email">อีเมล (Email)</label>
            <input
              id="email"
              type="email"
              className="input-field"
              placeholder="กรอกอีเมลของคุณ"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="form-group mb-0">
            <label className="form-label" htmlFor="password">รหัสผ่าน (Password)</label>
            <input
              id="password"
              type="password"
              className="input-field"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <div className="text-red-600 bg-red-50 border border-red-200 p-3 rounded-lg text-sm text-center animate-fade-in">{error}</div>}

          <button
            type="submit"
            className="btn btn-primary w-full mt-2"
            disabled={loading}
          >
            {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </button>
        </form>
      </div>
    </main>
  );
}
