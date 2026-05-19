"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  signature_url?: string;
  created_at: string;
  last_sign_in_at: string | null;
}

export default function UserManagement() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "user",
    signatureBase64: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    checkAdminAndFetchUsers();
  }, []);

  const checkAdminAndFetchUsers = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      router.push("/");
      return;
    }

    const email = session.user.email || '';
    const role = session.user.user_metadata?.role;
    const isAdmin = role === 'admin' || email === 'admin@summary.com';

    if (!isAdmin) {
      router.push("/dashboard");
      return;
    }

    fetchUsers();
  };

  const fetchUsers = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const response = await fetch("/api/users");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "เกิดข้อผิดพลาดในการโหลดข้อมูลผู้ใช้");
      }

      setUsers(data.users || []);
    } catch (err: any) {
      console.error("Error fetching users:", err);
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const openAddModal = () => {
    setEditingUser(null);
    setFormData({ name: "", email: "", password: "", role: "user", signatureBase64: "" });
    setIsModalOpen(true);
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setFormData({ name: user.name || "", email: user.email, password: "", role: user.role || "user", signatureBase64: "" });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== "image/png") {
        alert("กรุณาอัปโหลดไฟล์ PNG เท่านั้น");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setFormData({ ...formData, signatureBase64: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const method = editingUser ? "PUT" : "POST";
      const payload = {
        id: editingUser?.id,
        ...formData
      };

      const response = await fetch("/api/users", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "เกิดข้อผิดพลาดในการบันทึกข้อมูล");
      }

      await fetchUsers();
      closeModal();
    } catch (err: any) {
      alert("เกิดข้อผิดพลาด: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`คุณต้องการลบผู้ใช้ "${name}" ใช่หรือไม่?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/users?id=${id}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "เกิดข้อผิดพลาดในการลบข้อมูล");
      }

      await fetchUsers();
    } catch (err: any) {
      alert("เกิดข้อผิดพลาด: " + err.message);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="w-full max-w-5xl mx-auto flex flex-col gap-6">
        <div className="glass-panel p-6 flex justify-between items-center delay-100 animate-fade-in">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 m-0">จัดการผู้ใช้งาน</h1>
            <p className="text-slate-500 mt-1">เพิ่ม แก้ไข และลบผู้ใช้งานระบบทั้งหมด (เฉพาะผู้ดูแลระบบ)</p>
          </div>
          <button onClick={openAddModal} className="btn btn-primary flex items-center gap-2">
            <span className="text-lg">+</span> เพิ่มผู้ใช้
          </button>
        </div>

        <section className="glass-panel p-6 delay-200 animate-fade-in">
          {errorMsg && (
            <div className="p-3 mb-4 text-sm text-red-500 bg-red-900/20 border border-red-500/50 rounded-lg">
              {errorMsg}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-slate-700 text-xs uppercase border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 rounded-tl-lg">ชื่อ-สกุล</th>
                  <th className="px-4 py-3">อีเมล</th>
                  <th className="px-4 py-3">บทบาท</th>
                  <th className="px-4 py-3">ลายเซ็น</th>
                  <th className="px-4 py-3">ใช้งานล่าสุด</th>
                  <th className="px-4 py-3 text-right rounded-tr-lg">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      กำลังโหลดข้อมูลผู้ใช้...
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      ไม่พบผู้ใช้งาน
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800">{user.name || "-"}</td>
                      <td className="px-4 py-3">{user.email}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${user.role === 'admin' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-700'}`}>
                          {user.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้ทั่วไป'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {user.signature_url ? (
                          <img src={user.signature_url} alt="signature" className="h-8 object-contain" />
                        ) : (
                          <span className="text-slate-400 text-xs">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString("th-TH") : "ยังไม่เคยเข้าสู่ระบบ"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openEditModal(user)}
                          className="text-sky-600 hover:text-sky-800 p-1 mr-2"
                          title="แก้ไข"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => handleDelete(user.id, user.name || user.email)}
                          className="text-red-500 hover:text-red-700 p-1"
                          title="ลบ"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-800/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 animate-fade-in relative">
            <h2 className="text-xl font-bold text-slate-800 mb-4">
              {editingUser ? "แก้ไขผู้ใช้งาน" : "เพิ่มผู้ใช้งานใหม่"}
            </h2>
            <button onClick={closeModal} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
              ✕
            </button>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="form-group mb-0">
                <label className="form-label">ชื่อ-สกุล</label>
                <input
                  type="text"
                  required
                  className="input-field"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="กรอกชื่อ-สกุล"
                />
              </div>
              <div className="form-group mb-0">
                <label className="form-label">อีเมล</label>
                <input
                  type="email"
                  required
                  className="input-field"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="example@email.com"
                />
              </div>
              <div className="form-group mb-0">
                <label className="form-label">รหัสผ่าน {editingUser && "(เว้นว่างถ้าไม่ต้องการเปลี่ยน)"}</label>
                <input
                  type="password"
                  required={!editingUser}
                  minLength={6}
                  className="input-field"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="รหัสผ่านอย่างน้อย 6 ตัวอักษร"
                />
              </div>
              <div className="form-group mb-0">
                <label className="form-label">บทบาท (Role)</label>
                <select
                  className="input-field"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                >
                  <option value="user">ผู้ใช้ทั่วไป (User)</option>
                  <option value="admin">ผู้ดูแลระบบ (Admin)</option>
                </select>
              </div>

              <div className="form-group mb-0">
                <label className="form-label">ลายเซ็น (ไฟล์ PNG)</label>
                <input
                  type="file"
                  accept="image/png"
                  onChange={handleFileChange}
                  className="input-field py-2"
                />
                {(formData.signatureBase64 || editingUser?.signature_url) && (
                  <div className="mt-2 p-2 border border-slate-200 rounded bg-slate-50 inline-block">
                    <img
                      src={formData.signatureBase64 || editingUser?.signature_url}
                      alt="signature preview"
                      className="h-12 object-contain"
                    />
                  </div>
                )}
              </div>

              <div className="flex gap-3 mt-4">
                <button type="button" onClick={closeModal} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors flex-1">
                  ยกเลิก
                </button>
                <button type="submit" disabled={isSubmitting} className="btn btn-primary flex-1">
                  {isSubmitting ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
