import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function uploadSignature(base64Str: string): Promise<string> {
  const matches = base64Str.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error('Invalid base64 string');
  }
  const buffer = Buffer.from(matches[2], 'base64');
  const fileName = `signature_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('signatures')
    .upload(fileName, buffer, { contentType: 'image/png' });

  if (uploadError) throw uploadError;

  const { data: { publicUrl } } = supabaseAdmin.storage
    .from('signatures')
    .getPublicUrl(fileName);

  return publicUrl;
}

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers();
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const users = data.users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name || user.user_metadata?.name || '',
      role: user.user_metadata?.role || 'user',
      signature_url: user.user_metadata?.signature_url || null,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at,
    }));

    return NextResponse.json({ users });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, name, role, signatureBase64 } = body;

    let signature_url = null;
    if (signatureBase64) {
      signature_url = await uploadSignature(signatureBase64);
    }

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: name,
        role: role || 'user',
        ...(signature_url && { signature_url })
      },
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ user: data.user });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id, email, password, name, role, signatureBase64 } = body;

    let signature_url = null;
    if (signatureBase64) {
      signature_url = await uploadSignature(signatureBase64);
    }

    const updates: any = {
      email,
      user_metadata: {
        full_name: name,
        role: role || 'user',
        ...(signature_url && { signature_url })
      },
    };

    if (password) {
      updates.password = password;
    }

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(id, updates);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ user: data.user });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
