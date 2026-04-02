"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { PAPER_TYPES } from "../stock/page";
import { logAction } from "@/lib/auditLog";


// Mock Product Interface (mirrors the one in products)
interface Product {
  id: string;
  name: string;
  qtyPerA3: number;
}

interface OrderPrint {
  id: string;
  date: string;
  department: string;
  lotName: string;
  productId: string;
  targetQty: number;
  sheetsNeeded: number;
  totalPrinted: number;
  excessQty: number;
  wasteQty?: number;
  wasteQtyRemark?: string;
  wasteA3?: number;
  wasteA3Remark?: string;
}

export default function PrintOrders() {
  const router = useRouter();

  const currentDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD format

  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<OrderPrint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<string>('');

  useEffect(() => {
    fetchData();
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

  const fetchData = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      // 1. Fetch available products
      const { data: productsData, error: productsError } = await supabase
        .from('products')
        .select('*')
        .order('name');

      if (productsError) throw productsError;

      const formattedProducts: Product[] = productsData?.map(p => ({
        id: p.id,
        name: p.name,
        qtyPerA3: p.qty_per_a3
      })) || [];
      setProducts(formattedProducts);

      // 2. Fetch past print orders for history
      const { data: ordersData, error: ordersError } = await supabase
        .from('print_orders')
        .select('*')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });

      if (ordersError) throw ordersError;

      const formattedOrders: OrderPrint[] = ordersData?.map(o => ({
        id: o.id,
        date: o.date,
        department: o.department || "-",
        lotName: o.lot_name,
        productId: o.product_id,
        targetQty: o.target_qty,
        sheetsNeeded: o.sheets_needed,
        totalPrinted: o.total_printed,
        excessQty: o.excess_qty,
        wasteQty: o.waste_qty || undefined,
        wasteQtyRemark: o.waste_qty_remark || undefined,
        wasteA3: o.waste_a3 || undefined,
        wasteA3Remark: o.waste_a3_remark || undefined,
      })) || [];

      setOrders(formattedOrders);
    } catch (error: any) {
      console.error("Error fetching data:", error);
      setErrorMsg("ไม่สามารถโหลดข้อมูลระบบได้: " + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const [formData, setFormData] = useState({
    department: "ZT",
    lotName: "",
    paperType: "สติกเกอร์",
    productId: "",
    targetQty: "",
    wasteQty: "",
    wasteQtyRemark: "",
    wasteA3: "",
    wasteA3Remark: "",
  });

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  // --- Searchable Combobox State ---
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const productDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (productDropdownRef.current && !productDropdownRef.current.contains(event.target as Node)) {
        setIsProductDropdownOpen(false);
        // Reset query to selected name if valid
        const selected = products.find(p => p.id === formData.productId);
        if (selected) {
          setProductSearchQuery(selected.name);
        } else {
          setProductSearchQuery("");
        }
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [formData.productId, products]);

  const filteredProducts = products.filter(p => p.name.toLowerCase().includes(productSearchQuery.toLowerCase()));

  // Ensure when product changes externally (e.g. after submit reset), the search query resets
  useEffect(() => {
    if (formData.productId === "") {
      setProductSearchQuery("");
    }
  }, [formData.productId]);
  // ---------------------------------

  // Real-time calculation logic for visual preview
  const calculationPreview = useMemo(() => {
    if (!formData.productId || !formData.targetQty) return null;

    const selectedProduct = products.find(p => p.id === formData.productId);
    const target = parseInt(formData.targetQty, 10);
    const wasteA3 = formData.wasteA3 ? parseInt(formData.wasteA3, 10) : 0;
    const wasteQty = formData.wasteQty ? parseInt(formData.wasteQty, 10) : 0;

    if (!selectedProduct || isNaN(target) || target <= 0) return null;

    const qtyPerA3 = selectedProduct.qtyPerA3;

    // Step 1: sheets needed just for target
    const baseSheetsForTarget = Math.ceil(target / qtyPerA3);
    const naturalTotal = baseSheetsForTarget * qtyPerA3;
    const naturalExcess = naturalTotal - target;

    // Step 2: waste pieces reduce excess first; only add more sheets if waste > naturalExcess
    let extraSheetsForWaste = 0;
    if (wasteQty > naturalExcess) {
      extraSheetsForWaste = Math.ceil((wasteQty - naturalExcess) / qtyPerA3);
    }

    // Step 3: productive sheets (affects piece count)
    const productiveSheets = baseSheetsForTarget + extraSheetsForWaste;
    const totalPrinted = productiveSheets * qtyPerA3;
    const excessQty = Math.max(0, totalPrinted - target - wasteQty);

    // Step 4: wasteA3 only deducts from stock, does NOT produce pieces
    const sheetsNeeded = productiveSheets + wasteA3;

    return {
      sheetsNeeded,
      totalPrinted,
      excessQty,
      productName: selectedProduct.name,
      qtyPerA3,
      naturalExcess,
    };
  }, [formData.productId, formData.targetQty, formData.wasteA3, formData.wasteQty, products]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!calculationPreview || !formData.lotName) return;

    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;

      const { data, error } = await supabase
        .from('print_orders')
        .insert([{
          date: currentDate,
          department: formData.department,
          lot_name: formData.lotName,
          product_id: formData.productId,
          target_qty: parseInt(formData.targetQty, 10),
          sheets_needed: calculationPreview.sheetsNeeded,
          total_printed: calculationPreview.totalPrinted,
          excess_qty: calculationPreview.excessQty,
          waste_qty: formData.wasteQty ? parseInt(formData.wasteQty, 10) : null,
          waste_qty_remark: formData.wasteQtyRemark || null,
          waste_a3: formData.wasteA3 ? parseInt(formData.wasteA3, 10) : null,
          waste_a3_remark: formData.wasteA3Remark || null,
        }])
        .select();

      if (error) throw error;

      if (data && data.length > 0) {
        const o = data[0];

        // Deduct from Paper Stock
        const { error: txError } = await supabase
          .from('paper_transactions')
          .insert([{
            date: currentDate,
            transaction_type: "OUT",
            paper_type: formData.paperType,
            qty: calculationPreview.sheetsNeeded,
            description: `สั่งพิมพ์ล็อต: ${formData.lotName}`,
            reference_id: o.id,
            user_id: userId
          }]);

        if (txError) {
          console.error("Error logging paper transaction:", txError);
          // Non-blocking error, user can be alerted but order is created.
        }

        const newOrder: OrderPrint = {
          id: o.id,
          date: o.date,
          department: o.department || formData.department,
          lotName: o.lot_name,
          productId: o.product_id,
          targetQty: o.target_qty,
          sheetsNeeded: o.sheets_needed,
          totalPrinted: o.total_printed,
          excessQty: o.excess_qty,
          wasteQty: o.waste_qty || undefined,
          wasteQtyRemark: o.waste_qty_remark || undefined,
          wasteA3: o.waste_a3 || undefined,
          wasteA3Remark: o.waste_a3_remark || undefined,
        };

        setOrders([newOrder, ...orders]);
        logAction('CREATE', 'orders', `สร้างคำสั่งพิมพ์ ล็อต ${formData.lotName}`, {
          lot: formData.lotName,
          department: formData.department,
          product: calculationPreview.productName,
          targetQty: parseInt(formData.targetQty, 10),
          sheetsNeeded: calculationPreview.sheetsNeeded,
          paperType: formData.paperType,
        });

        setFormData({
          department: "ZT",
          lotName: "",
          paperType: "สติกเกอร์",
          productId: "",
          targetQty: "",
          wasteQty: "",
          wasteQtyRemark: "",
          wasteA3: "",
          wasteA3Remark: "",
        });
      }
    } catch (error: any) {
      console.error("Error creating print order:", error);
      alert("เกิดข้อผิดพลาดในการบันทึกคำสั่งพิมพ์: " + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="dashboard-container animate-fade-in">
      {/* Header */}
      <header className="dashboard-header glass-panel">
        <div className="header-content container mx-auto px-4">
          <div className="brand">
            <span className="logo-icon">🖨️</span>
            <span className="brand-name">WorkTracker</span>
          </div>

          <nav className="main-nav">
            <Link href="/dashboard" className="nav-link">หน้าหลัก</Link>
            <Link href="/products" className="nav-link">จัดการสินค้า</Link>
            <Link href="/orders" className="nav-link active">สั่งพิมพ์</Link>
            <Link href="/stock" className="nav-link">สต็อคกระดาษ</Link>
            <Link href="/logs" className="nav-link">ประวัติการใช้งาน</Link>
          </nav>

          <div className="user-section">
            <span className="user-name">สวัสดี, {currentUser || 'ผู้ใช้'}</span>
            <button onClick={handleLogout} className="btn btn-outline btn-sm">
              ออกจากระบบ
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 dashboard-main">
        {/* Print Order Form */}
        <section className="form-section glass-panel delay-100 animate-fade-in">
          <h2>คำนวณการพิมพ์สินค้า</h2>
          <form onSubmit={handleSubmit} className="product-form">
            <div className="form-row">
              <div className="form-group flex-1">
                <label className="form-label">วันที่</label>
                <input
                  type="date"
                  className="input-field is-disabled"
                  value={currentDate}
                  disabled
                />
              </div>
              <div className="form-group flex-1">
                <label className="form-label">หน่วยงาน</label>
                <select
                  className="input-field cursor-pointer"
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  required
                >
                  <option value="ZT" className="text-gray-900">ZT</option>
                  <option value="13 ไร่" className="text-gray-900">13 ไร่</option>
                  <option value="หน่วยงานอื่นๆ" className="text-gray-900">หน่วยงานอื่นๆ</option>
                </select>
              </div>
              <div className="form-group flex-2">
                <label className="form-label">เลขลอตการผลิต (Lot Name)</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="เช่น LOT-2026-03-A"
                  value={formData.lotName}
                  onChange={(e) => setFormData({ ...formData, lotName: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group flex-1">
                <label className="form-label">ประเภทกระดาษ</label>
                <select
                  className="input-field cursor-pointer"
                  value={formData.paperType}
                  onChange={(e) => setFormData({ ...formData, paperType: e.target.value })}
                  required
                >
                  {PAPER_TYPES.map(type => (
                    <option key={type} value={type} className="text-gray-900">{type}</option>
                  ))}
                </select>
              </div>
              <div className="form-group flex-2" ref={productDropdownRef} style={{ position: 'relative' }}>
                <label className="form-label">เลือกสินค้า</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="-- พิมพ์ค้นหาสินค้า --"
                  value={productSearchQuery}
                  onChange={(e) => {
                    setProductSearchQuery(e.target.value);
                    setIsProductDropdownOpen(true);
                    setFormData({ ...formData, productId: "" }); // clear selection while searching
                  }}
                  onFocus={() => {
                    setIsProductDropdownOpen(true);
                    setProductSearchQuery("");
                    setFormData({ ...formData, productId: "" });
                  }}
                  required
                />

                {isProductDropdownOpen && (
                  <div className="absolute top-[80px] left-0 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-xl max-h-60 overflow-y-auto z-50">
                    {filteredProducts.length > 0 ? filteredProducts.map(p => (
                      <div
                        key={p.id}
                        className="p-3 hover:bg-sky-50 cursor-pointer border-b border-slate-100 last:border-0 text-slate-800 flex flex-col"
                        onClick={() => {
                          setFormData({ ...formData, productId: p.id });
                          setProductSearchQuery(p.name);
                          setIsProductDropdownOpen(false);
                        }}
                      >
                        <span className="font-medium text-[15px]">{p.name}</span>
                        <span className="text-xs text-slate-500 mt-0.5">{p.qtyPerA3} ชิ้น/A3</span>
                      </div>
                    )) : (
                      <div className="p-3 text-slate-500 text-sm text-center">ไม่พบสินค้าที่ค้นหา</div>
                    )}
                  </div>
                )}
                {/* Hidden input to enforce required validity for the form */}
                <input
                  type="hidden"
                  value={formData.productId}
                  onChange={() => { }}
                  required
                />
              </div>
              <div className="form-group flex-1">
                <label className="form-label">จำนวนเป้าหมายที่ต้องการ</label>
                <input
                  type="number"
                  className="input-field"
                  placeholder="เช่น 100"
                  value={formData.targetQty}
                  onChange={(e) => setFormData({ ...formData, targetQty: e.target.value })}
                  required
                  min="1"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group flex-1">
                <label className="form-label">จำนวนเสีย (ชิ้น) - ถ้ามี</label>
                <input
                  type="number"
                  className="input-field"
                  placeholder="0"
                  value={formData.wasteQty}
                  onChange={(e) => setFormData({ ...formData, wasteQty: e.target.value })}
                  min="0"
                />
              </div>
              <div className="form-group flex-2">
                <label className="form-label">หมายเหตุ (ของเสียระดับชิ้น)</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="เช่น สีเพี้ยน, ตัดเบี้ยว"
                  value={formData.wasteQtyRemark}
                  onChange={(e) => setFormData({ ...formData, wasteQtyRemark: e.target.value })}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group flex-1">
                <label className="form-label">จำนวน A3 เสีย (ใบ) - ถ้ามี</label>
                <input
                  type="number"
                  className="input-field"
                  placeholder="0"
                  value={formData.wasteA3}
                  onChange={(e) => setFormData({ ...formData, wasteA3: e.target.value })}
                  min="0"
                />
              </div>
              <div className="form-group flex-2">
                <label className="form-label">หมายเหตุ (ของเสียระดับ A3)</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="เช่น เครื่องปริ้นกระดาษติด"
                  value={formData.wasteA3Remark}
                  onChange={(e) => setFormData({ ...formData, wasteA3Remark: e.target.value })}
                />
              </div>
            </div>

            {/* Live Calculation Preview */}
            {calculationPreview && (
              <div className="calculation-preview delay-100 animate-fade-in">
                <h3>ผลการคำนวณ (พรีวิว)</h3>
                <div className="preview-grid">
                  <div className="preview-stat">
                    <span className="stat-label">กระดาษ A3 ที่ต้องใช้</span>
                    <span className="stat-value highlight">{calculationPreview.sheetsNeeded} <small>ใบ</small></span>
                  </div>
                  <div className="preview-stat">
                    <span className="stat-label">จำนวนที่จะได้จริงทั้งหมด</span>
                    <span className="stat-value">{calculationPreview.totalPrinted} <small>ชิ้น</small></span>
                  </div>
                  <div className="preview-stat">
                    <span className="stat-label">จำนวนเศษที่ผลิตเกิน</span>
                    <span className="stat-value warning">{calculationPreview.excessQty} <small>ชิ้น</small></span>
                  </div>
                </div>
              </div>
            )}

            <button type="submit" className="btn btn-primary w-full mt-4" disabled={isSubmitting || isLoading}>
              {isSubmitting ? "กำลังบันทึกข้อมูล..." : "บันทึกคำสั่งพิมพ์"}
            </button>
          </form>
        </section>

      </main>

      <style jsx>{`
        .dashboard-container {
          min-height: 100vh;
          padding-top: 80px;
          padding-bottom: 40px;
        }

        .dashboard-header {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          z-index: 100;
          border-radius: 0;
          border-left: none;
          border-right: none;
          border-top: none;
        }

        .header-content {
          display: flex;
          justify-content: space-between;
          align-items: center;
          height: 70px;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .logo-icon { font-size: 1.5rem; }
        .brand-name {
          font-weight: 700;
          font-size: 1.1rem;
          color: var(--text-main);
        }

        .main-nav {
          display: flex;
          gap: 20px;
          margin: 0 auto;
        }

        .nav-link {
          font-size: 0.95rem;
          font-weight: 500;
          color: var(--text-muted);
          transition: color var(--transition-base);
          position: relative;
        }

        .nav-link:hover, .nav-link.active {
          color: var(--text-main);
        }

        .nav-link.active::after {
          content: "";
          position: absolute;
          bottom: -4px;
          left: 0;
          width: 100%;
          height: 2px;
          background: var(--accent-primary);
          border-radius: 2px;
        }

        .user-section {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .user-name {
          font-size: 0.9rem;
          color: var(--text-muted);
          display: none;
        }

        @media (min-width: 640px) {
          .user-name { display: block; }
        }

        .dashboard-main {
          display: grid;
          gap: 24px;
          max-width: 900px;
          margin: 0 auto;
        }

        section h2 {
          font-size: 1.25rem;
          font-weight: 600;
          margin-bottom: 24px;
          color: var(--text-main);
        }

        .form-section, .list-section { padding: 32px; }

        .form-row {
          display: flex;
          flex-direction: column;
          gap: 16px;
          margin-bottom: 16px;
        }

        @media (min-width: 640px) {
          .form-row { flex-direction: row; }
        }

        .flex-1 { flex: 1; }
        .flex-2 { flex: 2; }

        .is-disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        /* Preview Box */
        .calculation-preview {
          background: rgba(59, 130, 246, 0.05); /* very soft blue */
          border: 1px solid rgba(59, 130, 246, 0.2);
          border-radius: var(--radius-sm);
          padding: 24px;
          margin: 24px 0;
        }

        .calculation-preview h3 {
          font-size: 1rem;
          font-weight: 500;
          color: var(--text-muted);
          margin-bottom: 16px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .preview-grid {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        @media (min-width: 640px) {
          .preview-grid {
             flex-direction: row;
             justify-content: space-between;
          }
        }

        .preview-stat {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .stat-label {
          font-size: 0.85rem;
          color: var(--text-muted);
        }

        .stat-value {
          font-size: 1.75rem;
          font-weight: 700;
          color: var(--text-main);
        }

        .stat-value small {
          font-size: 1rem;
          font-weight: 400;
          color: var(--text-muted);
        }

        .stat-value.highlight { color: var(--accent-primary); }
        .stat-value.warning { color: #f59e0b; } /* Amber Excess */


        /* Orders List */
        .order-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .order-card {
          background: rgba(0,0,0,0.2);
          border: 1px solid var(--surface-border);
          padding: 20px;
          border-radius: var(--radius-md);
          transition: transform var(--transition-base), background var(--transition-base);
        }

        .order-card:hover {
          transform: translateY(-2px);
          background: rgba(0,0,0,0.3);
          border-color: rgba(255,255,255,0.15);
        }

        .order-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 12px;
          font-size: 0.85rem;
          font-weight: 500;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          padding-bottom: 8px;
        }

        .order-body {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .order-product-name {
          font-size: 1.1rem;
          font-weight: 600;
          color: var(--text-main);
        }

        .order-details-grid {
          display: flex;
          align-items: center;
          gap: 24px;
          padding-top: 8px;
        }

        .detail-item {
          display: flex;
          flex-direction: column;
        }

        .detail-item .label {
          font-size: 0.75rem;
          color: var(--text-muted);
          text-transform: uppercase;
        }

        .detail-item .value {
          font-size: 1.25rem;
          font-weight: 600;
          color: var(--text-main);
        }

        .divider {
          height: 32px;
          width: 1px;
          background: rgba(255,255,255,0.1);
        }

        .highlight-color { color: var(--accent-primary) !important; }
        .warning-color { color: #f59e0b !important; }
      `}</style>
    </div>
  );
}
