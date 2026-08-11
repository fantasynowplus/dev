const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, YOUTUBE_API_KEY } = process.env;
const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'YOUTUBE_API_KEY'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error('Missing environment variable(s): ' + missing.join(', '));
  console.error('Add them as GitHub secrets (repo Settings → Secrets and variables → Actions) and make sure the workflow env block maps each one.');
  process.exit(1);
}

const sb = (path, opts = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });

const yt = (params) =>
  fetch(`https://www.googleapis.com/youtube/v3/channels?${params}&key=${YOUTUBE_API_KEY}`).then((r) => r.json());

// Work out how to identify a channel from whatever was entered in the dashboard.
function identify(ch) {
  const idField = (ch.youtube_channel_id || '').trim();
  const url = (ch.youtube_url || '').trim();
  if (/^UC[\w-]{20,}$/.test(idField)) return { ucid: idField };
  if (/^@[\w.\-]+$/.test(idField)) return { handle: idField };
  let m = url.match(/\/channel\/(UC[\w-]{20,})/); if (m) return { ucid: m[1] };
  m = url.match(/\/@([\w.\-]+)/);                if (m) return { handle: '@' + m[1] };
  m = url.match(/\/user\/([\w.\-]+)/);           if (m) return { username: m[1] };
  return {};
}

// 1. Load channels.
const chRes = await sb('channels?select=id,name,youtube_channel_id,youtube_url');
if (!chRes.ok) { console.error('Failed to load channels:', await chRes.text()); process.exit(1); }
const channels = await chRes.json();
if (!channels.length) { console.log('No channels found. Nothing to sync.'); process.exit(0); }

// 2. Resolve each channel to a UC… ID (looking up handles/usernames as needed),
//    and cache the resolved ID back onto the channel row.
const ucToChannel = new Map();
for (const ch of channels) {
  const who = identify(ch);
  let ucid = who.ucid;
  try {
    if (!ucid && who.handle)   { const d = await yt(`part=id&forHandle=${encodeURIComponent(who.handle)}`);   ucid = d.items?.[0]?.id; }
    if (!ucid && who.username) { const d = await yt(`part=id&forUsername=${encodeURIComponent(who.username)}`); ucid = d.items?.[0]?.id; }
  } catch (_) { /* handled by the warning below */ }

  if (!ucid) {
    console.warn(`Could not resolve a YouTube ID for "${ch.name}". Set a UC… ID, an @handle, or a channel URL on it.`);
    continue;
  }
  ucToChannel.set(ucid, ch);
  if (ch.youtube_channel_id !== ucid) {
    await sb(`channels?id=eq.${ch.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ youtube_channel_id: ucid }) });
  }
}

const ucids = [...ucToChannel.keys()];
if (!ucids.length) { console.log('No channels could be resolved to a YouTube ID.'); process.exit(0); }

// 3. Fetch statistics in batches of 50.
const rows = [];
for (let i = 0; i < ucids.length; i += 50) {
  const batch = ucids.slice(i, i + 50);
  const data = await yt(`part=statistics&id=${batch.join(',')}`);
  if (data.error) { console.error('YouTube API error:', JSON.stringify(data.error)); process.exit(1); }
  for (const item of data.items || []) {
    const s = item.statistics || {};
    const ch = ucToChannel.get(item.id);
    rows.push({
      channel_id: ch.id,
      subscriber_count: s.hiddenSubscriberCount || s.subscriberCount == null ? null : Number(s.subscriberCount),
      view_count: s.viewCount == null ? null : Number(s.viewCount),
      video_count: s.videoCount == null ? null : Number(s.videoCount),
    });
  }
}
if (!rows.length) { console.log('No stats returned.'); process.exit(0); }

// 4. Insert the snapshots (fetched_at defaults to now() in the table).
const ins = await sb('youtube_stats', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
if (!ins.ok) { console.error('Insert failed:', await ins.text()); process.exit(1); }
console.log(`Inserted ${rows.length} snapshot(s) across ${channels.length} channel(s).`);
