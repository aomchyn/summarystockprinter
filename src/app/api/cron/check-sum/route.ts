import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET() {
  const current = new Date();
  const day = current.getDay();
  const diff = current.getDate() - day + (day === 0 ? -6 : 1);
  const startOfWeek = new Date(current.setDate(diff));
  const dateString = startOfWeek.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('print_orders')
    .select('id, date, sheets_needed, lot_name, department, created_at')
    .gte('date', dateString)
    .order('date', { ascending: false });

  if (error) return NextResponse.json({ error });

  return NextResponse.json({ 
    totalSheets: data?.reduce((s, o) => s + o.sheets_needed, 0),
    count: data?.length,
    orders: data 
  });
}
