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
    <main className="login-container">
      <div className="login-box glass-panel animate-fade-in">
        <div className="login-header delay-100 animate-fade-in">
          <div className="logo-icon">✨</div>
          <h1 className="text-gradient">ยินดีต้อนรับกลับมา</h1>
          <p className="text-muted text-sm mt-2">กรุณาเข้าสู่ระบบเพื่อบันทึกการทำงานของคุณ</p>
        </div>

        <form onSubmit={handleLogin} className="login-form delay-200 animate-fade-in">
          <div className="form-group">
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

          <div className="form-group">
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

          {error && <div className="error-message animate-fade-in">{error}</div>}

          <button
            type="submit"
            className="btn btn-primary w-full mt-4"
            disabled={loading}
          >
            {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </button>
        </form>
      </div>

      <style jsx>{`
        .login-container {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 24px;
        }

        .login-box {
          width: 100%;
          max-width: 420px;
          padding: 40px;
          display: flex;
          flex-direction: column;
          gap: 32px;
        }

        .login-header {
          text-align: center;
        }

        .logo-icon {
          font-size: 2.5rem;
          margin-bottom: 16px;
          display: inline-block;
          background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .login-header h1 {
          font-size: 1.75rem;
          font-weight: 600;
          letter-spacing: -0.02em;
        }

        .error-message {
          color: var(--error-color);
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          padding: 12px;
          border-radius: var(--radius-sm);
          font-size: 0.875rem;
          text-align: center;
          margin-top: 12px;
        }

        @media (max-width: 480px) {
          .login-box {
            padding: 32px 24px;
          }
        }
      `}</style>
    </main>
  );
}
