import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET() {
  try {
    // 1. Fetch all print_orders IDs
    const { data: po } = await supabase.from('print_orders').select('id');
    const validIds = new Set((po || []).map(o => o.id));

    // 2. Fetch all OUT transactions
    const { data: tx } = await supabase.from('paper_transactions').select('*').eq('transaction_type', 'OUT');

    let deleted = 0;
    
    // 3. Find and delete orphans
    for (const t of (tx || [])) {
      if (t.reference_id === null || !validIds.has(t.reference_id)) {
        // Delete it!
        await supabase.from('paper_transactions').delete().eq('id', t.id);
        deleted++;
      }
    }

    return NextResponse.json({ success: true, message: `Deleted ${deleted} orphaned OUT transactions.` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
