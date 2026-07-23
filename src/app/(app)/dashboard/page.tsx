"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { logAction } from "@/lib/auditLog";
import { PAPER_TYPES } from "../stock/page";


interface DashboardOrderGroup {
  id: string; // We'll construct a composite ID like "department-lotName-productId"
  department: string;
  lotName: string;
  productName: string;
  targetQty: number;
  sheetsNeeded: number;
  totalPrinted: number;
  excessQty: number;
  wasteQty: number; // Summed
  wasteA3: number; // Summed
  remarks: string[]; // To hold all remarks for this group
  productId: string;
  entries: any[]; // The raw Supabase rows that make up this group
}

interface Product {
  id: string;
  name: string;
  qtyPerA3: number;
}

export default function Dashboard() {
  const router = useRouter();

  const [currentUser, setCurrentUser] = useState<string>('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [printOrders, setPrintOrders] = useState<DashboardOrderGroup[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const [products, setProducts] = useState<Product[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  // --- Edit Modal State & Handlers ---
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<any>(null);
  const [editFormData, setEditFormData] = useState({
    department: "",
    lotName: "",
    paperType: "สติกเกอร์ RONDA PG-88G (ไม่เหนียว)",
    productId: "",
    targetQty: "",
    goodA3: "",
    wasteQty: "",
    wasteQtyRemark: "",
    wasteA3: "",
    wasteA3Remark: "",
    remark: "",
  });
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);
  const lastConfirmedProductRef = useRef<{ id: string; label: string }>({ id: "", label: "" });
  const handleDeleteEntry = async (entryId: string, lotName: string, sheetsNeeded: number) => {
    if (!window.confirm(`⚠️ ยืนยันการลบรายการ: ${lotName} ?\n\nระบบจะลบข้อมูลการสั่งพิมพ์และคืนสต็อคกระดาษ ${sheetsNeeded} ใบกลับเข้าคลัง`)) {
      return;
    }
    try {
      if (!entryId) throw new Error("ไม่พบรหัสอ้างอิงของรายการ (ไม่มี ID)");

      const { error: err2 } = await supabase.from('paper_transactions')
        .delete()
        .eq('reference_id', entryId);

      if (err2) {
        console.error("Failed to delete paper_transaction", err2);
        throw new Error("ไม่สามารถลบประวัติการเบิกกระดาษได้: " + err2.message);
      }


      const { error: err1 } = await supabase.from('print_orders').delete().eq('id', entryId);
      if (err1) throw err1;

      logAction('DELETE', 'dashboard', `ลบคำสั่งพิมพ์ ล็อต ${lotName}`, { entryId, sheetsNeeded });
      alert("✅ ลบรายการสำเร็จ (คืนสต็อคเรียบร้อย)");
      fetchOrders();
    } catch (err: any) {
      console.error("Delete Order Error:", err);
      alert("❌ ลบรายการไม่สำเร็จ: " + (err.message || "เกิดข้อผิดพลาดบางอย่าง"));
    }
  };

  const handleOpenEdit = (entry: any) => {
    setEditingEntry(entry);
    const currentProductId = entry.productId || entry.product_id || entry.products?.id || "";
    const currentProduct = products.find(p => p.id === currentProductId);
    const productLabel = currentProduct
      ? `${currentProduct.name} (${currentProduct.qtyPerA3} ชิ้น/A3)`
      : (entry.productName || entry.products?.name || "");
    setProductSearchQuery(productLabel);
    lastConfirmedProductRef.current = { id: currentProductId, label: productLabel };
    setIsProductDropdownOpen(false);

    // ดึงค่าจริงของรายการนี้ (รองรับทั้ง snake_case จาก DB และ camelCase จากกลุ่มที่ประมวลผลแล้ว)
    const target = entry.target_qty ?? entry.targetQty ?? 0;
    const wasteQty = entry.waste_qty ?? entry.wasteQty ?? 0;
    const wasteA3 = entry.waste_a3 ?? entry.wasteA3 ?? 0;
    const ratio = currentProduct?.qtyPerA3 || entry.products?.qty_per_a3 || 1;

    // คำนวณค่า A3 ดี แบบอัตโนมัติของรายการนี้ (สูตรเดียวกับ editCalculationPreview)
    const baseSheetsForTarget = target > 0 ? Math.ceil(target / ratio) : 0;
    const naturalExcess = target > 0 ? (baseSheetsForTarget * ratio) - target : 0;
    const extraSheetsForWaste = wasteQty > naturalExcess ? Math.ceil((wasteQty - naturalExcess) / ratio) : 0;
    const autoGoodA3ForEntry = baseSheetsForTarget + extraSheetsForWaste;

    // ค่าที่บันทึกไว้จริงในระบบ
    const savedGoodA3 = entry.good_a3 ?? entry.goodA3 ?? ((entry.sheets_needed ?? entry.sheetsNeeded ?? 0) - wasteA3);

    // ส่วนต่างที่เคยกรอกเพิ่มไว้ก่อนหน้า (ถ้าไม่เคยเพิ่มจะได้ 0 → แสดงเป็นช่องว่าง)
    const previousExtraGoodA3 = savedGoodA3 - autoGoodA3ForEntry;

    setEditFormData({
      department: entry.department || "",
      lotName: entry.lot_name || entry.lotName || "",
      paperType: entry.paperType || entry.paper_type || "สติกเกอร์",
      productId: currentProductId,
      targetQty: target ? target.toString() : "",
      goodA3: previousExtraGoodA3 !== 0 ? previousExtraGoodA3.toString() : "",
      wasteQty: wasteQty ? wasteQty.toString() : "",
      wasteQtyRemark: entry.waste_qty_remark || entry.wasteQtyRemark || "",
      wasteA3: wasteA3 ? wasteA3.toString() : "",
      wasteA3Remark: entry.waste_a3_remark || entry.wasteA3Remark || "",
      remark: entry.remark || "",
    });

    setIsEditModalOpen(true);
  };


  const filteredProducts = useMemo(() => {
    if (!productSearchQuery.trim()) return products;
    const q = productSearchQuery.trim().toLowerCase();
    return products.filter(p => p.name.toLowerCase().includes(q));
  }, [products, productSearchQuery]);

  const editCalculationPreview = useMemo(() => {
    if (!editFormData.productId) return null;

    const target = editFormData.targetQty ? parseInt(editFormData.targetQty, 10) : 0;
    const wasteA3 = editFormData.wasteA3 ? parseInt(editFormData.wasteA3, 10) : 0;
    const wasteQty = editFormData.wasteQty ? parseInt(editFormData.wasteQty, 10) : 0;

    if (target <= 0 && wasteA3 <= 0 && wasteQty <= 0) return null;

    const selectedProduct = products.find(p => p.id === editFormData.productId);
    if (!selectedProduct) return null;

    const qtyPerA3 = selectedProduct.qtyPerA3;
    const baseSheetsForTarget = target > 0 ? Math.ceil(target / qtyPerA3) : 0;
    const naturalTotal = baseSheetsForTarget * qtyPerA3;
    const naturalExcess = target > 0 ? (naturalTotal - target) : 0;

    let extraSheetsForWaste = 0;
    if (wasteQty > naturalExcess) {
      extraSheetsForWaste = Math.ceil((wasteQty - naturalExcess) / qtyPerA3);
    }


    // ค่าที่คำนวณอัตโนมัติจากเป้าหมาย/ของเสีย
    const autoGoodA3 = baseSheetsForTarget + extraSheetsForWaste;

    // ชองนี้คือ "จำนวน A3 ดี ที่ต้องการเพิ่ม" — คาที่กรอกจะถูกบวกเพิ่มจากยอดที่คำนวณอัตโนมัติ ไม่ใช่แทนที่
    const extraGoodA3 = editFormData.goodA3 !== "" ? parseInt(editFormData.goodA3, 10) || 0 : 0;
    const goodA3 = autoGoodA3 + extraGoodA3;

    if (target <= 0 && wasteA3 <= 0 && wasteQty <= 0 && goodA3 <= 0) return null;

    const totalPrinted = goodA3 * qtyPerA3;
    const excessQty = Math.max(0, totalPrinted - target - wasteQty);
    const sheetsNeeded = goodA3 + wasteA3;
    return { sheetsNeeded, totalPrinted, excessQty, productName: selectedProduct.name, qtyPerA3, target, wasteA3, wasteQty, goodA3, autoGoodA3, extraGoodA3 };

  }, [editFormData.productId, editFormData.targetQty, editFormData.wasteA3, editFormData.wasteQty, editFormData.goodA3, products]);
  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCalculationPreview || !editingEntry) return;

    if (editCalculationPreview.target === 0 && editCalculationPreview.wasteA3 === 0 && editCalculationPreview.wasteQty === 0) {
      alert("กรุณากรอกจำนวนเป้าหมาย จำนวนชิ้นเสีย หรือ จำนวน A3 เสีย อย่างน้อย 1 ค่า");
      return;
    }

    if (!window.confirm(`⚠️ คุณกำลังจะบันทึกการแก้ไขรายการ Lot: ${editFormData.lotName}\n\nยืนยันที่จะบันทึกการเปลี่ยนแปลงนี้ใช่หรือไม่?`)) {
      return;
    }

    setIsSubmittingEdit(true);
    try {
      const entryId = editingEntry.id || editingEntry.entry_id;

      const { error: pErr } = await supabase.from('print_orders').update({
        department: editFormData.department,
        lot_name: editFormData.lotName,
        product_id: editFormData.productId,
        target_qty: editCalculationPreview.target,
        good_a3: editCalculationPreview.goodA3,
        sheets_needed: editCalculationPreview.sheetsNeeded,
        total_printed: editCalculationPreview.totalPrinted,
        excess_qty: editCalculationPreview.excessQty,
        waste_qty: editCalculationPreview.wasteQty > 0 ? editCalculationPreview.wasteQty : null,
        waste_qty_remark: editFormData.wasteQtyRemark || null,
        waste_a3: editCalculationPreview.wasteA3 > 0 ? editCalculationPreview.wasteA3 : null,
        waste_a3_remark: editFormData.wasteA3Remark || null,
        remark: editFormData.remark || null,
      }).eq('id', entryId);

      if (pErr) throw pErr;

      // ตัดสต็อค: แยกเป็น "กระดาษดี" กับ "กระดาษเสีย" คนละแถว
      // ใช้ reference_id เดิม (= entryId) เหมือนกันทั้งคู่ แยกดวย transaction_category แทน
      const { data: existingGoodTx } = await supabase
        .from('paper_transactions')
        .select('id')
        .eq('reference_id', entryId)
        .eq('transaction_type', 'OUT')
        .or('transaction_category.eq.GOOD,transaction_category.is.null')
        .limit(1)
        .maybeSingle();

      if (existingGoodTx) {
        const { error: txGoodErr } = await supabase.from('paper_transactions').update({
          paper_type: editFormData.paperType,
          qty: editCalculationPreview.goodA3,
          transaction_category: 'GOOD',
          description: `สั่งพิมพ์ล็อต: ${editFormData.lotName} (กระดาษดี, แก้ไข)`
        }).eq('id', existingGoodTx.id);
        if (txGoodErr) console.error("Failed to update good-paper stock", txGoodErr);
      } else {
        const { error: txGoodInsertErr } = await supabase.from('paper_transactions').insert({
          reference_id: entryId,
          transaction_type: 'OUT',
          transaction_category: 'GOOD',
          paper_type: editFormData.paperType,
          qty: editCalculationPreview.goodA3,
          date: editingEntry.date || editingEntry.created_at?.split('T')[0] || new Date().toISOString().split('T')[0],
          description: `สั่งพิมพ์ล็อต: ${editFormData.lotName} (กระดาษดี, แก้ไข)`
        });
        if (txGoodInsertErr) console.error("Failed to insert good-paper stock", txGoodInsertErr);
      }

      if (editCalculationPreview.wasteA3 > 0) {
        const { data: existingWasteTx } = await supabase
          .from('paper_transactions')
          .select('id')
          .eq('reference_id', entryId)
          .eq('transaction_type', 'OUT')
          .eq('transaction_category', 'WASTE')
          .maybeSingle();

        if (existingWasteTx) {
          const { error: txWasteErr } = await supabase.from('paper_transactions').update({
            paper_type: editFormData.paperType,
            qty: editCalculationPreview.wasteA3,
            description: `สั่งพิมพ์ล็อต: ${editFormData.lotName} (กระดาษเสีย, แก้ไข)`
          }).eq('id', existingWasteTx.id);
          if (txWasteErr) console.error("Failed to update waste-paper stock", txWasteErr);
        } else {
          const { error: txWasteInsertErr } = await supabase.from('paper_transactions').insert({
            reference_id: entryId,
            transaction_type: 'OUT',
            transaction_category: 'WASTE',
            paper_type: editFormData.paperType,
            qty: editCalculationPreview.wasteA3,
            date: editingEntry.date || editingEntry.created_at?.split('T')[0] || new Date().toISOString().split('T')[0],
            description: `สั่งพิมพ์ล็อต: ${editFormData.lotName} (กระดาษเสีย, แก้ไข)`
          });
          if (txWasteInsertErr) console.error("Failed to insert waste-paper stock", txWasteInsertErr);
        }
      } else {
        // ไม่มีของเสยแล้ว ลบแถวกระดาษเสียเดิม (ถ้ามี) เพื่อคืนสต็อค
        const { error: txWasteDelErr } = await supabase.from('paper_transactions')
          .delete()
          .eq('reference_id', entryId)
          .eq('transaction_type', 'OUT')
          .eq('transaction_category', 'WASTE');
        if (txWasteDelErr) console.error("Failed to clear waste-paper stock", txWasteDelErr);
      }


      logAction('UPDATE', 'dashboard', `แก้ไขคำสั่งพิมพ์ ล็อต ${editFormData.lotName}`, { entryId });
      alert("✅ บันทึกการแก้ไขสำเร็จ");
      setIsEditModalOpen(false);
      fetchOrders();
    } catch (err: any) {
      alert("❌ บันทึกแก้ไขไม่สำเร็จ: " + err.message);
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    fetchProducts();
    // Fetch current user
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const email = session.user.email || '';
        const displayName =
          session.user.user_metadata?.full_name ||
          session.user.user_metadata?.name ||
          (email ? email.split('@')[0] : 'ผู้ใช้');
        setCurrentUser(displayName);
        setCurrentUserId(session.user.id);
      }
    });

  }, []);

  const fetchProducts = async () => {
    setIsLoadingProducts(true);
    try {
      const PAGE_SIZE = 1000;
      let allData: any[] = [];
      let from = 0;

      while (true) {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .order('name', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        allData = allData.concat(data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      const formattedProducts: Product[] = allData.map(p => ({
        id: p.id,
        name: p.name,
        qtyPerA3: p.qty_per_a3
      }));

      setProducts(formattedProducts);
    } catch (error: any) {
      console.error("Error fetching products:", error);
    } finally {
      setIsLoadingProducts(false);
    }
  };

  const fetchOrders = async () => {
    setIsLoadingOrders(true);
    setOrdersError(null);
    try {

      const PAGE_SIZE = 1000;
      let allData: any[] = [];
      let from = 0;

      while (true) {
        const { data, error } = await supabase
          .from('print_orders')
          .select(`
            *,
            products ( name, qty_per_a3 )
          `)
          .order('date', { ascending: false })
          .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        allData = allData.concat(data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      let allTxData: any[] = [];
      let txFrom = 0;

      while (true) {
        const { data: txData, error: txError } = await supabase
          .from('paper_transactions')
          .select('reference_id, paper_type')
          .eq('transaction_type', 'OUT')
          .range(txFrom, txFrom + PAGE_SIZE - 1);

        if (txError) throw txError;
        if (!txData || txData.length === 0) break;

        allTxData = allTxData.concat(txData);
        if (txData.length < PAGE_SIZE) break;
        txFrom += PAGE_SIZE;
      }

      const paperTypeMap = new Map<string, string>();
      allTxData.forEach((tx: any) => {
        if (tx.reference_id) paperTypeMap.set(tx.reference_id, tx.paper_type);
      });

      const groupedOrders = new Map<string, DashboardOrderGroup>();

      allData.forEach((o: any) => {
        const department = o.department || "-";
        const lotName = o.lot_name;
        const productId = o.product_id;
        const groupKey = `${department}-${lotName}-${productId}`;

        const remarkW = o.waste_qty_remark ? String(o.waste_qty_remark) : "";
        const remarkA3 = o.waste_a3_remark ? String(o.waste_a3_remark) : "";
        const remarkGeneral = o.remark ? String(o.remark) : "";

        if (groupedOrders.has(groupKey)) {
          const existing = groupedOrders.get(groupKey)!;
          existing.targetQty += o.target_qty;
          existing.sheetsNeeded += o.sheets_needed;
          existing.totalPrinted += o.total_printed;
          existing.wasteQty += (o.waste_qty || 0);
          existing.wasteA3 += (o.waste_a3 || 0);
          existing.entries.push({ ...o, paper_type: paperTypeMap.get(o.id) || 'ไม่ระบุ' });
          if (remarkW && !existing.remarks.includes(remarkW)) existing.remarks.push(remarkW);
          if (remarkA3 && !existing.remarks.includes(remarkA3)) existing.remarks.push(remarkA3);
          if (remarkGeneral && !existing.remarks.includes(remarkGeneral)) existing.remarks.push(remarkGeneral);
        } else {
          const initialRemarks: string[] = [];
          if (remarkW) initialRemarks.push(remarkW);
          if (remarkA3) initialRemarks.push(remarkA3);
          if (remarkGeneral) initialRemarks.push(remarkGeneral);

          groupedOrders.set(groupKey, {
            id: groupKey,
            department: department,
            lotName: lotName,
            productName: o.products?.name || "ไม่ทราบชื่อสินค้า",
            targetQty: o.target_qty,
            sheetsNeeded: o.sheets_needed,
            totalPrinted: o.total_printed,
            excessQty: 0,
            wasteQty: (o.waste_qty || 0),
            wasteA3: (o.waste_a3 || 0),
            remarks: initialRemarks,
            productId: productId,
            entries: [{ ...o, paper_type: paperTypeMap.get(o.id) || 'ไม่ระบุ' }],
          });
        }
      });

      const formattedOrders = Array.from(groupedOrders.values()).map(group => {
        const trueExcess = Math.max(0, group.totalPrinted - group.targetQty - group.wasteQty);
        return {
          ...group,
          excessQty: trueExcess
        };
      });

      setPrintOrders(formattedOrders);
    } catch (error: any) {
      console.error("Error fetching print orders:", error);
      setOrdersError("ไม่สามารถโหลดประวัติคำสั่งพิมพ์ได้: " + error.message);
    } finally {
      setIsLoadingOrders(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const handleResetWeekly = async () => {
    if (!window.confirm("⚠️ คำเตือน: คุณต้องการรีเซ็ตประวัติประจำสัปดาห์ใช่หรือไม่?\n\n- ประวัติสั่งพิมพ์ทั้งหมดจะถูกลบ\n- ประวัติสต็อคจะถูกลบและยกยอดคงเหลือปัจจุบันมาให้ใหม่\n- การดำเนินการนี้ไม่สามารถย้อนคืนได้")) {
      return;
    }

    setIsLoadingOrders(true);
    try {
      const response = await fetch('/api/reset-weekly', {
        method: 'POST',
      });
      const result = await response.json();

      if (result.success) {
        alert("✅ รีเซ็ตประวัติประจำสัปดาห์เรียบร้อยแล้ว");
        fetchOrders();
      } else {
        throw new Error(result.error || "เกิดข้อผิดพลาดไม่ทราบสาเหตุ");
      }
    } catch (error: any) {
      alert("❌ รีเซ็ตไม่สำเร็จ: " + error.message);
    } finally {
      setIsLoadingOrders(false);
    }
  };

  const ordersByDepartment = useMemo(() => {
    const grouped: Record<string, DashboardOrderGroup[]> = {};
    printOrders.forEach(order => {
      const dept = order.department || "หน่วยงานอื่นๆ";
      if (!grouped[dept]) {
        grouped[dept] = [];
      }
      grouped[dept].push(order);
    });
    return grouped;
  }, [printOrders]);

  // --- Daily Summary (Today) ---
  const dailySummary = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const summary: Record<string, { sheetsUsed: number; sheetsGood: number; sheetsWaste: number }> = {};
    const byPaperType: Record<string, { sheetsUsed: number; sheetsGood: number; sheetsWaste: number }> = {};
    let totalSheets = 0;
    let totalGood = 0;
    let totalWaste = 0;

    printOrders.forEach(group => {
      group.entries.forEach((entry: any) => {
        const entryDate = entry.date || (entry.created_at ? entry.created_at.split('T')[0] : '');
        if (entryDate === todayStr) {
          const dept = entry.department || 'หน่วยงานอื่นๆ';
          if (!summary[dept]) summary[dept] = { sheetsUsed: 0, sheetsGood: 0, sheetsWaste: 0 };
          const sheets = entry.sheets_needed || 0;
          const waste = entry.waste_a3 || 0;
          summary[dept].sheetsUsed += sheets;
          summary[dept].sheetsGood += (sheets - waste);
          summary[dept].sheetsWaste += waste;
          totalSheets += sheets;
          totalGood += (sheets - waste);
          totalWaste += waste;

          const pt = entry.paper_type || 'ไม่ระบุ';
          if (!byPaperType[pt]) byPaperType[pt] = { sheetsUsed: 0, sheetsGood: 0, sheetsWaste: 0 };
          byPaperType[pt].sheetsUsed += sheets;
          byPaperType[pt].sheetsGood += (sheets - waste);
          byPaperType[pt].sheetsWaste += waste;
        }
      });
    });
    return { byDept: summary, byPaperType, totalSheets, totalGood, totalWaste };
  }, [printOrders]);

  // --- Daily Orders List (Today only) ---
  const dailyOrders = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const todayEntries: Array<{
      id: string;
      department: string;
      lotName: string;
      productName: string;
      productId: string;
      paperType: string;
      targetQty: number;
      sheetsNeeded: number;
      wasteQty: number;
      wasteA3: number;
      excessQty: number;
      createdAt: string;
      wasteQtyRemark?: string;
      wasteA3Remark?: string;
      remark?: string;
    }> = [];

    printOrders.forEach(group => {
      group.entries.forEach((entry: any) => {
        const entryDate = entry.date || (entry.created_at ? entry.created_at.split('T')[0] : '');
        if (entryDate === todayStr) {
          const ratio = entry.products?.qty_per_a3 || 1;
          const target = entry.target_qty || 0;
          const wasteQty = entry.waste_qty || 0;
          const wasteA3 = entry.waste_a3 || 0;
          const sheets = entry.sheets_needed || 0;

          const baseSheetsForTarget = target > 0 ? Math.ceil(target / ratio) : 0;
          const naturalExcess = target > 0 ? (baseSheetsForTarget * ratio) - target : 0;

          const extraSheets = wasteQty > naturalExcess ? Math.ceil((wasteQty - naturalExcess) / ratio) : 0;
          const productiveSheets = baseSheetsForTarget + extraSheets;
          const totalPrinted = productiveSheets * ratio;
          const excess = Math.max(0, totalPrinted - target - wasteQty);
          todayEntries.push({
            id: entry.id,
            department: entry.department || '-',
            lotName: entry.lot_name || '-',
            productName: group.productName,
            productId: entry.product_id || group.productId,
            paperType: entry.paper_type || 'สติกเกอร์',
            targetQty: target,
            sheetsNeeded: sheets,
            wasteQty,
            wasteA3,
            excessQty: excess,
            createdAt: entry.created_at || entry.date || '',
            wasteQtyRemark: entry.waste_qty_remark || undefined,
            wasteA3Remark: entry.waste_a3_remark || undefined,
            remark: entry.remark || undefined,
          });
        }
      });
    });

    return todayEntries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [printOrders]);

  // --- Daily Orders grouped by Paper Type (เพื่อแยกรายการตามประเภทกระดาษใหชัดเจน) ---
  const dailyOrdersByPaperType = useMemo(() => {
    const grouped: Record<string, typeof dailyOrders> = {};
    dailyOrders.forEach(order => {
      const pt = order.paperType || 'ไม่ระบุ';
      if (!grouped[pt]) grouped[pt] = [];
      grouped[pt].push(order);
    });
    // เรียงกลุ่มตามยอด A3 ใช้รวมมากไปน้อย เพื่อให้กระดาษที่ใช้เยอะสุดขึ้นก่อน
    return Object.entries(grouped).sort(([, a], [, b]) => {
      const sumA = a.reduce((s, o) => s + o.sheetsNeeded, 0);
      const sumB = b.reduce((s, o) => s + o.sheetsNeeded, 0);
      return sumB - sumA;
    });
  }, [dailyOrders]);

  // --- Weekly Summary (Per Department) ---
  const weeklySummary = useMemo(() => {
    const summary: Record<string, {
      sheetsUsed: number;
      sheetsGood: number;
      sheetsWaste: number;
      targetQty: number;
      totalPrinted: number;
      wasteQty: number;
      excessQty: number;
    }> = {};
    const byPaperType: Record<string, { sheetsUsed: number; sheetsGood: number; sheetsWaste: number }> = {};

    printOrders.forEach(group => {
      const dept = group.department || 'หน่วยงานอื่นๆ';
      if (!summary[dept]) {
        summary[dept] = { sheetsUsed: 0, sheetsGood: 0, sheetsWaste: 0, targetQty: 0, totalPrinted: 0, wasteQty: 0, excessQty: 0 };
      }
      summary[dept].sheetsUsed += group.sheetsNeeded;
      summary[dept].sheetsGood += (group.sheetsNeeded - group.wasteA3);
      summary[dept].sheetsWaste += group.wasteA3;
      summary[dept].targetQty += group.targetQty;
      summary[dept].totalPrinted += group.totalPrinted;
      summary[dept].wasteQty += group.wasteQty;
      summary[dept].excessQty += group.excessQty;

      group.entries.forEach((entry: any) => {
        const pt = entry.paper_type || 'ไม่ระบุ';
        if (!byPaperType[pt]) byPaperType[pt] = { sheetsUsed: 0, sheetsGood: 0, sheetsWaste: 0 };
        const sheets = entry.sheets_needed || 0;
        const waste = entry.waste_a3 || 0;
        byPaperType[pt].sheetsUsed += sheets;
        byPaperType[pt].sheetsGood += (sheets - waste);
        byPaperType[pt].sheetsWaste += waste;
      });
    });
    return { byDept: summary, byPaperType };
  }, [printOrders]);

  // --- Daily Paper History (Week to Date) ---
  const dailyPaperHistory = useMemo(() => {
    const history: Record<string, Record<string, number>> = {};

    printOrders.forEach(group => {
      group.entries.forEach((entry: any) => {
        const date = entry.date || (entry.created_at ? entry.created_at.split('T')[0] : '');
        if (!date) return;

        const pt = entry.paper_type || 'ไม่ระบุ';
        if (!history[date]) history[date] = {};
        if (!history[date][pt]) history[date][pt] = 0;

        history[date][pt] += (entry.sheets_needed || 0);
      });
    });

    const sortedDates = Object.keys(history).sort((a, b) => b.localeCompare(a));
    return sortedDates.map(date => ({
      dateTag: date,
      dateLabel: new Date(date).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      types: Object.entries(history[date]).map(([name, qty]) => ({ name, qty })),
      totalSheets: Object.values(history[date]).reduce((a, b) => a + b, 0)
    }));
  }, [printOrders]);

  // --- Excel Export ---
  const handleExportExcel = async () => {
    const ejWb = new ExcelJS.Workbook();
    ejWb.creator = 'WorkTracker';
    ejWb.created = new Date();

    const allDates = printOrders.flatMap(g => g.entries.map((e: any) => e.date as string)).filter(Boolean);
    const minDate = allDates.length ? allDates.reduce((a, b) => a < b ? a : b) : null;
    const maxDate = allDates.length ? allDates.reduce((a, b) => a > b ? a : b) : null;
    const fmtDate = (d: string) => new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const orderDateRange = minDate && maxDate
      ? (minDate === maxDate ? fmtDate(minDate) : `${fmtDate(minDate)} - ${fmtDate(maxDate)}`)
      : '-';
    const todayTH = new Date().toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const addHeaderToSheet = (ws: ExcelJS.Worksheet, title: string, subtitleLabel: string, subtitleVal: string) => {
      const row = ws.getRow(1);
      row.values = [title, `${subtitleLabel}: ${subtitleVal}`];
      row.getCell(1).font = { bold: true, size: 12 };
      ws.addRow([]);
    };

    const { data: txAll } = await supabase
      .from('paper_transactions')
      .select('paper_type, transaction_type, qty, reference_id');

    const stockMap: Record<string, { totalIn: number; totalOutAllTime: number; thisWeekOut: number }> = {};
    (txAll || []).forEach((tx: any) => {
      const pt = tx.paper_type || 'ไม่ระบุ';
      if (!stockMap[pt]) stockMap[pt] = { totalIn: 0, totalOutAllTime: 0, thisWeekOut: 0 };
      if (tx.transaction_type === 'IN') stockMap[pt].totalIn += tx.qty;
      else stockMap[pt].totalOutAllTime += tx.qty;
    });

    Object.entries(weeklySummary.byPaperType).forEach(([pt, data]) => {
      if (!stockMap[pt]) stockMap[pt] = { totalIn: 0, totalOutAllTime: 0, thisWeekOut: 0 };
      stockMap[pt].thisWeekOut = data.sheetsUsed;
    });

    const stockRows = Object.entries(stockMap).map(([pt, s]) => ({
      'ประเภทกระดาษ': pt,
      'รับเข้ารวม (ใบ)': s.totalIn,
      'ใช้ออกรวมสัปดาห์นี้ (ใบ)': s.thisWeekOut,
      'คงเหลือในระบบ (ใบ)': s.totalIn - s.totalOutAllTime,
    }));
    stockRows.push({
      'ประเภทกระดาษ': 'รวมทั้งหมด',
      'รับเข้ารวม (ใบ)': stockRows.reduce((s, r) => s + (r['รับเข้ารวม (ใบ)'] as number), 0),
      'ใช้ออกรวมสัปดาห์นี้ (ใบ)': stockRows.reduce((s, r) => s + (r['ใช้ออกรวมสัปดาห์นี้ (ใบ)'] as number), 0),
      'คงเหลือในระบบ (ใบ)': stockRows.reduce((s, r) => s + (r['คงเหลือในระบบ (ใบ)'] as number), 0),
    });

    const wsStock = ejWb.addWorksheet('สต็อคกระดาษ');
    addHeaderToSheet(wsStock, `สรุปยอดสต็อคกระดาษ A3`, `ณ วันที่`, todayTH);
    wsStock.columns = [{ width: 20 }, { width: 18 }, { width: 22 }, { width: 20 }];
    const headerRowStock = wsStock.getRow(3);
    headerRowStock.values = ['ประเภทกระดาษ', 'รับเข้ารวม (ใบ)', 'ใช้ออกรวมสัปดาห์นี้ (ใบ)', 'คงเหลือในระบบ (ใบ)'];
    headerRowStock.font = { bold: true };
    stockRows.forEach(row => {
      const r = wsStock.addRow([row['ประเภทกระดาษ'], row['รับเข้ารวม (ใบ)'], row['ใช้ออกรวมสัปดาห์นี้ (ใบ)'], row['คงเหลือในระบบ (ใบ)']]);
      if (row['ประเภทกระดาษ'] === 'รวมทั้งหมด') r.font = { bold: true };
    });

    const dailyRows = Object.entries(dailySummary.byDept).map(([dept, d]) => ({
      'หน่วยงาน': dept,
      'A3 ใช้รวม (ใบ)': d.sheetsUsed,
      'A3 ดี (ใบ)': d.sheetsGood,
      'A3 เสีย (ใบ)': d.sheetsWaste,
    }));
    dailyRows.push({
      'หน่วยงาน': 'รวมทั้งหมด',
      'A3 ใช้รวม (ใบ)': dailyRows.reduce((s, r) => s + (r['A3 ใช้รวม (ใบ)'] as number), 0),
      'A3 ดี (ใบ)': dailyRows.reduce((s, r) => s + (r['A3 ดี (ใบ)'] as number), 0),
      'A3 เสีย (ใบ)': dailyRows.reduce((s, r) => s + (r['A3 เสีย (ใบ)'] as number), 0),
    });

    const wsDaily = ejWb.addWorksheet('สรุปประจำวัน');
    addHeaderToSheet(wsDaily, `สรุปยอดสั่งพิมพ์ราย`, `วันที่`, todayTH);
    wsDaily.columns = [{ width: 20 }, { width: 18 }, { width: 14 }, { width: 14 }];
    const headerRowDaily = wsDaily.getRow(3);
    headerRowDaily.values = ['หน่วยงาน', 'A3 ใช้รวม (ใบ)', 'A3 ดี (ใบ)', 'A3 เสีย (ใบ)'];
    headerRowDaily.font = { bold: true };
    dailyRows.forEach(row => {
      const r = wsDaily.addRow([row['หน่วยงาน'], row['A3 ใช้รวม (ใบ)'], row['A3 ดี (ใบ)'], row['A3 เสีย (ใบ)']]);
      if (row['หน่วยงาน'] === 'รวมทั้งหมด') r.font = { bold: true };
    });

    const weeklyRows = Object.entries(weeklySummary.byDept).map(([dept, d]) => ({
      'หน่วยงาน': dept,
      'ยอดสั่ง (ชิ้น)': d.targetQty,
      'A3 ใช้รวม (ใบ)': d.sheetsUsed,
      'A3 ดี (ใบ)': d.sheetsGood,
      'A3 เสีย (ใบ)': d.sheetsWaste,
      'ชิ้นเสีย': d.wasteQty,
      'ส่วนเกิน (ชิ้น)': d.excessQty,
    }));
    const wTotals = Object.values(weeklySummary.byDept);
    weeklyRows.push({
      'หน่วยงาน': 'รวมทั้งหมด',
      'ยอดสั่ง (ชิ้น)': wTotals.reduce((s, d) => s + d.targetQty, 0),
      'A3 ใช้รวม (ใบ)': wTotals.reduce((s, d) => s + d.sheetsUsed, 0),
      'A3 ดี (ใบ)': wTotals.reduce((s, d) => s + d.sheetsGood, 0),
      'A3 เสีย (ใบ)': wTotals.reduce((s, d) => s + d.sheetsWaste, 0),
      'ชิ้นเสีย': wTotals.reduce((s, d) => s + d.wasteQty, 0),
      'ส่วนเกิน (ชิ้น)': wTotals.reduce((s, d) => s + d.excessQty, 0),
    });

    const ws1 = ejWb.addWorksheet('สรุปรายสัปดาห์ (สัปดาห์ปัจจุบัน)');
    addHeaderToSheet(ws1, `สรุปยอดสั่งพิมพ์ราย`, `ช่วงวันที่`, orderDateRange);
    ws1.columns = [{ width: 20 }, { width: 16 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 12 }, { width: 18 }];
    const headerRow1 = ws1.getRow(3);
    headerRow1.values = ['หน่วยงาน', 'ยอดสั่ง (ชิ้น)', 'A3 ใช้รวม (ใบ)', 'A3 ดี (ใบ)', 'A3 เสีย (ใบ)', 'ชิ้นเสีย', 'ส่วนเกิน (ชิ้น)'];
    headerRow1.font = { bold: true };
    weeklyRows.forEach(row => {
      const r = ws1.addRow([row['หน่วยงาน'], row['ยอดสั่ง (ชิ้น)'], row['A3 ใช้รวม (ใบ)'], row['A3 ดี (ใบ)'], row['A3 เสีย (ใบ)'], row['ชิ้นเสีย'], row['ส่วนเกิน (ชิ้น)']]);
      if (row['หน่วยงาน'] === 'รวมทั้งหมด') r.font = { bold: true };
    });

    const wsDailyPaper = ejWb.addWorksheet('ประวัติใช้กระดาษรายวัน');
    addHeaderToSheet(wsDailyPaper, `ประวัติการใช้กระดาษรายวัน (A3)`, `สัปดาห์ปัจจุบัน`, ``);
    wsDailyPaper.columns = [{ width: 30 }, { width: 25 }, { width: 18 }];
    const headerRowDailyPaper = wsDailyPaper.getRow(3);
    headerRowDailyPaper.values = ['วันที่', 'ประเภทกระดาษ', 'จำนวนใช้ (ใบ)'];
    headerRowDailyPaper.font = { bold: true };

    dailyPaperHistory.forEach(day => {
      day.types.forEach((t) => {
        wsDailyPaper.addRow([day.dateLabel, t.name, t.qty]);
      });
      const summaryRow = wsDailyPaper.addRow(['รวมเฉพาะวัน', '', day.totalSheets]);
      summaryRow.font = { italic: true, bold: true };
      summaryRow.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F7FF' } };
      wsDailyPaper.addRow([]);
    });

    const buildDetailRows = (groups: typeof printOrders) => {
      const rows: Record<string, string | number>[] = groups.map(group => ({
        'หน่วยงาน': group.department || '-',
        'Lot': group.lotName,
        'สินค้า': group.productName,
        'เป้าหมาย (ชิ้น)': group.targetQty,
        'พิมพ์จริง (ชิ้น)': group.totalPrinted,
        'A3 ใช้ (ใบ)': group.sheetsNeeded,
        'ชิ้นเสีย': group.wasteQty,
        'A3 เสีย (ใบ)': group.wasteA3,
        'ส่วนเกิน (ชิ้น)': group.excessQty,
        'หมายเหตุ': group.remarks.join(', '),
      }));
      rows.push({
        'หน่วยงาน': 'รวมทั้งหมด', 'Lot': '', 'สินค้า': '',
        'เป้าหมาย (ชิ้น)': groups.reduce((s, g) => s + g.targetQty, 0),
        'พิมพ์จริง (ชิ้น)': groups.reduce((s, g) => s + g.totalPrinted, 0),
        'A3 ใช้ (ใบ)': groups.reduce((s, g) => s + g.sheetsNeeded, 0),
        'ชิ้นเสีย': groups.reduce((s, g) => s + g.wasteQty, 0),
        'A3 เสีย (ใบ)': groups.reduce((s, g) => s + g.wasteA3, 0),
        'ส่วนเกิน (ชิ้น)': groups.reduce((s, g) => s + g.excessQty, 0),
        'หมายเหตุ': '',
      });
      return rows;
    };

    const departments = [...new Set(printOrders.map(g => g.department || '-'))].sort();
    departments.forEach(dept => {
      const deptGroups = printOrders.filter(g => (g.department || '-') === dept);
      const deptDates = deptGroups.flatMap(g => g.entries.map((e: any) => e.date as string)).filter(Boolean);
      const dMin = deptDates.length ? deptDates.reduce((a, b) => a < b ? a : b) : null;
      const dMax = deptDates.length ? deptDates.reduce((a, b) => a > b ? a : b) : null;
      const deptRange = dMin && dMax
        ? (dMin === dMax ? fmtDate(dMin) : `${fmtDate(dMin)} - ${fmtDate(dMax)}`)
        : '-';

      let wsName = dept.substring(0, 31).replace(/[\\/*?:\[\]]/g, '');
      const wsDept = ejWb.addWorksheet(wsName);

      addHeaderToSheet(wsDept, `รายละเอียดคำสั่งพิมพ์ — ${dept}`, `ช่วงวันที่`, deptRange);
      wsDept.columns = [
        { width: 16 }, { width: 14 }, { width: 22 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 16 }, { width: 28 }
      ];

      const headerRowDept = wsDept.getRow(3);
      headerRowDept.values = ['หน่วยงาน', 'Lot', 'สินค้า', 'เป้าหมาย (ชิ้น)', 'พิมพ์จริง (ชิ้น)', 'A3 ใช้ (ใบ)', 'ชิ้นเสีย', 'A3 เสีย (ใบ)', 'ส่วนเกิน (ชิ้น)', 'หมายเหตุ'];
      headerRowDept.font = { bold: true };

      const deptRows = buildDetailRows(deptGroups);
      deptRows.forEach((row: any) => {
        const r = wsDept.addRow([row['หน่วยงาน'], row['Lot'], row['สินค้า'], row['เป้าหมาย (ชิ้น)'], row['พิมพ์จริง (ชิ้น)'], row['A3 ใช้ (ใบ)'], row['ชิ้นเสีย'], row['A3 เสีย (ใบ)'], row['ส่วนเกิน (ชิ้น)'], row['หมายเหตุ']]);
        if (row['หน่วยงาน'] === 'รวมทั้งหมด') r.font = { bold: true };
      });
    });

    const generateChartImage = (): Promise<ArrayBuffer> => {
      return new Promise((resolve) => {
        const deptData = Object.entries(weeklySummary.byDept)
          .map(([name, d]) => ({ name, sheets: d.sheetsUsed, target: d.targetQty }))
          .sort((a, b) => b.sheets - a.sheets);

        const canvas = document.createElement('canvas');
        const W = 800, H = 500;
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d')!;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);

        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('สรุปยอดสั่งพิมพ์ A3 แยกหน่วยงาน (7 วัน)', W / 2, 32);

        if (deptData.length === 0) {
          ctx.fillStyle = '#94a3b8';
          ctx.font = '14px sans-serif';
          ctx.fillText('ไม่มีข้อมูล', W / 2, H / 2);
          canvas.toBlob(blob => { blob!.arrayBuffer().then(resolve); }, 'image/png');
          return;
        }

        const maxVal = Math.max(...deptData.map(d => d.sheets), 1);
        const chartLeft = 150, chartRight = W - 40;
        const chartTop = 60, chartBottom = H - 80;
        const barAreaHeight = chartBottom - chartTop;
        const barHeight = Math.min(40, (barAreaHeight / deptData.length) * 0.65);
        const barGap = (barAreaHeight - barHeight * deptData.length) / (deptData.length + 1);
        const colors = ['#0ea5e9', '#06b6d4', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#6366f1'];

        deptData.forEach((d, i) => {
          const y = chartTop + barGap * (i + 1) + barHeight * i;
          const barW = (d.sheets / maxVal) * (chartRight - chartLeft);
          ctx.fillStyle = colors[i % colors.length];
          ctx.beginPath();
          const r = 4;
          ctx.moveTo(chartLeft, y);
          ctx.lineTo(chartLeft + barW - r, y);
          ctx.quadraticCurveTo(chartLeft + barW, y, chartLeft + barW, y + r);
          ctx.lineTo(chartLeft + barW, y + barHeight - r);
          ctx.quadraticCurveTo(chartLeft + barW, y + barHeight, chartLeft + barW - r, y + barHeight);
          ctx.lineTo(chartLeft, y + barHeight);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#334155';
          ctx.font = '13px sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(d.name, chartLeft - 10, y + barHeight / 2 + 4);
          ctx.fillStyle = '#0f172a';
          ctx.font = 'bold 13px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(`${d.sheets.toLocaleString()} ใบ`, chartLeft + barW + 8, y + barHeight / 2 + 4);
        });

        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(chartLeft, chartTop - 5);
        ctx.lineTo(chartLeft, chartBottom + 5);
        ctx.stroke();
        ctx.fillStyle = '#64748b';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('จำนวน A3 ที่ใช้ (ใบ)', W / 2, H - 20);

        canvas.toBlob(blob => { blob!.arrayBuffer().then(resolve); }, 'image/png');
      });
    };

    const fileName = `WorkTracker_${minDate || todayTH}_${maxDate || todayTH}.xlsx`;
    const chartImageBuffer = await generateChartImage();
    const chartSheet = ejWb.addWorksheet('กราฟสรุป');
    chartSheet.getColumn(1).width = 5;
    const imageId = ejWb.addImage({ buffer: chartImageBuffer, extension: 'png' });
    chartSheet.addImage(imageId, { tl: { col: 0.5, row: 1 }, ext: { width: 800, height: 500 } });

    const finalBuffer = await ejWb.xlsx.writeBuffer();
    const blob = new Blob([finalBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, fileName);
    logAction('EXPORT', 'dashboard', `ส่งออก Excel ช่วงวันที่ ${orderDateRange}`, { fileName, dateRange: orderDateRange });
  };

  // ── Helper: กำหนดสี badge ตามประเภทกระดาษ (hash ชื่อ → สีจากชุดที่กำหนด ไม่ต้อง hardcode รายชื่อกระดาษ) ──
  const PAPER_TYPE_COLOR_PALETTE = [
    { solid: 'bg-sky-600', light: 'bg-sky-50', text: 'text-sky-700', accent: 'border-sky-500' },
    { solid: 'bg-emerald-600', light: 'bg-emerald-50', text: 'text-emerald-700', accent: 'border-emerald-500' },
    { solid: 'bg-amber-600', light: 'bg-amber-50', text: 'text-amber-700', accent: 'border-amber-500' },
    { solid: 'bg-violet-600', light: 'bg-violet-50', text: 'text-violet-700', accent: 'border-violet-500' },
    { solid: 'bg-rose-600', light: 'bg-rose-50', text: 'text-rose-700', accent: 'border-rose-500' },
    { solid: 'bg-cyan-600', light: 'bg-cyan-50', text: 'text-cyan-700', accent: 'border-cyan-500' },
    { solid: 'bg-lime-600', light: 'bg-lime-50', text: 'text-lime-700', accent: 'border-lime-500' },
    { solid: 'bg-fuchsia-600', light: 'bg-fuchsia-50', text: 'text-fuchsia-700', accent: 'border-fuchsia-500' },
  ];

  const getPaperTypeStyle = (paperType: string) => {
    if (!paperType || paperType === 'ไม่ระบุ') {
      return { solid: 'bg-slate-500', light: 'bg-slate-50', text: 'text-slate-600', accent: 'border-slate-400' };
    }
    let hash = 0;
    for (let i = 0; i < paperType.length; i++) {
      hash = (hash * 31 + paperType.charCodeAt(i)) >>> 0;
    }
    return PAPER_TYPE_COLOR_PALETTE[hash % PAPER_TYPE_COLOR_PALETTE.length];
  };

  // ── Helper: กำหนดสี badge ตามหน่วยงานโดยเฉพาะ ──
  const getDepartmentStyle = (dept: string) => {
    if (dept === 'ZT') {
      return { solid: 'bg-emerald-600', light: 'bg-emerald-50', text: 'text-emerald-700', accent: 'border-emerald-500' }; // สีเขียว
    }
    if (dept === '13 ไร่') {
      return { solid: 'bg-blue-600', light: 'bg-blue-50', text: 'text-blue-700', accent: 'border-blue-500' }; // สีน้ำเงิน
    }
    // สำหรับ "หน่วยงานอื่นๆ" หรือกรณีไม่ระบุ
    return { solid: 'bg-slate-600', light: 'bg-slate-50', text: 'text-slate-700', accent: 'border-slate-500' };
  };


  // ── Helper: คำนวณส่วนเกินต่อ entry ──
  const calcExcess = (entry: any): number => {
    const ratio = entry.products?.qty_per_a3 || 1;
    const target = entry.target_qty || 0;
    const wasteQty = entry.waste_qty || 0;

    const baseSheetsForTarget = target > 0 ? Math.ceil(target / ratio) : 0;
    const naturalExcess = target > 0 ? (baseSheetsForTarget * ratio) - target : 0;

    const extraSheets = wasteQty > naturalExcess
      ? Math.ceil((wasteQty - naturalExcess) / ratio)
      : 0;
    const productiveSheets = baseSheetsForTarget + extraSheets;
    const totalPrinted = productiveSheets * ratio;
    return Math.max(0, totalPrinted - target - wasteQty);
  };

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">

        {/* Print Orders Section */}
        <div className="print-orders-section glass-panel w-full">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 px-6 py-6 mb-6 border-b border-slate-200/70">
            <div>
              <h2 className="text-2xl font-bold text-slate-800">สรุปยอดสั่งพิมพ์</h2>
              <p className="text-sm text-slate-400 mt-1">สัปดาห์ปัจจุบัน</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleExportExcel}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 hover:shadow-md transition-all shadow-sm"
              >
                <span className="text-base">📄</span> ส่งออก Excel
              </button>
            </div>
          </div>


          {/* === Today's Orders List (แยกตามประเภทกระดาษ) === */}
          <div className="mb-8">
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              <span className="text-2xl">📝</span> รายการสั่งพิมพ์วันนี้
              <span className="text-sm font-normal text-slate-500">({new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })})</span>
            </h3>
            {dailyOrders.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-sm bg-white/50 rounded-xl border border-slate-200/40">
                ยังไม่มีรายการสั่งพิมพ์ในวันนี้
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {/* === รวมประจำวัน (ด้านบน) === */}
                <div className="rounded-xl border border-slate-300 bg-gradient-to-r from-slate-50 to-slate-100 shadow-sm overflow-hidden">
                  {/* แถวสรุปรวม */}
                  <div className="px-5 py-3.5 flex flex-wrap justify-between items-center gap-2 border-b border-slate-200/70">
                    <span className="font-bold text-slate-800 text-base flex items-center gap-2">
                      <span className="text-lg">📊</span> รวมทั้งหมดวันนี้
                    </span>
                    <div className="flex flex-wrap gap-4 text-sm">
                      <span className="text-slate-600">เป้าหมาย <strong>{dailyOrders.reduce((s, o) => s + o.targetQty, 0).toLocaleString()}</strong></span>
                      <span className="text-sky-600">A3 ใช้ <strong>{dailyOrders.reduce((s, o) => s + o.sheetsNeeded, 0).toLocaleString()} ใบ</strong></span>
                      <span className="text-red-500">A3 เสีย <strong>{dailyOrders.reduce((s, o) => s + o.wasteA3, 0).toLocaleString()} ใบ</strong></span>
                      <span className="text-amber-600">ส่วนเกิน <strong>{dailyOrders.reduce((s, o) => s + o.excessQty, 0).toLocaleString()}</strong></span>
                    </div>
                  </div>
                  {/* แยกตามประเภทกระดาษ */}
                  {dailyOrdersByPaperType.length > 0 && (
                    <div className="px-5 py-3 flex flex-wrap gap-3">
                      {dailyOrdersByPaperType.map(([paperType, ptOrders]) => {
                        const ptStyle = getPaperTypeStyle(paperType);
                        const ptSheets = ptOrders.reduce((s, o) => s + o.sheetsNeeded, 0);
                        const ptWaste = ptOrders.reduce((s, o) => s + o.wasteA3, 0);
                        return (
                          <div key={paperType} className={`flex items-center gap-2.5 px-3.5 py-2 rounded-lg border ${ptStyle.accent} ${ptStyle.light}`}>
                            <span className={`w-2.5 h-2.5 rounded-full ${ptStyle.solid} flex-shrink-0`}></span>
                            <span className={`text-xs font-semibold ${ptStyle.text} truncate max-w-[200px]`}>{paperType}</span>
                            <span className="text-xs font-bold text-sky-600">{ptSheets.toLocaleString()} ใบ</span>
                            {ptWaste > 0 && <span className="text-xs font-semibold text-red-500">(เสีย {ptWaste})</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {dailyOrdersByPaperType.map(([paperType, orders]) => {
                  const style = getPaperTypeStyle(paperType);
                  const groupTarget = orders.reduce((s, o) => s + o.targetQty, 0);
                  const groupSheets = orders.reduce((s, o) => s + o.sheetsNeeded, 0);
                  const groupWasteQty = orders.reduce((s, o) => s + o.wasteQty, 0);
                  const groupWasteA3 = orders.reduce((s, o) => s + o.wasteA3, 0);
                  const groupExcess = orders.reduce((s, o) => s + o.excessQty, 0);

                  return (
                    <div key={paperType} className={`overflow-hidden rounded-xl border-l-4 ${style.accent} border-t border-r border-b border-slate-200/60 bg-white shadow-md`}>
                      <div className={`flex items-center justify-between px-5 py-3.5 ${style.solid}`}>
                        <div className="flex items-center gap-2.5">
                          <span className="text-lg leading-none">📄</span>
                          <span className="font-bold text-sm text-white tracking-wide">{paperType}</span>
                          <span className="text-xs text-white/70">({orders.length} รายการ)</span>
                        </div>
                        <span className="font-bold text-sm text-white bg-white/20 px-3 py-1 rounded-full">{groupSheets.toLocaleString()} ใบ</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                          <thead>
                            <tr className={`${style.light} border-b border-slate-200/60 text-slate-500 text-xs uppercase tracking-wider font-semibold`}>

                              <th className="py-3 px-4">หน่วยงาน</th>
                              <th className="py-3 px-4">Lot / สินค้า</th>
                              <th className="py-3 px-4 text-right">เป้าหมาย</th>
                              <th className="py-3 px-4 text-right text-sky-600">A3 ใช้</th>
                              <th className="py-3 px-4 text-right text-red-500">ชิ้นเสีย</th>
                              <th className="py-3 px-4 text-right text-red-400">A3 เสีย</th>
                              <th className="py-3 px-4 text-right text-amber-600">ส่วนเกิน</th>
                              <th className="py-3 px-4 text-slate-500 min-w-[140px]">หมายเหตุ</th>
                              <th className="py-3 px-4 text-center w-24">จัดการ</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {orders.map(order => (
                              <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                                <td className="py-3 px-4 text-slate-600">{order.department}</td>
                                <td className="py-3 px-4">
                                  <div className="font-semibold text-slate-800">{order.lotName}</div>
                                  <div className="text-xs text-slate-400">{order.productName}</div>
                                </td>
                                <td className="py-3 px-4 text-right font-medium text-slate-700">{order.targetQty.toLocaleString()}</td>
                                <td className="py-3 px-4 text-right font-bold text-sky-600">{order.sheetsNeeded.toLocaleString()} ใบ</td>
                                <td className="py-3 px-4 text-right">
                                  {order.wasteQty > 0 ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-700">{order.wasteQty.toLocaleString()} ชิ้น</span>
                                  ) : <span className="text-slate-300">-</span>}
                                </td>
                                <td className="py-3 px-4 text-right">
                                  {order.wasteA3 > 0 ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-50 text-red-500">{order.wasteA3.toLocaleString()} ใบ</span>
                                  ) : <span className="text-slate-300">-</span>}
                                </td>
                                <td className="py-3 px-4 text-right font-bold text-amber-500">
                                  {order.excessQty > 0 ? order.excessQty.toLocaleString() : <span className="text-slate-300">-</span>}
                                </td>
                                <td className="py-3 px-4 text-xs text-slate-500 max-w-[180px]">
                                  {!order.remark && !order.wasteQtyRemark && !order.wasteA3Remark
                                    ? <span className="text-slate-300">-</span>
                                    : <div className="flex flex-col gap-0.5">
                                      {order.wasteQtyRemark && (
                                        <span className="text-red-600">{order.wasteQtyRemark} (หมายเหตุจำนวนดวง)</span>
                                      )}
                                      {order.wasteA3Remark && (
                                        <span className="text-red-500">{order.wasteA3Remark} (หมายเหตุของจำนวน A3)</span>
                                      )}
                                      {order.remark && (
                                        <span className="text-amber-700 font-medium">{order.remark} (หมายเหตุรายละเอียดของคำสั่ง)</span>
                                      )}
                                    </div>
                                  }
                                </td>
                                <td className="py-3 px-4 text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleOpenEdit(order); }}
                                      className="px-2.5 py-1.5 text-[11px] font-semibold text-sky-600 bg-sky-50 hover:bg-sky-500 hover:text-white rounded-lg transition-all shadow-sm border border-sky-200/50 flex items-center gap-1.5"
                                      title="แก้ไขรายการ"
                                    >
                                      <span>✏️</span> แก้ไข
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleDeleteEntry(order.id, order.lotName, order.sheetsNeeded); }}
                                      className="px-2.5 py-1.5 text-[11px] font-semibold text-red-500 bg-red-50 hover:bg-red-500 hover:text-white rounded-lg transition-all shadow-sm border border-red-200/50 flex items-center gap-1.5"
                                      title="ลบรายการ"
                                    >
                                      <span>🗑️</span> ลบ
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-300">
                              <td className="py-3 px-4" colSpan={2}>รวม ({paperType})</td>
                              <td className="py-3 px-4 text-right">{groupTarget.toLocaleString()}</td>
                              <td className="py-3 px-4 text-right text-sky-600">{groupSheets.toLocaleString()} ใบ</td>
                              <td className="py-3 px-4 text-right text-red-600">{groupWasteQty > 0 ? `${groupWasteQty.toLocaleString()} ชิ้น` : '-'}</td>
                              <td className="py-3 px-4 text-right text-red-500">{groupWasteA3 > 0 ? `${groupWasteA3.toLocaleString()} ใบ` : '-'}</td>
                              <td className="py-3 px-4 text-right text-amber-600">{groupExcess.toLocaleString()}</td>
                              <td className="py-3 px-4"></td>
                              <td className="py-3 px-4"></td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  );
                })}

              </div>
            )}
          </div>

          {/* === Weekly Department Summary === */}
          <div className="mb-8">
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              <span className="text-2xl">📊</span> สรุปยอดรายสัปดาห์แยกหน่วยงาน
              <span className="text-sm font-normal text-slate-500">(สัปดาห์ปัจจุบัน)</span>
            </h3>
            {Object.keys(weeklySummary.byDept).length > 0 ? (
              <div className="flex flex-col gap-4">
                {Object.entries(weeklySummary.byDept).map(([dept, data]) => {
                  const style = getDepartmentStyle(dept);
                  return (
                    <div key={dept} className={`overflow-hidden rounded-xl border-l-4 ${style.accent} border-t border-r border-b border-slate-200/60 bg-white shadow-md`}>
                      <div className={`flex items-center justify-between px-5 py-3.5 ${style.solid}`}>
                        <span className="font-bold text-sm text-white tracking-wide">{dept}</span>
                        <span className="font-bold text-sm text-white bg-white/20 px-3 py-1 rounded-full">{data.sheetsUsed.toLocaleString()} ใบ</span>
                      </div>
                      <div className={`grid grid-cols-2 sm:grid-cols-5 gap-3 px-5 py-4 ${style.light}`}>
                        <div>
                          <div className="text-xs text-slate-500">ยอดสั่ง</div>
                          <div className="font-bold text-slate-800">{data.targetQty.toLocaleString()} ชิ้น</div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">A3 ดี</div>
                          <div className="font-bold text-emerald-600">{data.sheetsGood.toLocaleString()} ใบ</div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">A3 เสีย</div>
                          <div className="font-bold text-red-600">{data.sheetsWaste > 0 ? `${data.sheetsWaste.toLocaleString()} ใบ` : '-'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">ชิ้นเสีย</div>
                          <div className="font-bold text-red-600">{data.wasteQty > 0 ? `${data.wasteQty.toLocaleString()} ชิ้น` : '-'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">ส่วนเกิน</div>
                          <div className="font-bold text-amber-600">{data.excessQty.toLocaleString()}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="rounded-xl border border-slate-300 bg-slate-100 px-5 py-3 flex flex-wrap justify-between items-center gap-2">
                  <span className="font-bold text-slate-800">รวมทั้งหมด</span>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <span className="text-slate-600">ยอดสั่ง <strong>{Object.values(weeklySummary.byDept).reduce((s, d) => s + d.targetQty, 0).toLocaleString()}</strong></span>
                    <span className="text-sky-600">A3 ใช้รวม <strong>{Object.values(weeklySummary.byDept).reduce((s, d) => s + d.sheetsUsed, 0).toLocaleString()} ใบ</strong></span>
                    <span className="text-emerald-600">A3 ดี <strong>{Object.values(weeklySummary.byDept).reduce((s, d) => s + d.sheetsGood, 0).toLocaleString()} ใบ</strong></span>
                    <span className="text-red-600">A3 เสีย <strong>{Object.values(weeklySummary.byDept).reduce((s, d) => s + d.sheetsWaste, 0).toLocaleString()} ใบ</strong></span>
                    <span className="text-amber-600">ส่วนเกิน <strong>{Object.values(weeklySummary.byDept).reduce((s, d) => s + d.excessQty, 0).toLocaleString()}</strong></span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-slate-400 text-sm bg-white/50 rounded-xl border border-slate-200/40">ยังไม่มีข้อมูลในสัปดาห์นี้</div>
            )}

            {Object.keys(weeklySummary.byPaperType).length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                  <span>📃</span> แยกตามประเภทกระดาษ (สัปดาห์ปัจจุบัน)
                </h4>
                <div className="flex flex-col gap-3">
                  {Object.entries(weeklySummary.byPaperType).map(([pt, data]) => {
                    const style = getPaperTypeStyle(pt);
                    return (
                      <div key={pt} className={`overflow-hidden rounded-xl border-l-4 ${style.accent} border-t border-r border-b border-slate-200/60 bg-white shadow-sm`}>
                        <div className={`flex items-center justify-between px-5 py-3 ${style.solid}`}>
                          <span className="font-bold text-sm text-white tracking-wide">{pt}</span>
                          <span className="font-bold text-sm text-white bg-white/20 px-3 py-1 rounded-full">{data.sheetsUsed.toLocaleString()} ใบ</span>
                        </div>
                        <div className={`grid grid-cols-2 gap-3 px-5 py-3 ${style.light}`}>
                          <div>
                            <div className="text-xs text-slate-500">A3 ดี</div>
                            <div className="font-bold text-emerald-600">{data.sheetsGood.toLocaleString()} ใบ</div>
                          </div>
                          <div>
                            <div className="text-xs text-slate-500">A3 เสีย</div>
                            <div className="font-bold text-red-600">{data.sheetsWaste.toLocaleString()} ใบ</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* === Daily Paper History (Week History) === */}
          <div className="mb-8">
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              <span className="text-2xl">🗓️</span> สรุปยอดใช้กระดาษรายวัน (A3)
              <span className="text-sm font-normal text-slate-500">(สัปดาห์ปัจจุบัน)</span>
            </h3>
            {dailyPaperHistory.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {dailyPaperHistory.map((day) => (
                  <div key={day.dateTag} className="overflow-hidden rounded-xl border border-slate-200/60 bg-white/70 backdrop-blur-md shadow-sm flex flex-col">
                    <div className="bg-slate-50 border-b border-slate-200 p-3 flex justify-between items-center">
                      <span className="font-bold text-slate-700 text-sm">{day.dateLabel}</span>
                      <span className="text-sky-600 font-bold text-sm bg-sky-50 px-2 py-0.5 rounded-full border border-sky-100">{day.totalSheets.toLocaleString()} ใบ</span>
                    </div>
                    <div className="flex-1 divide-y divide-slate-100/50">
                      {day.types.map((t) => {
                        const style = getPaperTypeStyle(t.name);
                        return (
                          <div key={t.name} className={`flex items-center justify-between px-4 py-2 ${style.light}`}>
                            <span className={`flex items-center gap-2 text-xs font-medium ${style.text}`}>
                              <span className={`w-2 h-2 rounded-full ${style.solid}`}></span>
                              {t.name}
                            </span>
                            <span className="text-xs font-bold text-slate-800">{t.qty.toLocaleString()} ใบ</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-slate-400 text-sm bg-white/50 rounded-xl border border-slate-200/40">ยังไม่มีประวัติการใช้กระดาษในสัปดาห์นี้</div>
            )}
          </div>

          <div className="logs-list-container">
            {ordersError && (
              <div className="p-3 text-sm text-red-500 bg-red-900/20 border border-red-500/50 rounded-lg">
                {ordersError}
              </div>
            )}
            {isLoadingOrders && printOrders.length === 0 ? (
              <div className="text-center py-8 text-muted">กำลังโหลดข้อมูล...</div>
            ) : Object.keys(ordersByDepartment).length > 0 ? (
              Object.entries(ordersByDepartment).map(([dept, orders]) => {
                const deptStyle = getDepartmentStyle(dept);
                const deptTotalSheets = orders.reduce((s, o) => s + o.sheetsNeeded, 0);
                return (
                  <div key={dept} className={`department-block mb-10 last:mb-0 overflow-hidden rounded-xl border-l-4 ${deptStyle.accent} border-t border-r border-b border-slate-200/60 bg-white shadow-md`}>
                    <div className={`flex items-center justify-between px-5 py-3.5 ${deptStyle.solid}`}>
                      <span className="font-bold text-lg text-white tracking-wide">{dept}</span>
                      <span className="font-bold text-sm text-white bg-white/20 px-3 py-1 rounded-full">{deptTotalSheets.toLocaleString()} ใบ</span>
                    </div>

                    <div className="overflow-x-auto bg-white/70 backdrop-blur-md">
                      <table className="w-full text-left whitespace-nowrap min-w-[1000px]">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200/60 text-slate-500 text-xs uppercase tracking-wider font-semibold">
                            <th className="py-4 px-6 w-1/4">Lot: สินค้า</th>
                            <th className="py-4 px-6 text-right w-32">เป้ารวม</th>
                            <th className="py-4 px-6 text-right text-sky-600 w-32">A3 ใช้รวม</th>
                            <th className="py-4 px-6 text-right text-emerald-600 w-32">A3 ดีสะสม</th>
                            <th className="py-4 px-6 text-right text-amber-600 w-32">ส่วนเกิน</th>
                            <th className="py-4 px-6 text-right text-red-600 w-32">ของเสียสะสม</th>
                            <th className="py-4 px-6 min-w-[150px]">หมายเหตุ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {orders.map((order) => {
                            const hasWaste = order.wasteQty > 0 || order.wasteA3 > 0;
                            const isExpanded = expandedGroups[order.id];
                            return (
                              <React.Fragment key={order.id}>
                                <tr
                                  className={`group cursor-pointer transition-colors hover:bg-slate-50/80 ${isExpanded ? 'bg-slate-50/50' : 'bg-transparent'}`}
                                  onClick={() => toggleGroup(order.id)}
                                >
                                  <td className="py-4 px-6">
                                    <div className="flex items-center gap-3">
                                      <span className={`text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                                      <div>
                                        <div className="font-bold text-slate-800 text-base">{order.lotName}</div>
                                        <div className="text-slate-500 text-sm mt-0.5">{order.productName}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-4 px-6 text-right font-medium text-slate-700">{order.targetQty.toLocaleString()}</td>
                                  <td className="py-4 px-6 text-right font-bold text-sky-500">{order.sheetsNeeded.toLocaleString()} ใบ</td>
                                  <td className="py-4 px-6 text-right font-bold text-emerald-500">{(order.sheetsNeeded - order.wasteA3).toLocaleString()} ใบ</td>
                                  <td className="py-4 px-6 text-right font-bold text-amber-500">{order.excessQty.toLocaleString()} ชิ้น</td>
                                  <td className="py-4 px-6 text-right">
                                    {hasWaste ? (
                                      <div className="flex flex-col items-end gap-1">
                                        {order.wasteQty > 0 && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-700">{order.wasteQty} ชิ้น</span>}
                                        {order.wasteA3 > 0 && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-700">{order.wasteA3} ใบ (A3)</span>}
                                      </div>
                                    ) : (
                                      <span className="text-slate-300">-</span>
                                    )}
                                  </td>
                                  <td className="py-4 px-6 text-sm text-slate-500 max-w-[200px] truncate">
                                    {order.remarks.length > 0 ? (
                                      <ul className="list-disc list-inside">
                                        {order.remarks.map((r, i) => <li key={i} className="truncate">{r}</li>)}
                                      </ul>
                                    ) : "-"}
                                  </td>
                                </tr>
                                {isExpanded && (
                                  <tr>
                                    <td colSpan={8} className="p-0 border-b border-transparent">
                                      <div className="bg-slate-50/80 px-8 py-5 shadow-inner">
                                        <div className="flex items-center justify-between mb-3 border-b border-slate-200 pb-2">
                                          <h4 className="text-sm font-bold text-slate-700">รายการย่อย</h4>
                                        </div>
                                        <div className="overflow-x-auto">
                                          <table className="w-full text-sm text-left">
                                            <thead>
                                              <tr className="text-xs text-slate-500 font-medium">
                                                <th className="py-2 px-3 w-40">วันที่-เวลา</th>
                                                <th className="py-2 px-3 text-right">เป้ารวม</th>
                                                <th className="py-2 px-3 text-right">A3 ใช้รวม</th>
                                                <th className="py-2 px-3 text-right">ของเสีย</th>
                                                <th className="py-2 px-3 text-right text-amber-600">ส่วนเกิน</th>
                                                <th className="py-2 px-3">หมายเหตุ</th>
                                                <th className="py-2 px-3 text-center w-24">จัดการ</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-200/60">
                                              {order.entries.map((entry: any) => {
                                                const entryExcess = calcExcess(entry);
                                                return (
                                                  <tr key={entry.id} className="hover:bg-white transition-colors">
                                                    <td className="py-2.5 px-3 text-slate-600">
                                                      {new Date(entry.created_at).toLocaleString('th-TH', { hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                    </td>
                                                    <td className="py-2.5 px-3 text-right font-medium text-slate-700">{entry.target_qty}</td>
                                                    <td className="py-2.5 px-3 text-right text-sky-500 font-semibold">{entry.sheets_needed} ใบ</td>
                                                    <td className="py-2.5 px-3 text-right">
                                                      {(entry.waste_qty > 0 || entry.waste_a3 > 0) ? (
                                                        <div className="flex flex-col items-end gap-1 text-xs">
                                                          {entry.waste_qty > 0 && <span className="text-red-500 font-medium">{entry.waste_qty} ชิ้น</span>}
                                                          {entry.waste_a3 > 0 && <span className="text-red-500 font-medium">{entry.waste_a3} ใบ (A3)</span>}
                                                        </div>
                                                      ) : (
                                                        <span className="text-slate-300">-</span>
                                                      )}
                                                    </td>
                                                    <td className="py-2.5 px-3 text-right">
                                                      {entryExcess > 0
                                                        ? <span className="font-bold text-amber-500">{entryExcess.toLocaleString()} ชิ้น</span>
                                                        : <span className="text-slate-300">-</span>
                                                      }
                                                    </td>
                                                    <td className="py-2.5 px-3 text-xs text-slate-500 max-w-[200px]">
                                                      {entry.waste_qty_remark && <div className="truncate text-slate-600">• {entry.waste_qty_remark} (หมายเหตุของจำนวนชิ้น)</div>}
                                                      {entry.waste_a3_remark && <div className="truncate text-slate-600">• {entry.waste_a3_remark} (หมายเหตุของจำนวน A3)</div>}
                                                      {entry.remark && <div className="truncate text-amber-700 font-medium">• {entry.remark} (หมายเหตุรายละเอียดของคำสั่ง)</div>}
                                                    </td>
                                                    <td className="py-2.5 px-3 text-center">
                                                      <div className="flex items-center justify-center gap-2">
                                                        <button
                                                          onClick={(e) => { e.stopPropagation(); handleOpenEdit(entry); }}
                                                          className="px-2 py-1 text-[11px] font-medium text-sky-600 bg-sky-50 hover:bg-sky-500 hover:text-white rounded-md transition-all shadow-sm border border-sky-200/30 flex items-center gap-1"
                                                          title="แก้ไขรายการ"
                                                        >
                                                          <span>✏️</span> แก้ไข
                                                        </button>
                                                        <button
                                                          onClick={(e) => { e.stopPropagation(); handleDeleteEntry(entry.id, entry.lot_name, entry.sheets_needed); }}
                                                          className="px-2 py-1 text-[11px] font-medium text-red-500 bg-red-50 hover:bg-red-500 hover:text-white rounded-md transition-all shadow-sm border border-red-200/30 flex items-center gap-1"
                                                          title="ลบรายการ"
                                                        >
                                                          <span>🗑️</span> ลบ
                                                        </button>
                                                      </div>
                                                    </td>
                                                  </tr>
                                                );
                                              })}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
            ) : null}

            {printOrders.length === 0 && !isLoadingOrders && !ordersError && (
              <div className="empty-state text-muted text-center pt-8 pb-8">
                ยังไม่มีคำสั่งพิมพ์ในระบบ <br />ไปที่เมนูสั่งพิมพ์เพื่อเริ่มการคำนวณ
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 mb-12 flex justify-center">
          <button
            onClick={handleResetWeekly}
            className="btn btn-outline border-red-500/50 text-red-400 hover:bg-red-500/10 flex items-center gap-2"
            disabled={isLoadingOrders}
          >
            <span>⚠️</span>
            {isLoadingOrders ? "กำลังรีเซ็ต..." : "กดรีเซ็ตประจำสัปดาห์ (ลบประวัติ & ยกยอดสต็อค)"}
          </button>
        </div>

        {isEditModalOpen && editingEntry && typeof document !== 'undefined' && createPortal(
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-fade-in">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center sticky top-0 bg-white/95 backdrop-blur z-10">
                <h3 className="text-xl font-bold text-slate-800">
                  ✏️ แก้ไขรายการ (Lot: {editingEntry.lotName || editingEntry.lot_name})
                </h3>
                <button
                  onClick={() => setIsEditModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={submitEdit} className="p-6">
                <div className="bg-slate-50 p-4 rounded-xl mb-6 border border-slate-100">
                  <h4 className="text-sm font-bold text-slate-700 mb-3 uppercase tracking-wider">ข้อมูลสินค้า</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1">หน่วยงาน</label>
                      <select
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                        value={editFormData.department}
                        onChange={(e) => setEditFormData({ ...editFormData, department: e.target.value })}
                        required
                      >
                        <option value="" disabled>เลือกหน่วยงาน...</option>
                        <option value="ZT">ZT</option>
                        <option value="13 ไร่">13 ไร่</option>
                        <option value="หน่วยงานอื่นๆ">หน่วยงานอื่นๆ</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1">LOT / รหัสสินค้า</label>
                      <input
                        type="text"
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500"
                        value={editFormData.lotName}
                        onChange={(e) => setEditFormData({ ...editFormData, lotName: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1">ประเภทกระดาษ</label>
                      <select
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500"
                        value={editFormData.paperType}
                        onChange={(e) => setEditFormData({ ...editFormData, paperType: e.target.value })}
                        required
                      >
                        {PAPER_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1">สินค้า</label>
                      <div className="relative">
                        <input
                          type="text"
                          className="w-full px-4 py-2 pr-9 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500"
                          placeholder="พิมพ์ชื่อสินค้าเพื่อค้นหา..."
                          value={productSearchQuery}
                          onChange={(e) => {
                            setProductSearchQuery(e.target.value);
                            setIsProductDropdownOpen(true);
                            setEditFormData({ ...editFormData, productId: "" });
                          }}
                          onFocus={() => setIsProductDropdownOpen(true)}
                          onBlur={() => {
                            setTimeout(() => {
                              setIsProductDropdownOpen(false);
                              setEditFormData(prev => {
                                if (prev.productId) return prev;
                                setProductSearchQuery(lastConfirmedProductRef.current.label);
                                return { ...prev, productId: lastConfirmedProductRef.current.id };
                              });
                            }, 150);
                          }}
                          required
                        />

                        {editFormData.productId && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditFormData({ ...editFormData, productId: "" });
                              setProductSearchQuery("");
                              setIsProductDropdownOpen(false);
                            }}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 z-10"
                          >
                            ✕
                          </button>
                        )}

                        {isProductDropdownOpen && (
                          <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
                            {filteredProducts.length > 0 ? (
                              filteredProducts.map(p => (
                                <div
                                  key={p.id}
                                  onClick={() => {
                                    const label = `${p.name} (${p.qtyPerA3} ชิ้น/A3)`;
                                    setEditFormData({ ...editFormData, productId: p.id });
                                    setProductSearchQuery(label);
                                    lastConfirmedProductRef.current = { id: p.id, label };
                                    setIsProductDropdownOpen(false);
                                  }}
                                  className={`px-4 py-2 text-sm cursor-pointer hover:bg-sky-50 ${editFormData.productId === p.id ? 'bg-sky-50 font-semibold text-sky-700' : 'text-slate-700'}`}
                                >
                                  {p.name} <span className="text-slate-400">({p.qtyPerA3} ชิ้น/A3)</span>
                                </div>
                              ))
                            ) : (
                              <div className="px-4 py-2 text-sm text-slate-400">ไม่พบสินค้าที่ค้นหา</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-slate-600 mb-1">เป้าหมายที่ต้องการ (ชิ้น)</label>
                      <input
                        type="number"
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500 text-lg font-bold"
                        value={editFormData.targetQty}
                        onChange={(e) => setEditFormData({ ...editFormData, targetQty: e.target.value })}
                        min="0"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-slate-600 mb-1">
                        เพิ่มจำนวน A3 ดี (ใบ)
                        <span className="text-xs font-normal text-slate-400 ml-1">
                          — เว้นว่างถ้าไม่ต้องการเพิ่ม{editCalculationPreview ? ` (ระบบคำนวณอัตโนมัติอยู่แล้ว ${editCalculationPreview.autoGoodA3} ใบ)` : ""}
                        </span>
                      </label>
                      <input
                        type="number"
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 text-lg font-bold"
                        value={editFormData.goodA3}
                        onChange={(e) => setEditFormData({ ...editFormData, goodA3: e.target.value })}
                        placeholder="0"
                        min="0"
                      />
                    </div>

                  </div>
                </div>


                <div className="bg-red-50/50 p-4 rounded-xl mb-6 border border-red-100">
                  <h4 className="text-sm font-bold text-red-600 mb-3 uppercase tracking-wider">บันทึกของเสีย</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1">ชิ้นเสีย (ชิ้น)</label>
                      <input
                        type="number"
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-red-500"
                        value={editFormData.wasteQty}
                        onChange={(e) => setEditFormData({ ...editFormData, wasteQty: e.target.value })}
                        min="0"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1">หมายเหตุ (ชิ้นเสีย)</label>
                      <input
                        type="text"
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-red-500"
                        value={editFormData.wasteQtyRemark}
                        onChange={(e) => setEditFormData({ ...editFormData, wasteQtyRemark: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1">A3 เสีย (ใบ)</label>
                      <input
                        type="number"
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-red-500"
                        value={editFormData.wasteA3}
                        onChange={(e) => setEditFormData({ ...editFormData, wasteA3: e.target.value })}
                        min="0"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1">หมายเหตุ (A3 เสีย)</label>
                      <input
                        type="text"
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-red-500"
                        value={editFormData.wasteA3Remark}
                        onChange={(e) => setEditFormData({ ...editFormData, wasteA3Remark: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-amber-50/50 p-4 rounded-xl mb-6 border border-amber-100">
                  <h4 className="text-sm font-bold text-amber-700 mb-3 uppercase tracking-wider">หมายเหตุ (ทั่วไป)</h4>
                  <input
                    type="text"
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-400"
                    placeholder="เช่น งานด่วน, รอลูกค้ายืนยัน"
                    value={editFormData.remark}
                    onChange={(e) => setEditFormData({ ...editFormData, remark: e.target.value })}
                  />
                </div>

                {editCalculationPreview && (
                  <div className="bg-sky-50 p-4 rounded-xl mb-6 border border-sky-100 flex justify-between items-center">
                    <div>
                      <div className="text-sm text-slate-500">A3 ที่ต้องใช้ <strong className="text-sky-600 text-lg ml-1">{editCalculationPreview.sheetsNeeded} ใบ</strong></div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-slate-500">ผลผลิตสุทธิ <strong className="text-emerald-600 text-lg ml-1">{editCalculationPreview.totalPrinted} ชิ้น</strong></div>
                      {editCalculationPreview.excessQty > 0 && <div className="text-xs text-amber-500">มีส่วนเกิน +{editCalculationPreview.excessQty}</div>}
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="px-6 py-2.5 rounded-lg font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                    disabled={isSubmittingEdit}
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 rounded-lg font-bold text-white bg-sky-500 hover:bg-sky-600 transition-colors disabled:opacity-50 flex items-center gap-2"
                    disabled={isSubmittingEdit}
                  >
                    {isSubmittingEdit && <span className="animate-spin text-lg">↻</span>}
                    บันทึกการแก้ไข
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      </div>
    </div>
  );
}