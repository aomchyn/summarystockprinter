"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { generateDocument, generateMultipleDocumentsAsZip } from "@/lib/docxExport";

export default function ReportsPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUser(user);
      }
    };
    fetchUser();
  }, []);

  const handleDownload = async () => {
    if (!currentUser) {
      alert("ไม่พบข้อมูลผู้ใช้");
      return;
    }
    
    setIsLoading(true);
    try {
      const signature_url = currentUser.user_metadata?.signature_url;
      
      if (!signature_url) {
        const confirmNoSig = window.confirm("ยังไม่มีลายเซ็นในระบบของคุณ ต้องการดาวน์โหลดโดยไม่มีลายเซ็นหรือไม่? (คุณสามารถไปเพิ่มได้ที่หน้าจัดการผู้ใช้)");
        if (!confirmNoSig) {
          setIsLoading(false);
          return;
        }
      }

      const start = new Date(startDate);
      const end = new Date(endDate);
      
      const dates = [];
      let current = new Date(start);
      while (current <= end) {
        dates.push(new Date(current));
        current.setDate(current.getDate() + 1);
      }
      
      if (dates.length === 0) {
        alert("กรุณาระบุช่วงวันที่ให้ถูกต้อง (วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น)");
        setIsLoading(false);
        return;
      }

      const fullName = currentUser.user_metadata?.full_name || currentUser.email;

      if (dates.length === 1) {
        // ออกเอกสารแค่วันเดียว เป็นไฟล์ .docx
        const dateObj = dates[0];
        const dateStr = dateObj.toISOString().split('T')[0];
        const formattedDate = `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${String(dateObj.getFullYear()).slice(-2)}`;
        
        const data = {
          name: fullName,
          date: formattedDate,
          signature_url: signature_url || "",
        };

        await generateDocument(
          '/templates/cleaning_report.docx', 
          `Cleaning_Report_${dateStr}.docx`, 
          data
        );
      } else {
        // ออกเอกสารหลายวันรวมเป็นไฟล์เดียว .docx
        const records = dates.map(dateObj => {
          const dateStr = dateObj.toISOString().split('T')[0];
          const formattedDate = `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${String(dateObj.getFullYear()).slice(-2)}`;
          
          return {
            fileName: `Cleaning_Report_${dateStr}.docx`,
            data: {
              name: fullName,
              date: formattedDate,
              signature_url: signature_url || "",
            }
          };
        });

        await generateMultipleDocumentsAsZip(
          '/templates/cleaning_report.docx', 
          `Merged_Cleaning_Reports_${startDate}_to_${endDate}.docx`, 
          records
        );
      }

    } catch (error: any) {
      console.error(error);
      alert("เกิดข้อผิดพลาดในการดาวน์โหลดเอกสาร (กรุณาตรวจสอบว่ามีไฟล์ cleaning_report.docx ในโฟลเดอร์ public/templates หรือไม่)\n" + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="w-full max-w-5xl mx-auto flex flex-col gap-6">
        <div className="glass-panel p-6 flex justify-between items-center delay-100 animate-fade-in">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 m-0">ออกรายงาน</h1>
            <p className="text-slate-500 mt-1">ดาวน์โหลดเอกสารแบบฟอร์มต่างๆ ที่เกี่ยวข้องกับระบบ</p>
          </div>
        </div>

        <section className="glass-panel p-6 delay-200 animate-fade-in flex flex-col md:flex-row md:items-center justify-between gap-4 border-l-4 border-l-sky-500">
          <div className="flex-1">
            <h2 className="text-lg font-bold text-slate-800">รายงานการทำความสะอาดเครื่องพิมพ์และเครื่องไดคัต (ประจำสัปดาห์)</h2>
            <p className="text-slate-500 text-sm mt-1">
              ดาวน์โหลดไฟล์ Word (.docx) พร้อมประทับวันที่และรูปลายเซ็นของคุณ
              <br/>
              <i>(หากเลือกวันที่มากกว่า 1 วัน จะถูกดาวน์โหลดเป็นไฟล์ .zip อัตโนมัติ)</i>
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">จาก:</span>
              <input 
                type="date" 
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input-field max-w-[140px] cursor-pointer"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">ถึง:</span>
              <input 
                type="date" 
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="input-field max-w-[140px] cursor-pointer"
              />
            </div>
            <button 
              onClick={handleDownload} 
              disabled={isLoading}
              className="btn btn-primary flex items-center gap-2 whitespace-nowrap ml-2"
            >
              <span className="text-lg">📥</span>
              {isLoading ? "กำลังสร้างเอกสาร..." : "ดาวน์โหลด"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
