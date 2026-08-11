import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // 1. Verify the caller is a signed-in admin.
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

  // 2. Read + validate input.
  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid JSON body' }); }
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = String(body.name || '').trim();
  if (!email || !password) return json(400, { error: 'Email and password are required' });
  if (password.length < 6) return json(400, { error: 'Password must be at least 6 characters' });

  // 3. Create the auth user, pre-confirmed so they can log in right away.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (createErr) return json(400, { error: createErr.message });
  const newId = created.user!.id;

  // 4. Make sure a profiles row exists with their name (works whether or not
  //    your project has a trigger that auto-creates profiles on signup).
  const { error: upErr } = await admin.from('profiles').upsert({ id: newId, name }, { onConflict: 'id' });
  if (upErr) return json(200, { id: newId, warning: 'User created, but profile update failed: ' + upErr.message });

  return json(200, { id: newId });
});