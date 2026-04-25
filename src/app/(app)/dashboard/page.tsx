"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
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
    paperType: "สติกเกอร์",
    productId: "",
    targetQty: "",
    wasteQty: "",
    wasteQtyRemark: "",
    wasteA3: "",
    wasteA3Remark: "",
    remark: "",
  });
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  const handleDeleteEntry = async (entryId: string, lotName: string, sheetsNeeded: number) => {
    if (!window.confirm(`⚠️ ยืนยันการลบรายการ: ${lotName} ?\n\nระบบจะลบข้อมูลการสั่งพิมพ์และคืนสต็อคกระดาษ ${sheetsNeeded} ใบกลับเข้าคลัง`)) {
      return;
    }
    try {
      if (!entryId) throw new Error("ไม่พบรหัสอ้างอิงของรายการ (ไม่มี ID)");

      const { error: err2 } = await supabase.from('paper_transactions').delete().eq('reference_id', entryId);
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
    setEditFormData({
      department: entry.department || "",
      lotName: entry.lot_name || entry.lotName || "",
      paperType: entry.paperType || entry.paper_type || "สติกเกอร์",
      productId: entry.productId || entry.product_id || entry.products?.id || "",
      targetQty: entry.target_qty?.toString() || entry.targetQty?.toString() || "",
      wasteQty: entry.waste_qty?.toString() || entry.wasteQty?.toString() || "",
      wasteQtyRemark: entry.waste_qty_remark || entry.wasteQtyRemark || "",
      wasteA3: entry.waste_a3?.toString() || entry.wasteA3?.toString() || "",
      wasteA3Remark: entry.waste_a3_remark || entry.wasteA3Remark || "",
      remark: entry.remark || "",
    });
    setIsEditModalOpen(true);
  };

  const editCalculationPreview = useMemo(() => {
    if (!editFormData.productId || !editFormData.targetQty) return null;
    const selectedProduct = products.find(p => p.id === editFormData.productId);
    const target = parseInt(editFormData.targetQty, 10);
    const wasteA3 = editFormData.wasteA3 ? parseInt(editFormData.wasteA3, 10) : 0;
    const wasteQty = editFormData.wasteQty ? parseInt(editFormData.wasteQty, 10) : 0;

    if (!selectedProduct || isNaN(target) || target <= 0) return null;
    const qtyPerA3 = selectedProduct.qtyPerA3;
    const baseSheetsForTarget = Math.ceil(target / qtyPerA3);
    const naturalTotal = baseSheetsForTarget * qtyPerA3;
    const naturalExcess = naturalTotal - target;

    let extraSheetsForWaste = 0;
    if (wasteQty > naturalExcess) {
      extraSheetsForWaste = Math.ceil((wasteQty - naturalExcess) / qtyPerA3);
    }
    const productiveSheets = baseSheetsForTarget + extraSheetsForWaste;
    const totalPrinted = productiveSheets * qtyPerA3;
    const excessQty = Math.max(0, totalPrinted - target - wasteQty);
    const sheetsNeeded = productiveSheets + wasteA3;

    return { sheetsNeeded, totalPrinted, excessQty, productName: selectedProduct.name, qtyPerA3 };
  }, [editFormData.productId, editFormData.targetQty, editFormData.wasteA3, editFormData.wasteQty, products]);

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCalculationPreview || !editingEntry) return;

    setIsSubmittingEdit(true);
    try {
      const entryId = editingEntry.id || editingEntry.entry_id;

      const { error: pErr } = await supabase.from('print_orders').update({
        department: editFormData.department,
        lot_name: editFormData.lotName,
        product_id: editFormData.productId,
        target_qty: parseInt(editFormData.targetQty, 10),
        sheets_needed: editCalculationPreview.sheetsNeeded,
        total_printed: editCalculationPreview.totalPrinted,
        excess_qty: editCalculationPreview.excessQty,
        waste_qty: editFormData.wasteQty ? parseInt(editFormData.wasteQty, 10) : null,
        waste_qty_remark: editFormData.wasteQtyRemark || null,
        waste_a3: editFormData.wasteA3 ? parseInt(editFormData.wasteA3, 10) : null,
        waste_a3_remark: editFormData.wasteA3Remark || null,
        remark: editFormData.remark || null,
      }).eq('id', entryId);

      if (pErr) throw pErr;

      const { error: txErr } = await supabase.from('paper_transactions').update({
        paper_type: editFormData.paperType,
        qty: editCalculationPreview.sheetsNeeded,
        description: `สั่งพิมพ์ล็อต: ${editFormData.lotName} (แก้ไข)`
      }).eq('reference_id', entryId).eq('transaction_type', 'OUT');

      if (txErr) console.error("Failed to update stock logic", txErr);

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
      const current = new Date();
      const day = current.getDay();
      const diff = current.getDate() - day + (day === 0 ? -6 : 1);
      const startOfWeek = new Date(current.setDate(diff));
      const dateString = startOfWeek.toISOString().split('T')[0];

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
          .gte('date', dateString)
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
          .gte('date', dateString)
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
          const naturalExcess = (Math.ceil(target / ratio) * ratio) - target;
          const extraSheets = wasteQty > naturalExcess ? Math.ceil((wasteQty - naturalExcess) / ratio) : 0;
          const productiveSheets = Math.ceil(target / ratio) + extraSheets;
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

  // ── Helper: คำนวณส่วนเกินต่อ entry ──
  const calcExcess = (entry: any): number => {
    const ratio = entry.products?.qty_per_a3 || 1;
    const target = entry.target_qty || 0;
    const wasteQty = entry.waste_qty || 0;
    const naturalExcess = (Math.ceil(target / ratio) * ratio) - target;
    const extraSheets = wasteQty > naturalExcess
      ? Math.ceil((wasteQty - naturalExcess) / ratio)
      : 0;
    const productiveSheets = Math.ceil(target / ratio) + extraSheets;
    const totalPrinted = productiveSheets * ratio;
    return Math.max(0, totalPrinted - target - wasteQty);
  };

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">

        {/* Print Orders Section */}
        <div className="print-orders-section glass-panel w-full">
          <div className="section-header">
            <h2>สรุปยอดสั่งพิมพ์ (สัปดาห์ปัจจุบัน)</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={handleExportExcel}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 transition-colors shadow-sm"
              >
                <span>📄</span> ส่งออก Excel
              </button>
              <Link href="/orders" className="text-sm text-accent-primary hover:underline">+ สั่งพิมพ์ใหม่</Link>
            </div>
          </div>

          {/* === Daily A3 Summary (Today) === */}
          <div className="mb-8">
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              <span className="text-2xl">📋</span> สรุปยอดกระดาษ A3 ประจำวัน
              <span className="text-sm font-normal text-slate-500">({new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })})</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div className="rounded-xl border border-sky-200 bg-sky-50/80 backdrop-blur-sm p-5 text-center">
                <div className="text-xs uppercase tracking-wider text-sky-600 font-semibold mb-1">A3 ใช้รวมวันนี้</div>
                <div className="text-3xl font-bold text-sky-600">{dailySummary.totalSheets.toLocaleString()}</div>
                <div className="text-sm text-sky-500 mt-0.5">ใบ</div>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 backdrop-blur-sm p-5 text-center">
                <div className="text-xs uppercase tracking-wider text-emerald-600 font-semibold mb-1">A3 ดี</div>
                <div className="text-3xl font-bold text-emerald-600">{dailySummary.totalGood.toLocaleString()}</div>
                <div className="text-sm text-emerald-500 mt-0.5">ใบ</div>
              </div>
              <div className="rounded-xl border border-red-200 bg-red-50/80 backdrop-blur-sm p-5 text-center">
                <div className="text-xs uppercase tracking-wider text-red-600 font-semibold mb-1">A3 เสีย</div>
                <div className="text-3xl font-bold text-red-500">{dailySummary.totalWaste.toLocaleString()}</div>
                <div className="text-sm text-red-400 mt-0.5">ใบ</div>
              </div>
            </div>
            {Object.keys(dailySummary.byDept).length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200/60 bg-white/70 backdrop-blur-md shadow-sm">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200/60 text-slate-500 text-xs uppercase tracking-wider font-semibold">
                      <th className="py-3 px-5">หน่วยงาน</th>
                      <th className="py-3 px-5 text-right text-sky-600">A3 ใช้รวม</th>
                      <th className="py-3 px-5 text-right text-emerald-600">A3 ดี</th>
                      <th className="py-3 px-5 text-right text-red-600">A3 เสีย</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.entries(dailySummary.byDept).map(([dept, data]) => (
                      <tr key={dept} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-5 font-semibold text-slate-800">{dept}</td>
                        <td className="py-3 px-5 text-right font-bold text-sky-500">{data.sheetsUsed.toLocaleString()} ใบ</td>
                        <td className="py-3 px-5 text-right font-bold text-emerald-500">{data.sheetsGood.toLocaleString()} ใบ</td>
                        <td className="py-3 px-5 text-right font-bold text-red-500">{data.sheetsWaste.toLocaleString()} ใบ</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {Object.keys(dailySummary.byDept).length === 0 && (
              <div className="text-center py-6 text-slate-400 text-sm bg-white/50 rounded-xl border border-slate-200/40">ยังไม่มีข้อมูลการสั่งพิมพ์ของวันนี้</div>
            )}

            {Object.keys(dailySummary.byPaperType).length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                  <span>📃</span> แยกตามประเภทกระดาษ (วันนี้)
                </h4>
                <div className="overflow-x-auto rounded-xl border border-slate-200/60 bg-white/70 backdrop-blur-md shadow-sm">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200/60 text-slate-500 text-xs uppercase tracking-wider font-semibold">
                        <th className="py-3 px-5">ประเภทกระดาษ</th>
                        <th className="py-3 px-5 text-right text-sky-600">A3 ใช้รวม</th>
                        <th className="py-3 px-5 text-right text-emerald-600">A3 ดี</th>
                        <th className="py-3 px-5 text-right text-red-600">A3 เสีย</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {Object.entries(dailySummary.byPaperType).map(([pt, data]) => (
                        <tr key={pt} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-5 font-semibold text-slate-800">{pt}</td>
                          <td className="py-3 px-5 text-right font-bold text-sky-500">{data.sheetsUsed.toLocaleString()} ใบ</td>
                          <td className="py-3 px-5 text-right font-bold text-emerald-500">{data.sheetsGood.toLocaleString()} ใบ</td>
                          <td className="py-3 px-5 text-right font-bold text-red-500">{data.sheetsWaste.toLocaleString()} ใบ</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* === Today's Orders List === */}
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
              <div className="overflow-x-auto rounded-xl border border-slate-200/60 bg-white/70 backdrop-blur-md shadow-sm">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200/60 text-slate-500 text-xs uppercase tracking-wider font-semibold">
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
                    {dailyOrders.map(order => (
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
                      <td className="py-3 px-4" colSpan={2}>รวม</td>
                      <td className="py-3 px-4 text-right">{dailyOrders.reduce((s, o) => s + o.targetQty, 0).toLocaleString()}</td>
                      <td className="py-3 px-4 text-right text-sky-600">{dailyOrders.reduce((s, o) => s + o.sheetsNeeded, 0).toLocaleString()} ใบ</td>
                      <td className="py-3 px-4 text-right text-red-600">{dailyOrders.reduce((s, o) => s + o.wasteQty, 0) > 0 ? `${dailyOrders.reduce((s, o) => s + o.wasteQty, 0).toLocaleString()} ชิ้น` : '-'}</td>
                      <td className="py-3 px-4 text-right text-red-500">{dailyOrders.reduce((s, o) => s + o.wasteA3, 0) > 0 ? `${dailyOrders.reduce((s, o) => s + o.wasteA3, 0).toLocaleString()} ใบ` : '-'}</td>
                      <td className="py-3 px-4 text-right text-amber-600">{dailyOrders.reduce((s, o) => s + o.excessQty, 0).toLocaleString()}</td>
                      <td className="py-3 px-4"></td>
                      <td className="py-3 px-4"></td>
                    </tr>
                  </tfoot>
                </table>
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
              <div className="overflow-x-auto rounded-xl border border-slate-200/60 bg-white/70 backdrop-blur-md shadow-sm">
                <table className="w-full text-sm text-left min-w-[800px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200/60 text-slate-500 text-xs uppercase tracking-wider font-semibold">
                      <th className="py-3 px-5">หน่วยงาน</th>
                      <th className="py-3 px-5 text-right">ยอดสั่ง (ชิ้น)</th>
                      <th className="py-3 px-5 text-right text-sky-600">A3 ใช้รวม</th>
                      <th className="py-3 px-5 text-right text-emerald-600">A3 ดี</th>
                      <th className="py-3 px-5 text-right text-red-600">A3 เสีย</th>
                      <th className="py-3 px-5 text-right text-red-600">ชิ้นเสีย</th>
                      <th className="py-3 px-5 text-right text-amber-600">ส่วนเกิน (ชิ้น)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.entries(weeklySummary.byDept).map(([dept, data]) => (
                      <tr key={dept} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-5"><span className="font-bold text-slate-800">{dept}</span></td>
                        <td className="py-3 px-5 text-right font-medium text-slate-700">{data.targetQty.toLocaleString()}</td>
                        <td className="py-3 px-5 text-right font-bold text-sky-500">{data.sheetsUsed.toLocaleString()} ใบ</td>
                        <td className="py-3 px-5 text-right font-bold text-emerald-500">{data.sheetsGood.toLocaleString()} ใบ</td>
                        <td className="py-3 px-5 text-right">
                          {data.sheetsWaste > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-700">{data.sheetsWaste.toLocaleString()} ใบ</span>
                          ) : <span className="text-slate-300">-</span>}
                        </td>
                        <td className="py-3 px-5 text-right">
                          {data.wasteQty > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-700">{data.wasteQty.toLocaleString()} ชิ้น</span>
                          ) : <span className="text-slate-300">-</span>}
                        </td>
                        <td className="py-3 px-5 text-right font-bold text-amber-500">{data.excessQty.toLocaleString()}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-300">
                      <td className="py-3 px-5">รวมทั้งหมด</td>
                      <td className="py-3 px-5 text-right">{Object.values(weeklySummary.byDept).reduce((s, d) => s + d.targetQty, 0).toLocaleString()}</td>
                      <td className="py-3 px-5 text-right text-sky-600">{Object.values(weeklySummary.byDept).reduce((s, d) => s + d.sheetsUsed, 0).toLocaleString()} ใบ</td>
                      <td className="py-3 px-5 text-right text-emerald-600">{Object.values(weeklySummary.byDept).reduce((s, d) => s + d.sheetsGood, 0).toLocaleString()} ใบ</td>
                      <td className="py-3 px-5 text-right text-red-600">{Object.values(weeklySummary.byDept).reduce((s, d) => s + d.sheetsWaste, 0).toLocaleString()} ใบ</td>
                      <td className="py-3 px-5 text-right text-red-600">{Object.values(weeklySummary.byDept).reduce((s, d) => s + d.wasteQty, 0).toLocaleString()} ชิ้น</td>
                      <td className="py-3 px-5 text-right text-amber-600">{Object.values(weeklySummary.byDept).reduce((s, d) => s + d.excessQty, 0).toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-6 text-slate-400 text-sm bg-white/50 rounded-xl border border-slate-200/40">ยังไม่มีข้อมูลในสัปดาห์นี้</div>
            )}

            {Object.keys(weeklySummary.byPaperType).length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                  <span>📃</span> แยกตามประเภทกระดาษ (สัปดาห์ปัจจุบัน)
                </h4>
                <div className="overflow-x-auto rounded-xl border border-slate-200/60 bg-white/70 backdrop-blur-md shadow-sm">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200/60 text-slate-500 text-xs uppercase tracking-wider font-semibold">
                        <th className="py-3 px-5">ประเภทกระดาษ</th>
                        <th className="py-3 px-5 text-right text-sky-600">A3 ใช้รวม</th>
                        <th className="py-3 px-5 text-right text-emerald-600">A3 ดี</th>
                        <th className="py-3 px-5 text-right text-red-600">A3 เสีย</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {Object.entries(weeklySummary.byPaperType).map(([pt, data]) => (
                        <tr key={pt} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-5 font-semibold text-slate-800">{pt}</td>
                          <td className="py-3 px-5 text-right font-bold text-sky-500">{data.sheetsUsed.toLocaleString()} ใบ</td>
                          <td className="py-3 px-5 text-right font-bold text-emerald-500">{data.sheetsGood.toLocaleString()} ใบ</td>
                          <td className="py-3 px-5 text-right font-bold text-red-500">{data.sheetsWaste.toLocaleString()} ใบ</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                    <div className="flex-1">
                      <table className="w-full text-xs text-left">
                        <thead>
                          <tr className="bg-white/50 border-b border-slate-100 text-slate-400 text-[10px] uppercase tracking-wider font-semibold">
                            <th className="py-2 px-4">ประเภทกระดาษ</th>
                            <th className="py-2 px-4 text-right">จำนวน (ใบ)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100/50">
                          {day.types.map((t) => (
                            <tr key={t.name} className="hover:bg-slate-50/50 transition-colors">
                              <td className="py-2 px-4 text-slate-700 font-medium">{t.name}</td>
                              <td className="py-2 px-4 text-right font-bold text-slate-800">{t.qty.toLocaleString()} ใบ</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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
              Object.entries(ordersByDepartment).map(([dept, orders]) => (
                <div key={dept} className="department-block mb-10 last:mb-0">
                  <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <span className="bg-accent-subtle/40 px-3 py-1 rounded-md text-accent-primary border border-accent-primary/20">{dept}</span>
                  </h3>

                  <div className="overflow-x-auto rounded-xl border border-slate-200/60 bg-white/70 backdrop-blur-md shadow-sm">
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
              ))
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
                      <select
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500"
                        value={editFormData.productId}
                        onChange={(e) => setEditFormData({ ...editFormData, productId: e.target.value })}
                        required
                      >
                        <option value="" disabled>เลือกสินค้า...</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>{p.name} ({p.qtyPerA3} ชิ้น/A3)</option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-slate-600 mb-1">เป้าหมายที่ต้องการ (ชิ้น)</label>
                      <input
                        type="number"
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500 text-lg font-bold"
                        value={editFormData.targetQty}
                        onChange={(e) => setEditFormData({ ...editFormData, targetQty: e.target.value })}
                        required min="1"
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