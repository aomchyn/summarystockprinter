"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
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

  const [searchQuery, setSearchQuery] = useState("");
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState({
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
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;

      const { data, error } = await supabase
        .from('products')
        .insert([{
          name: formData.name.trim(),
          qty_per_a3: parseInt(formData.qtyPerA3, 10),
          user_id: userId
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
        if (!id) throw new Error("ไม่พบรหัสอ้างอิงของสินค้า (ไม่มี ID)");

        const { error } = await supabase
          .from('products')
          .delete()
          .eq('id', id);

        if (error) {
           if (error.code === '23503') { // PostgreSQL foreign_key_violation
             throw new Error("ไม่สามารถลบสินค้าได้ เนื่องจากยังมีประวัติการสั่งพิมพ์ที่ใช้สินค้านี้อยู่ (กรุณาลบประวัติเหล่านั้นออกก่อน)");
           }
           throw error;
        }

        setProducts(products.filter(p => p.id !== id));
        logAction('DELETE', 'products', `ลบสินค้า "${name}"`, { id, name });

      } catch (error: any) {
        console.error("Error deleting product:", error);
        alert("❌ เกิดข้อผิดพลาดในการลบสินค้า: " + (error.message || "เกิดข้อผิดพลาดบางอย่าง"));
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleEditClick = (product: Product) => {
    setEditingProductId(product.id);
    setEditFormData({
      name: product.name,
      qtyPerA3: product.qtyPerA3.toString(),
    });
  };

  const handleCancelEdit = () => {
    setEditingProductId(null);
    setEditFormData({ name: "", qtyPerA3: "" });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProductId || !editFormData.name || !editFormData.qtyPerA3) return;

    const originalProduct = products.find(p => p.id === editingProductId);
    if (!originalProduct) return;
    
    const id = editingProductId;
    const originalName = originalProduct.name;

    // Case-insensitive duplicate check (exclude current product)
    const inputName = editFormData.name.trim().toLowerCase();
    const duplicate = products.find(p => p.id !== id && p.name.trim().toLowerCase() === inputName);
    if (duplicate) {
      alert(`มีสินค้าชื่อ "${duplicate.name}" อยู่ในระบบแล้ว กรุณาใช้ชื่ออื่น`);
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase
        .from('products')
        .update({
          name: editFormData.name.trim(),
          qty_per_a3: parseInt(editFormData.qtyPerA3, 10)
        })
        .eq('id', id);

      if (error) throw error;

      // Update local state
      setProducts(products.map(p => 
        p.id === id 
          ? { ...p, name: editFormData.name.trim(), qtyPerA3: parseInt(editFormData.qtyPerA3, 10) } 
          : p
      ));
      
      logAction('UPDATE', 'products', `แก้ไขสินค้าจาก "${originalName}" เป็น "${editFormData.name.trim()}"`, { 
        id, 
        originalName, 
        newName: editFormData.name.trim(),
        newQty: editFormData.qtyPerA3 
      });

      setEditingProductId(null);
    } catch (error: any) {
      console.error("Error updating product:", error);
      alert("เกิดข้อผิดพลาดในการแก้ไขสินค้า: " + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="animate-fade-in">
      <div className="w-full max-w-4xl mx-auto flex flex-col gap-8">
        {/* New Product Form */}
        <section className="glass-panel p-6 sm:p-8 delay-100 animate-fade-in">
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
        <section className="glass-panel p-6 sm:p-8 delay-200 animate-fade-in">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
            <div className="flex items-center gap-4">
              <h2 className="text-xl font-bold text-slate-800 m-0">รายการสินค้าทั้งหมด</h2>
              <div className="text-lg font-bold bg-sky-100 text-sky-700 px-3 py-1 rounded-full">
                {filteredProducts.length} รายการ
              </div>
            </div>
            <div className="w-full sm:w-64">
               <input
                  type="text"
                  className="input-field"
                  placeholder="🔍 ค้นหาสินค้า..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {errorStatus && (
              <div className="p-4 mb-4 text-sm text-red-500 bg-red-900/20 border border-red-500/50 rounded-lg col-span-full">
                {errorStatus}
              </div>
            )}

            {isLoading && products.length === 0 ? (
              <div className="text-center py-10 text-slate-400 col-span-full">กำลังโหลดข้อมูลสินค้า...</div>
            ) : filteredProducts.map((product) => (
              <div key={product.id} className="relative flex items-center gap-4 bg-white border border-slate-200 p-5 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-1 transition-all group">
                <div className="text-3xl bg-slate-50 w-14 h-14 flex items-center justify-center rounded-lg shadow-inner">🏷️</div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-slate-800 mb-1 truncate" title={product.name}>{product.name}</h3>
                  <div className="text-sm text-slate-500">
                    <span className="text-sky-600 font-bold text-lg">{product.qtyPerA3}</span> ชิ้น / A3
                  </div>
                </div>
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-white/80 backdrop-blur-sm rounded-lg sm:opacity-100 sm:static sm:bg-transparent">
                  <button
                    onClick={() => handleEditClick(product)}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                    title="แก้ไขสินค้า"
                    disabled={isLoading}
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => handleDelete(product.id, product.name)}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="ลบสินค้า"
                    disabled={isLoading}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
            {filteredProducts.length === 0 && !isLoading && (
              <div className="col-span-full text-slate-400 text-center pt-8 pb-8">
                {searchQuery ? `ไม่พบสินค้าตรงกับ "${searchQuery}"` : "ยังไม่มีข้อมูลสินค้าในระบบ"}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Edit Product Modal */}
      {editingProductId && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-fade-in">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center sticky top-0 bg-white/95 backdrop-blur z-10">
              <h3 className="text-xl font-bold text-slate-800">✏️ แก้ไขข้อมูลสินค้า</h3>
              <button
                onClick={handleCancelEdit}
                className="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100"
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleSaveEdit} className="p-6">
              <div className="form-group">
                <label className="form-label">ชื่อสินค้า</label>
                <input
                  type="text"
                  className="input-field"
                  value={editFormData.name}
                  onChange={e => setEditFormData({...editFormData, name: e.target.value})}
                  placeholder="ชื่อสินค้า"
                  required
                />
              </div>
              
              <div className="form-group mb-8">
                <label className="form-label">จำนวนดวง/แผ่น ต่อกระดาษ A3</label>
                <input
                  type="number"
                  className="input-field"
                  value={editFormData.qtyPerA3}
                  onChange={e => setEditFormData({...editFormData, qtyPerA3: e.target.value})}
                  placeholder="จำนวนดวง/แผ่น"
                  required
                />
              </div>
              
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button 
                  type="button" 
                  className="px-6 py-2.5 rounded-lg font-medium text-slate-600 hover:bg-slate-100 transition-colors" 
                  onClick={handleCancelEdit} 
                  disabled={isLoading}
                >
                  ยกเลิก
                </button>
                <button 
                  type="submit" 
                  className="px-6 py-2.5 rounded-lg font-bold text-white bg-sky-500 hover:bg-sky-600 transition-colors disabled:opacity-50" 
                  disabled={isLoading}
                >
                  {isLoading ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
