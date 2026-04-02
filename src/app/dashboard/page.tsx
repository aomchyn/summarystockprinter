"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import * as XLSX from 'xlsx';
import { logAction } from "@/lib/auditLog";


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

export default function Dashboard() {
  const router = useRouter();

  const [currentUser, setCurrentUser] = useState<string>('');

  const [printOrders, setPrintOrders] = useState<DashboardOrderGroup[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  // --- Inline Edit/Delete State ---
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [editingEntry, setEditingEntry] = useState<any | null>(null);
  const [editFormData, setEditFormData] = useState({
    targetQty: "",
    wasteQty: "",
    wasteQtyRemark: "",
    wasteA3: "",
    wasteA3Remark: "",
    department: "",
  });

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  useEffect(() => {
    fetchOrders();
    // Fetch current user
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const email = session.user.email || '';
        // Use display_name metadata if available, otherwise strip domain from email
        const displayName =
          session.user.user_metadata?.full_name ||
          session.user.user_metadata?.name ||
          (email ? email.split('@')[0] : 'ผู้ใช้');
        setCurrentUser(displayName);
      }
    });
  }, []);

  const fetchOrders = async () => {
    setIsLoadingOrders(true);
    setOrdersError(null);
    try {
      // Calculate date 7 days ago
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dateString = sevenDaysAgo.toISOString().split('T')[0];

      // Fetch all orders from the past 7 days
      const { data, error } = await supabase
        .from('print_orders')
        .select(`
          *,
          products ( name, qty_per_a3 )
        `)
        .gte('date', dateString)
        .order('date', { ascending: false });

      if (error) throw error;

      // Fetch paper_transactions to get paper_type per order
      const { data: txData } = await supabase
        .from('paper_transactions')
        .select('reference_id, paper_type')
        .eq('transaction_type', 'OUT')
        .gte('date', dateString);

      const paperTypeMap = new Map<string, string>();
      txData?.forEach((tx: any) => {
        if (tx.reference_id) paperTypeMap.set(tx.reference_id, tx.paper_type);
      });

      // Group and Aggregate
      const groupedOrders = new Map<string, DashboardOrderGroup>();

      data?.forEach((o: any) => {
        const department = o.department || "-";
        const lotName = o.lot_name;
        const productId = o.product_id;
        const groupKey = `${department}-${lotName}-${productId}`;

        const remarkW = o.waste_qty_remark ? String(o.waste_qty_remark) : "";
        const remarkA3 = o.waste_a3_remark ? String(o.waste_a3_remark) : "";

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
        } else {
          const initialRemarks: string[] = [];
          if (remarkW) initialRemarks.push(remarkW);
          if (remarkA3) initialRemarks.push(remarkA3);

          groupedOrders.set(groupKey, {
            id: groupKey,
            department: department,
            lotName: lotName,
            productName: o.products?.name || "ไม่ทราบชื่อสินค้า",
            targetQty: o.target_qty,
            sheetsNeeded: o.sheets_needed,
            totalPrinted: o.total_printed,
            excessQty: 0, // Recalculated after the loop
            wasteQty: (o.waste_qty || 0),
            wasteA3: (o.waste_a3 || 0),
            remarks: initialRemarks,
            productId: productId,
            entries: [{ ...o, paper_type: paperTypeMap.get(o.id) || 'ไม่ระบุ' }],
          });
        }
      });

      const formattedOrders = Array.from(groupedOrders.values()).map(group => {
        // Enforce math correctness regardless of how it was entered in the DB row by row
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

  const handleDeleteEntry = async (entryId: string, entryDate: string) => {
    // Check if entry is within 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const entryDateObj = new Date(entryDate);
    const isWithinWeek = entryDateObj >= sevenDaysAgo;

    const confirmMsg = isWithinWeek
      ? "คุณต้องการลบรายการสั่งพิมพ์นี้ใช่หรือไม่?\n(กระดาษที่ใช้จะถูกคืนกลับเข้าสต็อคอัตโนมัติ)"
      : "คุณต้องการลบรายการสั่งพิมพ์นี้ใช่หรือไม่?\n(รายการเก่าเกิน 7 วัน จะไม่คืนสต็อคกระดาษ)";

    if (!window.confirm(confirmMsg)) return;

    try {
      // Only restore stock if entry is within the last 7 days
      if (isWithinWeek) {
        // 1. Find the OUT paper transaction for this order
        const { data: txData } = await supabase
          .from('paper_transactions')
          .select('*')
          .eq('reference_id', entryId)
          .eq('transaction_type', 'OUT')
          .limit(1);

        if (txData && txData.length > 0) {
          const outTx = txData[0];

          // 2. Create a reverse IN transaction to restore stock
          const { data: { session } } = await supabase.auth.getSession();
          await supabase
            .from('paper_transactions')
            .insert([{
              date: new Date().toISOString().split('T')[0],
              transaction_type: 'IN',
              paper_type: outTx.paper_type,
              qty: outTx.qty,
              description: `คืนสต็อค (ลบคำสั่งพิมพ์)`,
              user_id: session?.user?.id || null,
            }]);

          // 3. Delete the original OUT transaction
          await supabase
            .from('paper_transactions')
            .delete()
            .eq('id', outTx.id);
        }
      }

      // 4. Delete the print order itself
      const { error } = await supabase
        .from('print_orders')
        .delete()
        .eq('id', entryId);

      if (error) throw error;
      logAction('DELETE', 'dashboard', `ลบคำสั่งพิมพ์ #${entryId}${isWithinWeek ? ' (คืนสต็อค)' : ''}`, { entryId, entryDate, stockRestored: isWithinWeek });
      fetchOrders();
    } catch (error: any) {
      alert("ลบข้อมูลไม่สำเร็จ: " + error.message);
    }
  };

  const handleOpenEdit = (entry: any) => {
    setEditingEntry(entry);
    setEditFormData({
      targetQty: entry.target_qty.toString(),
      wasteQty: entry.waste_qty ? entry.waste_qty.toString() : "",
      wasteQtyRemark: entry.waste_qty_remark || "",
      wasteA3: entry.waste_a3 ? entry.waste_a3.toString() : "",
      wasteA3Remark: entry.waste_a3_remark || "",
      department: entry.department || "",
    });
  };

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry) return;

    try {
      const numTarget = parseInt(editFormData.targetQty) || 0;
      const numWaste = parseInt(editFormData.wasteQty) || 0;

      const ratio = editingEntry.products?.qty_per_a3 || 1;
      const additionalWasteA3 = parseInt(editFormData.wasteA3) || 0;

      // Waste pieces offset natural excess first; only add sheets if waste > natural excess
      const baseSheetsForTarget = Math.ceil(numTarget / ratio);
      const naturalExcess = (baseSheetsForTarget * ratio) - numTarget;
      let extraSheetsForWaste = 0;
      if (numWaste > naturalExcess) {
        extraSheetsForWaste = Math.ceil((numWaste - naturalExcess) / ratio);
      }
      // Productive sheets affect piece count; wasteA3 only deducts from stock
      const productiveSheets = baseSheetsForTarget + extraSheetsForWaste;
      const newSheetsNeeded = productiveSheets + additionalWasteA3;
      const totalPrinted = productiveSheets * ratio;

      // --- Stock adjustment ---
      const oldSheetsNeeded = editingEntry.sheets_needed || 0;
      const sheetsDiff = newSheetsNeeded - oldSheetsNeeded; // positive = used more, negative = used less

      if (sheetsDiff !== 0) {
        // Find the paper_transaction linked to this entry to get paper_type
        const { data: txData } = await supabase
          .from('paper_transactions')
          .select('paper_type')
          .eq('reference_id', editingEntry.id)
          .eq('transaction_type', 'OUT')
          .limit(1);

        const paperType = txData?.[0]?.paper_type || 'ไม่ระบุ';
        const { data: { session } } = await supabase.auth.getSession();

        if (sheetsDiff > 0) {
          // Used more sheets → additional OUT
          await supabase.from('paper_transactions').insert([{
            date: new Date().toISOString().split('T')[0],
            transaction_type: 'OUT',
            paper_type: paperType,
            qty: sheetsDiff,
            description: `ปรับเพิ่ม (แก้ไขคำสั่งพิมพ์ +${sheetsDiff} ใบ)`,
            user_id: session?.user?.id || null,
          }]);
        } else {
          // Used fewer sheets → return stock IN
          await supabase.from('paper_transactions').insert([{
            date: new Date().toISOString().split('T')[0],
            transaction_type: 'IN',
            paper_type: paperType,
            qty: Math.abs(sheetsDiff),
            description: `คืนสต็อค (แก้ไขคำสั่งพิมพ์ ${sheetsDiff} ใบ)`,
            user_id: session?.user?.id || null,
          }]);
        }
      }

      // --- Update print_orders ---
      const { error } = await supabase
        .from('print_orders')
        .update({
          department: editFormData.department,
          target_qty: numTarget,
          waste_qty: numWaste,
          waste_qty_remark: editFormData.wasteQtyRemark,
          waste_a3: additionalWasteA3,
          waste_a3_remark: editFormData.wasteA3Remark,
          sheets_needed: newSheetsNeeded,
          total_printed: totalPrinted,
        })
        .eq('id', editingEntry.id);

      if (error) throw error;

      logAction('UPDATE', 'dashboard', `แก้ไขคำสั่งพิมพ์ #${editingEntry.id}`, {
        id: editingEntry.id,
        target_qty: numTarget,
        sheets_needed: newSheetsNeeded,
        stock_diff: sheetsDiff,
      });

      setEditingEntry(null);
      fetchOrders();
    } catch (err: any) {
      alert("บันทึกการแก้ไขไม่สำเร็จ: " + err.message);
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

          // By paper type
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

      // Aggregate by paper type
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

  // --- Excel Export ---
  const handleExportExcel = async () => {
    const wb = XLSX.utils.book_new();

    // ── Date range from current printOrders ──
    const allDates = printOrders.flatMap(g => g.entries.map((e: any) => e.date as string)).filter(Boolean);
    const minDate = allDates.length ? allDates.reduce((a, b) => a < b ? a : b) : null;
    const maxDate = allDates.length ? allDates.reduce((a, b) => a > b ? a : b) : null;
    const fmtDate = (d: string) => new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const orderDateRange = minDate && maxDate
      ? (minDate === maxDate ? fmtDate(minDate) : `${fmtDate(minDate)} - ${fmtDate(maxDate)}`)
      : '-';
    const todayTH = new Date().toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });

    // ── Helper: shift all cells in ws down by N rows and prepend header rows ──
    const prependHeader = (ws: XLSX.WorkSheet, headerRows: any[][]) => {
      const n = headerRows.length;
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      // Shift cells downward
      for (let R = range.e.r; R >= range.s.r; R--) {
        for (let C = range.s.c; C <= range.e.c; C++) {
          const oldAddr = XLSX.utils.encode_cell({ r: R, c: C });
          const newAddr = XLSX.utils.encode_cell({ r: R + n, c: C });
          if (ws[oldAddr]) { ws[newAddr] = ws[oldAddr]; delete ws[oldAddr]; }
        }
      }
      // Extend ref
      ws['!ref'] = XLSX.utils.encode_range({
        s: { r: 0, c: range.s.c },
        e: { r: range.e.r + n, c: range.e.c },
      });
      // Write header rows at top
      XLSX.utils.sheet_add_aoa(ws, headerRows, { origin: 'A1' });
    };

    // ── Sheet 0: Paper Stock Summary ──
    const { data: txAll } = await supabase
      .from('paper_transactions')
      .select('paper_type, transaction_type, qty');

    const stockMap: Record<string, { totalIn: number; totalOut: number }> = {};
    (txAll || []).forEach((tx: any) => {
      const pt = tx.paper_type || 'ไม่ระบุ';
      if (!stockMap[pt]) stockMap[pt] = { totalIn: 0, totalOut: 0 };
      if (tx.transaction_type === 'IN') stockMap[pt].totalIn += tx.qty;
      else stockMap[pt].totalOut += tx.qty;
    });

    const stockRows = Object.entries(stockMap).map(([pt, s]) => ({
      'ประเภทกระดาษ': pt,
      'รับเข้ารวม (ใบ)': s.totalIn,
      'ใช้ออกรวม (ใบ)': s.totalOut,
      'คงเหลือ (ใบ)': s.totalIn - s.totalOut,
    }));
    stockRows.push({
      'ประเภทกระดาษ': 'รวมทั้งหมด',
      'รับเข้ารวม (ใบ)': stockRows.reduce((s, r) => s + (r['รับเข้ารวม (ใบ)'] as number), 0),
      'ใช้ออกรวม (ใบ)': stockRows.reduce((s, r) => s + (r['ใช้ออกรวม (ใบ)'] as number), 0),
      'คงเหลือ (ใบ)': stockRows.reduce((s, r) => s + (r['คงเหลือ (ใบ)'] as number), 0),
    });
    const wsStock = XLSX.utils.json_to_sheet(stockRows);
    wsStock['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 16 }];
    prependHeader(wsStock, [
      [`สรุปยอดสต็อคกระดาษ A3`, `ณ วันที่: ${todayTH}`],
      [],
    ]);
    XLSX.utils.book_append_sheet(wb, wsStock, 'สต็อคกระดาษ');

    // ── Sheet 1: Weekly Department Summary ──
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
    const ws1 = XLSX.utils.json_to_sheet(weeklyRows);
    ws1['!cols'] = [{ wch: 20 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 18 }];
    prependHeader(ws1, [
      [`สรุปยอดสั่งพิมพ์รายหน่วยงาน`, `ช่วงวันที่: ${orderDateRange}`],
      [],
    ]);
    XLSX.utils.book_append_sheet(wb, ws1, 'สรุปรายสัปดาห์');

    // ── Per-department sheets ──
    const detailColWidths = [{ wch: 16 }, { wch: 14 }, { wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 28 }];
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
      const wsDept = XLSX.utils.json_to_sheet(buildDetailRows(deptGroups));
      wsDept['!cols'] = detailColWidths;
      prependHeader(wsDept, [
        [`รายละเอียดคำสั่งพิมพ์ — ${dept}`, `ช่วงวันที่: ${deptRange}`],
        [],
      ]);
      XLSX.utils.book_append_sheet(wb, wsDept, dept.substring(0, 31));
    });

    // ── Download ──
    const fileName = `WorkTracker_${minDate || todayTH}_${maxDate || todayTH}.xlsx`;
    XLSX.writeFile(wb, fileName);
    logAction('EXPORT', 'dashboard', `ส่งออก Excel ช่วงวันที่ ${orderDateRange}`, { fileName, dateRange: orderDateRange });
  };

  return (
    <div className="dashboard-container animate-fade-in">
      {/* Header */}
      <header className="dashboard-header glass-panel">
        <div className="header-content container">
          <div className="brand">
            <span className="logo-icon">✨</span>
            <span className="brand-name">WorkTracker</span>
          </div>

          <nav className="main-nav">
            <Link href="/dashboard" className="nav-link active">หน้าหลัก</Link>
            <Link href="/products" className="nav-link">จัดการสินค้า</Link>
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
        {/* Recent Print Orders */}
        <section className="dashboard-content-grid delay-200 animate-fade-in mx-auto w-full max-w-5xl flex justify-center">

          {/* Print Orders Section */}
          <div className="print-orders-section glass-panel w-full">
            <div className="section-header">
              <h2>สรุปยอดสั่งพิมพ์ (รอบ 7 วันล่าสุด)</h2>
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

              {/* Paper Type Breakdown - Daily */}
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

            {/* === Weekly Department Summary === */}
            <div className="mb-8">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <span className="text-2xl">📊</span> สรุปยอดรายสัปดาห์แยกหน่วยงาน
                <span className="text-sm font-normal text-slate-500">(7 วันล่าสุด)</span>
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
                          <td className="py-3 px-5">
                            <span className="font-bold text-slate-800">{dept}</span>
                          </td>
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
                      {/* Summary Row */}
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

              {/* Paper Type Breakdown - Weekly */}
              {Object.keys(weeklySummary.byPaperType).length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                    <span>📃</span> แยกตามประเภทกระดาษ (7 วัน)
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
                                  <td className="py-4 px-6 text-right font-medium text-slate-700">
                                    {order.targetQty.toLocaleString()}
                                  </td>
                                  <td className="py-4 px-6 text-right font-bold text-sky-500">
                                    {order.sheetsNeeded.toLocaleString()} ใบ
                                  </td>
                                  <td className="py-4 px-6 text-right font-bold text-emerald-500">
                                    {(order.sheetsNeeded - order.wasteA3).toLocaleString()} ใบ
                                  </td>
                                  <td className="py-4 px-6 text-right font-bold text-amber-500">
                                    {order.excessQty.toLocaleString()} ชิ้น
                                  </td>
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
                                    <td colSpan={7} className="p-0 border-b border-transparent">
                                      <div className="bg-slate-50/80 px-8 py-5 shadow-inner">
                                        <div className="flex items-center justify-between mb-3 border-b border-slate-200 pb-2">
                                          <h4 className="text-sm font-bold text-slate-700">รายการย่อย <span className="font-normal text-slate-500">(สร้างหรือแก้ไข)</span></h4>
                                        </div>
                                        <div className="overflow-x-auto">
                                          <table className="w-full text-sm text-left">
                                            <thead>
                                              <tr className="text-xs text-slate-500 font-medium">
                                                <th className="py-2 px-3 w-40">วันที่-เวลา</th>
                                                <th className="py-2 px-3 text-right">เป้ารวม</th>
                                                <th className="py-2 px-3 text-right">A3 ใช้รวม</th>
                                                <th className="py-2 px-3 text-right">ของเสีย</th>
                                                <th className="py-2 px-3">หมายเหตุ</th>
                                                <th className="py-2 px-3 text-right">จัดการ</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-200/60">
                                              {order.entries.map((entry: any) => (
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
                                                  <td className="py-2.5 px-3 text-xs text-slate-500 max-w-[180px]">
                                                    {entry.waste_qty_remark && <div className="truncate text-slate-600">• {entry.waste_qty_remark} (ชิ้น)</div>}
                                                    {entry.waste_a3_remark && <div className="truncate text-slate-600">• {entry.waste_a3_remark} (A3)</div>}
                                                  </td>
                                                  <td className="py-3 px-3 text-right">
                                                    <div className="flex items-center justify-end gap-3">
                                                      <button onClick={() => handleOpenEdit(entry)} className="inline-flex items-center gap-2 text-sky-600 hover:text-white hover:bg-sky-500 transition-all text-sm font-semibold px-4 py-2.5 bg-sky-50 border border-sky-200 rounded-lg shadow-sm hover:border-sky-500 hover:shadow-md">
                                                        <span className="text-base">✏️</span> แก้ไข
                                                      </button>
                                                      <button onClick={() => handleDeleteEntry(entry.id, entry.date)} className="inline-flex items-center gap-2 text-red-600 hover:text-white hover:bg-red-500 transition-all text-sm font-semibold px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg shadow-sm hover:border-red-500 hover:shadow-md">
                                                        <span className="text-base">🗑️</span> ลบ
                                                      </button>
                                                    </div>
                                                  </td>
                                                </tr>
                                              ))}
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
              {/* Edit Modal */}
              {editingEntry && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                  <div className="glass-panel w-full max-w-lg p-6 relative">
                    <button
                      onClick={() => setEditingEntry(null)}
                      className="absolute top-4 right-4 text-slate-400 hover:text-white text-xl p-1"
                    >
                      ✕
                    </button>
                    <h2 className="text-xl font-bold mb-4 border-b border-white/10 pb-2">แก้ไขรายการสั่งพิมพ์</h2>

                    <form onSubmit={submitEdit} className="space-y-4">
                      {/* Live preview of recalculated values */}
                      {(() => {
                        const ratio = editingEntry?.products?.qty_per_a3;
                        const hasRatio = ratio && ratio > 0;
                        const effectiveRatio = hasRatio ? ratio : 1;
                        const numTarget = parseInt(editFormData.targetQty) || 0;
                        const numWaste = parseInt(editFormData.wasteQty) || 0;
                        const wasteA3 = parseInt(editFormData.wasteA3) || 0;
                        // Productive sheets (piece count)
                        const baseSheetsForTarget = Math.ceil(numTarget / effectiveRatio);
                        const naturalExcess = (baseSheetsForTarget * effectiveRatio) - numTarget;
                        const extraForWaste = numWaste > naturalExcess ? Math.ceil((numWaste - naturalExcess) / effectiveRatio) : 0;
                        const productiveSheets = baseSheetsForTarget + extraForWaste;
                        // Total sheets including wasted A3 (for stock)
                        const newSheets = productiveSheets + wasteA3;
                        const oldSheets = editingEntry?.sheets_needed || 0;
                        const excessQty = Math.max(0, (productiveSheets * effectiveRatio) - numTarget - numWaste);
                        const diff = newSheets - oldSheets;
                        return (
                          <div className="rounded-lg border border-slate-600 overflow-hidden text-sm">
                            {/* Product info bar */}
                            <div className="bg-slate-700/80 px-4 py-2 flex items-center justify-between">
                              <span className="text-slate-300 font-medium">
                                📦 {editingEntry?.products?.name || 'ไม่ทราบสินค้า'}
                              </span>
                              {hasRatio ? (
                                <span className="text-xs bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded-full">
                                  อัตราส่วน: {ratio} ชิ้น / A3
                                </span>
                              ) : (
                                <span className="text-xs bg-red-500/20 text-red-300 border border-red-500/30 px-2 py-0.5 rounded-full">
                                  ⚠️ ไม่พบอัตราส่วน (ใช้ 1)
                                </span>
                              )}
                            </div>
                            {/* Calculation preview */}
                            <div className="bg-slate-800/60 px-4 py-3 flex flex-wrap gap-x-5 gap-y-2">
                              <div>
                                <span className="text-slate-400">เป้าหมายเดิม: </span>
                                <span className="font-bold text-white">{editingEntry?.target_qty} ชิ้น</span>
                              </div>
                              <div>
                                <span className="text-slate-400">A3 เดิม: </span>
                                <span className="font-bold text-sky-400">{oldSheets} ใบ</span>
                              </div>
                              <div className="border-l border-slate-600 pl-5">
                                <span className="text-slate-400">A3 ใหม่: </span>
                                <span className="font-bold text-emerald-400">{newSheets} ใบ</span>
                              </div>
                              <div>
                                <span className="text-slate-400">ส่วนเกิน: </span>
                                <span className="font-bold text-amber-400">{excessQty} ชิ้น</span>
                              </div>
                              {diff !== 0 && (
                                <div className="w-full border-t border-slate-700 pt-2 mt-1">
                                  <span className="text-slate-400">ปรับสต็อคกระดาษ: </span>
                                  <span className={`font-bold ${diff > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                                    {diff > 0 ? `ตัดออก ${diff} ใบ` : `คืนกลับ ${Math.abs(diff)} ใบ`}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      <div className="grid grid-cols-2 gap-4">
                        <div className="form-group">
                          <label className="form-label text-sm">หน่วยงาน</label>
                          <select
                            className="input-field text-sm p-2 cursor-pointer bg-slate-800"
                            value={editFormData.department}
                            onChange={(e) => setEditFormData({ ...editFormData, department: e.target.value })}
                          >
                            <option value="ZT">ZT</option>
                            <option value="13 ไร่">13 ไร่</option>
                            <option value="หน่วยงานอื่นๆ">หน่วยงานอื่นๆ</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label className="form-label text-sm">เป้าหมาย (ชิ้น)</label>
                          <input
                            type="number"
                            className="input-field text-sm p-2"
                            value={editFormData.targetQty}
                            onChange={(e) => setEditFormData({ ...editFormData, targetQty: e.target.value })}
                            required
                          />
                        </div>
                      </div>

                      <div className="p-4 border border-red-500/20 rounded-lg bg-red-500/5 space-y-3">
                        <h4 className="text-sm font-semibold text-red-400">ชิ้นงานเสีย</h4>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="form-group col-span-1">
                            <label className="form-label text-xs">จำนวน (ชิ้น)</label>
                            <input type="number" className="input-field text-sm p-1.5" value={editFormData.wasteQty} onChange={(e) => setEditFormData({ ...editFormData, wasteQty: e.target.value })} />
                          </div>
                          <div className="form-group col-span-2">
                            <label className="form-label text-xs">หมายเหตุ</label>
                            <input type="text" className="input-field text-sm p-1.5" value={editFormData.wasteQtyRemark} onChange={(e) => setEditFormData({ ...editFormData, wasteQtyRemark: e.target.value })} />
                          </div>
                        </div>
                        <h4 className="text-sm font-semibold text-red-400 mt-2">กระดาษเสีย (A3)</h4>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="form-group col-span-1">
                            <label className="form-label text-xs">จำนวน (ใบ)</label>
                            <input type="number" className="input-field text-sm p-1.5" value={editFormData.wasteA3} onChange={(e) => setEditFormData({ ...editFormData, wasteA3: e.target.value })} />
                          </div>
                          <div className="form-group col-span-2">
                            <label className="form-label text-xs">หมายเหตุ</label>
                            <input type="text" className="input-field text-sm p-1.5" value={editFormData.wasteA3Remark} onChange={(e) => setEditFormData({ ...editFormData, wasteA3Remark: e.target.value })} />
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-end pt-4">
                        <button type="submit" className="btn btn-primary px-6">บันทึกการแก้ไข</button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
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
          grid-template-columns: 1fr;
        }

        @media (min-width: 992px) {
          .dashboard-main {
            grid-template-columns: 1fr;
            align-items: start;
          }
        }

        .dashboard-content-grid {
          display: flex;
          justify-content: center;
          gap: 24px;
          margin-top: 32px;
        }

        @media (min-width: 992px) {
          .dashboard-content-grid {
            grid-template-columns: 1fr 1fr;
          }
        }

        section h2, .section-header h2 {
          font-size: 1.25rem;
          font-weight: 600;
          color: var(--text-main);
          margin-bottom: 0;
        }

        .log-form-section {
          padding: 32px;
          margin-bottom: 24px;
        }

        .recent-logs-section, .print-orders-section {
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

        .textarea {
          resize: vertical;
          min-height: 100px;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 24px;
        }

        .total-hours {
          font-size: 1.2rem;
          font-weight: 700;
        }

        .logs-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .log-card {
          display: flex;
          align-items: stretch;
          gap: 16px;
          background: rgba(0,0,0,0.2);
          border: 1px solid var(--surface-border);
          padding: 16px;
          border-radius: var(--radius-md);
          transition: transform var(--transition-base), background var(--transition-base);
        }

        .log-card:hover {
          transform: translateX(4px);
          background: rgba(0,0,0,0.3);
          border-color: rgba(255,255,255,0.15);
        }

        .log-date-badge {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-width: 60px;
          background: rgba(255,255,255,0.05);
          border-radius: var(--radius-sm);
          padding: 8px;
        }

        .date-month {
          font-size: 0.75rem;
          text-transform: uppercase;
          color: var(--accent-primary);
          font-weight: 600;
        }

        .date-day {
          font-size: 1.25rem;
          font-weight: 700;
        }

        .log-details {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .log-title {
          font-size: 1rem;
          font-weight: 500;
          color: var(--text-main);
          margin-bottom: 4px;
        }

        .log-desc {
          font-size: 0.85rem;
          color: var(--text-muted);
          line-height: 1.4;
        }

        .log-hours {
          display: flex;
          align-items: center;
          font-size: 0.85rem;
          color: var(--text-muted);
          font-weight: 500;
          min-width: 65px;
          justify-content: flex-end;
        }

        .log-hours span {
          font-size: 1.25rem;
          color: var(--text-main);
          margin-right: 4px;
          font-weight: 600;
        }

        /* Dashboard Orders Card Styles */
        .order-summary-card {
          background: rgba(0,0,0,0.2);
          border: 1px solid var(--surface-border);
          padding: 16px;
          border-radius: var(--radius-md);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .order-summary-header {
          display: flex;
          justify-content: space-between;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          padding-bottom: 8px;
        }

        .product-title {
          font-size: 1.05rem;
          font-weight: 600;
          color: var(--text-main);
        }

        .stats-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .stat-pill {
          background: rgba(255,255,255,0.05);
          padding: 4px 10px;
          border-radius: var(--radius-sm);
          font-size: 0.8rem;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .stat-pill .label { color: var(--text-muted); }
        .stat-pill .val { font-weight: 600; }
        .bg-blue-subtle { background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2); }
        .bg-amber-subtle { background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.2); }
        .text-accent-primary { color: var(--accent-primary) !important; }
        .text-accent-secondary { color: var(--accent-secondary) !important; }
        .text-warning { color: #f59e0b !important; }

        .waste-alert-mini {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: var(--radius-sm);
          padding: 8px 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .waste-line {
          font-size: 0.8rem;
          color: var(--text-main);
        }

        .waste-label {
          color: #ef4444;
          font-weight: 500;
        }

        .waste-remark {
          color: var(--text-muted);
          margin-left: 4px;
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
