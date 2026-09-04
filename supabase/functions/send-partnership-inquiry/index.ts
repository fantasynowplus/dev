const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY')!;
const SENDER_EMAIL = Deno.env.get('BREVO_SENDER_EMAIL') || 'noreply@fantasynowplus.com';
const SENDER_NAME = 'FantasyNow+ Website';
const TO_EMAIL = 'fantasynowplus@gmail.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function esc(s: unknown) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  // honeypot — bots fill hidden fields, real users never do
  if (body.website) return json({ ok: true });

  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const company = String(body.company || '').trim();
  const phone = String(body.phone || '').trim();
  const inquiryType = String(body.inquiry_type || 'General').trim();
  const message = String(body.message || '').trim();

  if (!name || !email || !message) return json({ error: 'Name, email, and message are required' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Invalid email' }, 400);

  const html = `
    <h2>New ${esc(inquiryType)} inquiry</h2>
    <p><strong>Name:</strong> ${esc(name)}</p>
    ${company ? `<p><strong>Company/Brand:</strong> ${esc(company)}</p>` : ''}
    <p><strong>Email:</strong> ${esc(email)}</p>
    ${phone ? `<p><strong>Phone:</strong> ${esc(phone)}</p>` : ''}
    <p><strong>Message:</strong></p>
    <p>${esc(message).replace(/\n/g, '<br>')}</p>
  `;

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: [{ email: TO_EMAIL }],
      replyTo: { email, name },
      subject: `New ${inquiryType} inquiry — ${name}`,
      htmlContent: html
    })
  });

  if (!res.ok) {
    console.error('Brevo error', res.status, await res.text());
    return json({ error: 'Failed to send' }, 502);
  }
  return json({ ok: true });
});