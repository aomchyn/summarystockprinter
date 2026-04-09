"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { logAction } from "@/lib/auditLog";


interface PaperTransaction {
    id: string;
    date: string;
    transaction_type: "IN" | "OUT";
    paper_type: string;
    qty: number;
    description: string;
    created_at: string;
    user_id?: string;
    user_email?: string; // We'll map this from auth
}

export const PAPER_TYPES = [
    "สติกเกอร์",
    "130 แกรม",
    "200 แกรม",
    "300 แกรม",
    "350 แกรม",
    "สติกเกอร์ PP"
];

export default function PaperStock() {
    const router = useRouter();
    const [transactions, setTransactions] = useState<PaperTransaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // To view stats by paper type
    const [selectedViewingType, setSelectedViewingType] = useState<string>("สติกเกอร์");

    const [formData, setFormData] = useState({
        paperType: "สติกเกอร์",
        qty: "",
        description: "",
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [currentUser, setCurrentUser] = useState<string>('');

    useEffect(() => {
        fetchTransactions();
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
    }, []);


    const fetchTransactions = async () => {
        setIsLoading(true);
        setErrorMsg(null);
        try {
            // First get transactions
            const { data, error } = await supabase
                .from('paper_transactions')
                .select('*')
                .order('date', { ascending: false })
                .order('created_at', { ascending: false });

            if (error) throw error;

            let formattedData = data || [];

            // Now, we need to fetch user emails for those who have user_ids
            // For a small app, fetching all users in a mapping might be okay,
            // or we use a database function/view. Since we act on the client,
            // we will call to auth.admin (which we can't reliably do on client) 
            // OR we rely on a custom view. Since we don't have a view yet, 
            // for now, we'll try to find if we can get basic info, or we just display the transaction.
            // Supabase client can't fetch auth.users by default. 
            // Workaround: if the current session matches the user_id, map it.

            const { data: { session } } = await supabase.auth.getSession();
            const currentUserEmail = session?.user?.email;
            const currentUserId = session?.user?.id;

            formattedData = formattedData.map(tx => ({
                ...tx,
                // Simple mapping: if it's the current user, show their email. Wait for backend view for true mapping.
                user_email: tx.user_id === currentUserId ? currentUserEmail : "แอดมิน (อื่น)"
            }));

            setTransactions(formattedData);
        } catch (err: any) {
            console.error("Error fetching transactions:", err);
            setErrorMsg("ไม่สามารถโหลดข้อมูลสต็อคกระดาษได้: " + err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        router.push("/");
        router.refresh();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.qty || Number(formData.qty) <= 0) {
            alert("กรุณาระบุจำนวนกระดาษที่รับเข้าให้ถูกต้อง");
            return;
        }

        setIsSubmitting(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const userId = session?.user?.id;

            const { data, error } = await supabase
                .from('paper_transactions')
                .insert([{
                    date: new Date().toISOString().split("T")[0],
                    transaction_type: "IN",
                    paper_type: formData.paperType,
                    qty: parseInt(formData.qty, 10),
                    description: formData.description || "รับเข้ากระดาษใหม่",
                    user_id: userId
                }])
                .select();

            if (error) throw error;

            if (data && data.length > 0) {
                const newTx = data[0] as PaperTransaction;
                newTx.user_email = session?.user?.email;
                setTransactions([newTx, ...transactions]);
                setFormData({ ...formData, qty: "", description: "" });
                logAction('CREATE', 'stock', `รับเข้ากระดาษ ${formData.paperType} ${parseInt(formData.qty, 10)} ใบ`, {
                  paperType: formData.paperType,
                  qty: parseInt(formData.qty, 10),
                  description: formData.description,
                });
            }

        } catch (err: any) {
            console.error("Error adding stock:", err);
            alert("เกิดข้อผิดพลาดในการบันทึกข้อมูล: " + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteTransaction = async (tx: PaperTransaction) => {
        const typeLabel = tx.transaction_type === 'IN' ? 'รับเข้า' : 'เบิกใช้';
        const confirmMsg = `ลบรายการ "${typeLabel} ${tx.paper_type} ${tx.qty} ใบ" ?\n\nหมายเหตุ: ${tx.description || '-'}\n\n${tx.transaction_type === 'IN' ? 'ยอดสต็อคจะลดลง' : 'ยอดสต็อคจะเพิ่มขึ้น'} ${tx.qty} ใบ`;
        if (!window.confirm(confirmMsg)) return;

        try {
            if (!tx.id) throw new Error("ไม่พบรหัสอ้างอิงของรายการ (ไม่มี ID)");

            const { error } = await supabase
                .from('paper_transactions')
                .delete()
                .eq('id', tx.id);
            
            if (error) throw error;
            
            setTransactions(prev => prev.filter(t => t.id !== tx.id));
            logAction('DELETE', 'stock', `ลบรายการ${tx.transaction_type === 'IN' ? 'รับเข้า' : 'เบิกใช้'} ${tx.paper_type} ${tx.qty} ใบ`, { txId: tx.id, paperType: tx.paper_type, qty: tx.qty, type: tx.transaction_type });

        } catch (err: any) {
            console.error('Error deleting transaction:', err);
            alert('ลบรายการไม่สำเร็จ: ' + (err.message || "เกิดข้อผิดพลาดบางอย่าง"));
        }
    };

    // Calculate Balances for ALL paper types
    const balances = PAPER_TYPES.map(type => {
        const typeTxs = transactions.filter(t => t.paper_type === type);
        const tIn = typeTxs.filter(t => t.transaction_type === 'IN').reduce((acc, t) => acc + t.qty, 0);
        const tOut = typeTxs.filter(t => t.transaction_type === 'OUT').reduce((acc, t) => acc + t.qty, 0);
        return {
            type,
            balance: tIn - tOut
        };
    });

    return (
        <div className="animate-fade-in">
            <div className="w-full max-w-5xl mx-auto flex flex-col gap-6">
                <div className="glass-panel p-6 text-center delay-100 animate-fade-in">
                    <h1 className="text-2xl font-bold text-slate-800 m-0">จัดการสต็อคกระดาษ A3</h1>
                    <p className="text-slate-500 mt-2">บันทึกรับเข้าและตรวจเช็คประวัติการเบิกจ่ายกระดาษทั้งหมด</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 delay-200 animate-fade-in">
                    {/* Stock In Form */}
                    <div className="flex flex-col gap-6 lg:col-span-1 border-0">
                    <section className="glass-panel p-6">
                        <div className="mb-6 border-b border-slate-100 pb-3">
                            <h2 className="text-lg font-bold text-slate-800 m-0">รับเข้ากระดาษ (Stock In)</h2>
                        </div>
                        <form onSubmit={handleSubmit} className="stock-form">
                            <div className="form-group mb-4">
                                <label className="form-label">ประเภทกระดาษ</label>
                                <select
                                    className="input-field cursor-pointer"
                                    value={formData.paperType}
                                    onChange={(e) => setFormData({ ...formData, paperType: e.target.value })}
                                >
                                    {PAPER_TYPES.map(type => (
                                        <option key={type} value={type} className="text-gray-900">{type}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group mb-4">
                                <label className="form-label">จำนวน (แผ่น)</label>
                                <input
                                    type="number"
                                    className="input-field"
                                    placeholder="ตัวอย่างเช่น 500"
                                    value={formData.qty}
                                    onChange={(e) => setFormData({ ...formData, qty: e.target.value })}
                                    required
                                />
                            </div>

                            <div className="form-group mb-6">
                                <label className="form-label">หมายเหตุ (ไม่บังคับ)</label>
                                <input
                                    type="text"
                                    className="input-field"
                                    placeholder="เช่น ซื้อจากร้าน A"
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                />
                            </div>

                            <button type="submit" className="btn btn-primary w-full" disabled={isSubmitting}>
                                {isSubmitting ? "กำลังบันทึก..." : "บันทึกรับเข้าสต็อค"}
                            </button>
                        </form>
                    </section>
                    
                    {/* Realtime Stats Summary All at Once */}
                    <section className="glass-panel p-6 bg-slate-800 text-white border-0">
                        <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/10">
                            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider m-0">สต็อคกระดาษคงเหลือ</h3>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            {balances.map((b) => (
                                <div key={b.type} className="stat-card bg-white/5 border border-white/10 rounded-xl p-3 text-center transition-colors hover:bg-white/10">
                                    <span className="block text-xs text-slate-400 mb-1 truncate">{b.type}</span>
                                    <span className={`block text-2xl font-bold ${b.balance < 50 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                        {b.balance.toLocaleString()}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </section>
                    </div>

                    {/* Transactions History */}
                    <section className="glass-panel p-6 lg:col-span-2">
                        <div className="mb-6 border-b border-slate-100 pb-3">
                            <h2 className="text-lg font-bold text-slate-800 m-0">ประวัติการทำรายการ</h2>
                        </div>

                        <div className="transactions-list mt-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                            {errorMsg && (
                                <div className="p-3 mb-4 text-sm text-red-500 bg-red-900/20 border border-red-500/50 rounded-lg">
                                    {errorMsg}
                                </div>
                            )}

                            {isLoading && transactions.length === 0 ? (
                                <div className="text-center py-8 text-muted">กำลังโหลดข้อมูลสต็อค...</div>
                            ) : transactions.map((tx) => (
                                <div key={tx.id} className="group flex justify-between items-center py-3 px-3 border-b border-slate-100 last:border-0 hover:bg-red-50/30 transition-colors relative">
                                    <div className="flex flex-col">
                                        <span className="font-medium text-slate-700 text-sm">
                                            {tx.transaction_type === 'IN' ? 'รับเข้า' : 'เบิกใช้'}{' '}
                                            <span className="text-accent-primary font-bold">{tx.paper_type}</span>
                                        </span>
                                        <span className="text-xs text-slate-500 mt-0.5 max-w-[200px] truncate">
                                            {tx.description ? `หมายเหตุ: ${tx.description}` : <span className="text-slate-300">ไม่มีหมายเหตุ</span>}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="flex flex-col items-end">
                                            <span className={`font-bold text-sm ${tx.transaction_type === 'IN' ? 'text-emerald-500' : 'text-red-500'}`}>
                                                {tx.transaction_type === 'IN' ? '+' : '-'}{tx.qty}
                                            </span>
                                            <div className="flex flex-col items-end mt-0.5">
                                                <span className="text-[10px] text-slate-400">{new Date(tx.date).toLocaleDateString("th-TH")}</span>
                                                {tx.user_email && <span className="text-[9px] text-slate-400/80">{tx.user_email.split('@')[0]}</span>}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleDeleteTransaction(tx)}
                                            title="ลบรายการนี้"
                                            className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-7 h-7 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-100 text-sm"
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                </div>
                            ))}

                            {transactions.length === 0 && !isLoading && !errorMsg && (
                                <div className="empty-state text-muted text-center pt-8 pb-8">
                                    ยังไม่มีประวัติการทำรายการ
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
