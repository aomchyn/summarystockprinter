"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { logAction } from "@/lib/auditLog";


interface Product {
  id: string;
  name: string;
  qtyPerA3: number;
}

export default function Products() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<string>('');

  // Fetch products from Supabase on component mount
  useEffect(() => {
    fetchProducts();
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


  const fetchProducts = async () => {
    setIsLoading(true);
    setErrorStatus(null);
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Map database snake_case to frontend camelCase
      const formattedProducts: Product[] = data?.map(p => ({
        id: p.id,
        name: p.name,
        qtyPerA3: p.qty_per_a3
      })) || [];

      setProducts(formattedProducts);
    } catch (error: any) {
      console.error("Error fetching products:", error);
      setErrorStatus("ไม่สามารถโหลดข้อมูลสินค้าได้: " + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const [formData, setFormData] = useState({
    name: "",
    qtyPerA3: "",
  });

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.qtyPerA3) return;

    // Case-insensitive duplicate check
    const inputName = formData.name.trim().toLowerCase();
    const duplicate = products.find(p => p.name.trim().toLowerCase() === inputName);
    if (duplicate) {
      alert(`มีสินค้าชื่อ "${duplicate.name}" อยู่ในระบบแล้ว กรุณาใช้ชื่ออื่น`);
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('products')
        .insert([{
          name: formData.name.trim(),
          qty_per_a3: parseInt(formData.qtyPerA3, 10)
        }])
        .select();

      if (error) throw error;

      if (data && data.length > 0) {
        const p = data[0];
        const newProduct: Product = {
          id: p.id,
          name: p.name,
          qtyPerA3: p.qty_per_a3
        };
        setProducts([newProduct, ...products]);
        setFormData({ name: "", qtyPerA3: "" });
        logAction('CREATE', 'products', `เพิ่มสินค้า "${p.name}"`, { name: p.name, qtyPerA3: p.qty_per_a3 });
      }

    } catch (error: any) {
      console.error("Error adding product:", error);
      alert("เกิดข้อผิดพลาดในการเพิ่มสินค้า: " + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบสินค้า "${name}"?\nถ้าลบแล้ว ข้อมูลประวัติการสั่งพิมพ์ที่เกี่ยวข้องอาจได้รับผลกระทบ`)) {
      setIsLoading(true);
      try {
        const { error } = await supabase
          .from('products')
          .delete()
          .eq('id', id);

        if (error) throw error;

        setProducts(products.filter(p => p.id !== id));
        logAction('DELETE', 'products', `ลบสินค้า "${name}"`, { id, name });

      } catch (error: any) {
        console.error("Error deleting product:", error);
        alert("เกิดข้อผิดพลาดในการลบสินค้า: " + error.message);
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="dashboard-container animate-fade-in">
      {/* Header */}
      <header className="dashboard-header glass-panel">
        <div className="header-content container">
          <div className="brand">
            <span className="logo-icon">📦</span>
            <span className="brand-name">WorkTracker</span>
          </div>

          <nav className="main-nav">
            <Link href="/dashboard" className="nav-link">หน้าหลัก</Link>
            <Link href="/products" className="nav-link active">จัดการสินค้า</Link>
            <Link href="/orders" className="nav-link">สั่งพิมพ์</Link>
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

      <main className="container dashboard-main">
        {/* New Product Form */}
        <section className="form-section glass-panel delay-100 animate-fade-in">
          <h2>เพิ่มสินค้าใหม่</h2>
          <form onSubmit={handleSubmit} className="product-form">
            <div className="form-row">
              <div className="form-group flex-2">
                <label className="form-label">ชื่อสินค้า</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="เช่น สติ๊กเกอร์โลโก้ ขนาด 5x5 ซม."
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group flex-1">
                <label className="form-label">จำนวนดวง/แผ่น ต่อกระดาษ A3</label>
                <input
                  type="number"
                  className="input-field"
                  placeholder="เช่น 120"
                  value={formData.qtyPerA3}
                  onChange={(e) => setFormData({ ...formData, qtyPerA3: e.target.value })}
                  required
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary w-full mt-4" disabled={isLoading}>
              {isLoading ? "กำลังประมวลผล..." : "เพิ่มสินค้า"}
            </button>
          </form>
        </section>

        {/* Product List */}
        <section className="list-section glass-panel delay-200 animate-fade-in">
          <div className="section-header">
            <h2>รายการสินค้าทั้งหมด</h2>
            <div className="total-items text-gradient-accent">
              {products.length} รายการ
            </div>
          </div>

          <div className="product-grid">
            {errorStatus && (
              <div className="p-4 mb-4 text-sm text-red-500 bg-red-900/20 border border-red-500/50 rounded-lg col-span-full">
                {errorStatus}
              </div>
            )}

            {isLoading && products.length === 0 ? (
              <div className="text-center py-10 text-muted col-span-full">กำลังโหลดข้อมูลสินค้า...</div>
            ) : products.map((product) => (
              <div key={product.id} className="product-card">
                <div className="product-icon">🏷️</div>
                <div className="product-details">
                  <h3 className="product-name">{product.name}</h3>
                  <div className="product-qty text-muted">
                    <span className="qty-highlight">{product.qtyPerA3}</span> ชิ้น / A3
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(product.id, product.name)}
                  className="btn-delete"
                  title="ลบสินค้า"
                  disabled={isLoading}
                >
                  ✕
                </button>
              </div>
            ))}
            {products.length === 0 && (
              <div className="empty-state text-muted text-center pt-8 pb-8">
                ยังไม่มีข้อมูลสินค้าในระบบ
              </div>
            )}
          </div>
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

        .logo-icon {
          font-size: 1.5rem;
        }

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

        .btn-sm {
          padding: 8px 16px;
          font-size: 0.8rem;
        }

        .dashboard-main {
          display: grid;
          gap: 24px;
          max-width: 800px;
          margin: 0 auto;
        }

        section h2 {
          font-size: 1.25rem;
          font-weight: 600;
          margin-bottom: 24px;
          color: var(--text-main);
        }

        .form-section, .list-section {
          padding: 32px;
        }

        .form-row {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        @media (min-width: 640px) {
          .form-row {
            flex-direction: row;
          }
        }

        .flex-1 { flex: 1; }
        .flex-2 { flex: 2; }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 24px;
        }

        .total-items {
          font-size: 1.2rem;
          font-weight: 700;
        }

        .product-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }

        @media (min-width: 640px) {
          .product-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        .product-card {
          display: flex;
          align-items: center;
          gap: 16px;
          background: rgba(0,0,0,0.2);
          border: 1px solid var(--surface-border);
          padding: 20px;
          border-radius: var(--radius-md);
          transition: transform var(--transition-base), background var(--transition-base);
          position: relative;
        }

        .product-card:hover {
          transform: translateY(-4px);
          background: rgba(0,0,0,0.3);
          border-color: rgba(255,255,255,0.15);
        }

        .product-icon {
          font-size: 2rem;
          background: rgba(255,255,255,0.05);
          width: 50px;
          height: 50px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-sm);
        }

        .product-details {
          flex: 1;
        }

        .product-name {
          font-size: 1.05rem;
          font-weight: 500;
          color: var(--text-main);
          margin-bottom: 4px;
        }

        .product-qty {
          font-size: 0.9rem;
        }

        .qty-highlight {
          color: var(--accent-primary);
          font-weight: 600;
          font-size: 1.1rem;
        }

        .btn-delete {
          position: absolute;
          top: 12px;
          right: 12px;
          background: transparent;
          color: var(--text-muted);
          border: none;
          cursor: pointer;
          font-size: 1rem;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          opacity: 0;
        }

        .product-card:hover .btn-delete {
          opacity: 1;
        }

        .btn-delete:hover {
          background: rgba(239, 68, 68, 0.2);
          color: var(--error-color);
        }
        
        .empty-state {
          grid-column: 1 / -1;
        }
      `}</style>
    </div>
  );
}
