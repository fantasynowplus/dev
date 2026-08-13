import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function findUserByEmail(admin: any, email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data || !data.users.length) return null;
    const hit = data.users.find((u: any) => (u.email || '').toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!jwt) return json(401, { error: 'Not authenticated' });

  const { data: caller, error: cErr } = await admin.auth.getUser(jwt);
  if (cErr || !caller?.user) return json(401, { error: 'Invalid session' });

  const { data: prof } = await admin
    .from('profiles')
    .select('admin_level, role:roles(permissions)')
    .eq('id', caller.user.id)
    .single();

  const lvl = (prof?.admin_level as number) ?? 0;
  const staffCreate = (prof as any)?.role?.permissions?.staff?.c === true;
  if (!(lvl >= 7 || staffCreate)) {
    return json(403, { error: 'You do not have permission to create logins' });
  }

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid JSON body' }); }
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = String(body.name || '').trim();
  let slffid = body.slffid == null ? '' : String(body.slffid).trim();
  if (!email || !password) return json(400, { error: 'Email and password are required' });
  if (password.length < 6) return json(400, { error: 'Password must be at least 6 characters' });
  if (slffid && !/^\d+$/.test(slffid)) return json(400, { error: 'SLFF ID must be numeric' });

  let newId: string;
  let existing = false;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });

  if (createErr) {
    const msg = (createErr.message || '').toLowerCase();
    if (msg.includes('already') && (msg.includes('registered') || msg.includes('exists'))) {
      const found = await findUserByEmail(admin, email);
      if (!found) return json(400, { error: createErr.message });
      newId = found.id;
      existing = true;
    } else {
      return json(400, { error: createErr.message });
    }
  } else {
    newId = created.user!.id;
  }

  const { data: existingProfile } = await admin
    .from('profiles')
    .select('slffid')
    .eq('id', newId)
    .maybeSingle();

  if (existingProfile?.slffid) {
    slffid = String(existingProfile.slffid);
  } else if (!slffid) {
    const { data: gen } = await admin.rpc('next_slff_id');
    if (gen) slffid = String(gen);
  }

  const payload: Record<string, unknown> = { id: newId, name, email };
  if (slffid) payload.slffid = slffid;

  const { error: upErr } = await admin.from('profiles').upsert(payload, { onConflict: 'id' });
  if (upErr) return json(200, { id: newId, existing, slffid, warning: 'User created, but profile update failed: ' + upErr.message });

  return json(200, { id: newId, existing, slffid });
});