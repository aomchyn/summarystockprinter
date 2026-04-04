import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!; // Consider using SERVICE_ROLE_KEY if RLS limits deletion
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: Request) {
  // Allow if it's the Vercel Cron, or allow manual trigger for now
  // In a real production app, we would check for a session or a secret here.
  // const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  // if (process.env.NODE_ENV === 'production' && !isVercelCron) { ... }

  try {
    // 1. Calculate Current Net Stock
    const { data: txData, error: txError } = await supabase
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

    // 2. Delete All Records in print_orders
    // Note: Due to RLS or lack thereof, this deletes all where id is not null.
    const { error: poDeleteError } = await supabase
      .from('print_orders')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Dummy condition to target all rows

    if (poDeleteError) throw poDeleteError;

    // 3. Delete All Records in paper_transactions
    const { error: ptDeleteError } = await supabase
      .from('paper_transactions')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
      
    if (ptDeleteError) throw ptDeleteError;

    // 4. Carry Forward Stock
    const todayStr = new Date().toISOString().split('T')[0];
    const carryForwardEntries = Object.entries(stockMap).map(([paper_type, net_qty]) => ({
      date: todayStr,
      transaction_type: 'IN',
      paper_type: paper_type,
      qty: net_qty,
      description: 'ยอดยกมา (รีเซ็ตรายสัปดาห์)',
      user_id: null
    }));

    if (carryForwardEntries.length > 0) {
      const { error: insertError } = await supabase
        .from('paper_transactions')
        .insert(carryForwardEntries);

      if (insertError) throw insertError;
    }

    return NextResponse.json({ success: true, message: 'Weekly reset completed successfully', carriedForward: carryForwardEntries.length });

  } catch (error: any) {
    console.error('Error during weekly reset:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
