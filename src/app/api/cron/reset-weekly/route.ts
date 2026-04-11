import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: Request) {
  // ตรวจสอบ session ผู้ใช้แทน CRON_SECRET
  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name) => cookieStore.get(name)?.value } }
  );

  const { data: { session } } = await supabaseAuth.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. คำนวณ net stock ปัจจุบัน
    const { data: txData, error: txError } = await supabaseAdmin
      .from('paper_transactions')
      .select('paper_type, transaction_type, qty');

    if (txError) throw txError;

    const stockMap: Record<string, number> = {};
    (txData || []).forEach((tx: any) => {
      const pt = tx.paper_type || 'ไม่ระบุ';
      if (!stockMap[pt]) stockMap[pt] = 0;
      if (tx.transaction_type === 'IN') stockMap[pt] += tx.qty;
      else stockMap[pt] -= tx.qty;
    });

    // 2. ลบ print_orders ทั้งหมด
    const { error: poDeleteError } = await supabaseAdmin
      .from('print_orders')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (poDeleteError) throw poDeleteError;

    // 3. ลบ paper_transactions ทั้งหมด
    const { error: ptDeleteError } = await supabaseAdmin
      .from('paper_transactions')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (ptDeleteError) throw ptDeleteError;

    // 4. ยกยอดคงเหลือ
    const todayStr = new Date().toISOString().split('T')[0];
    const carryForwardEntries = Object.entries(stockMap)
      .filter(([_, qty]) => qty > 0) // ✅ เพิ่ม filter ไม่เอา qty ติดลบ
      .map(([paper_type, qty]) => ({
        date: todayStr,
        transaction_type: 'IN',
        paper_type,
        qty,
        description: 'ยอดยกมา (รีเซ็ตรายสัปดาห์)',
        user_id: null,
      }));

    if (carryForwardEntries.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from('paper_transactions')
        .insert(carryForwardEntries);
      if (insertError) throw insertError;
    }

    return NextResponse.json({
      success: true,
      carriedForward: carryForwardEntries.length,
      stockSummary: stockMap
    });
  } catch (error: any) {
    console.error('Reset error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}