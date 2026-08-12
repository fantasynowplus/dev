// YouTube Analytics sync for the FantasyNow+ admin portal.
// Non-destructive: a report only replaces its own data when it returns rows.
// This version logs each breakdown report's exact outcome so failures are visible.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, YT_CLIENT_ID, YT_CLIENT_SECRET,
//      YT_REFRESH_TOKENS (JSON {UCid: token}), YOUTUBE_API_KEY

const env = process.env;
const missing = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','YT_CLIENT_ID','YT_CLIENT_SECRET','YT_REFRESH_TOKENS','YOUTUBE_API_KEY'].filter((k) => !env[k]);
if (missing.length) { console.error('Missing environment variable(s): ' + missing.join(', ')); process.exit(1); }

let TOKENS;
try { TOKENS = JSON.parse(env.YT_REFRESH_TOKENS); }
catch { console.error('YT_REFRESH_TOKENS is not valid JSON.'); process.exit(1); }

const sb = (path, opts = {}) =>
  fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });

const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const TODAY = iso(new Date());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function accessToken(refresh) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.YT_CLIENT_ID, client_secret: env.YT_CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('token refresh failed: ' + JSON.stringify(d));
  return d.access_token;
}

// Returns { rows } on success (rows may be []), or { error } on failure.
async function report(token, channelId, startDate, params, label) {
  const url = 'https://youtubeanalytics.googleapis.com/v2/reports?' +
    new URLSearchParams({ ids: 'channel==' + channelId, startDate, endDate: TODAY, ...params });
  for (let attempt = 1; attempt <= 4; attempt++) {
    let d;
    try {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      d = await r.json();
    } catch (e) {
      if (attempt < 4) { await sleep(attempt * 2000); continue; }
      return { error: 'request failed: ' + e.message };
    }
    if (!d.error) return { rows: d.rows || [] };
    if ((d.error.code === 500 || d.error.code === 503) && attempt < 4) { await sleep(attempt * 2000); continue; }
    return { error: (d.error.code || '') + ' ' + (d.error.message || JSON.stringify(d.error)) };
  }
  return { error: 'gave up after retries' };
}

const channels = await (await sb('channels?select=id,name,youtube_channel_id&youtube_channel_id=not.is.null')).json();
if (!Array.isArray(channels) || !channels.length) { console.log('No channels with a YouTube ID.'); process.exit(0); }

for (const ch of channels) {
  const refresh = TOKENS[ch.youtube_channel_id];
  if (!refresh) { console.warn(`No refresh token for "${ch.name}" (${ch.youtube_channel_id}) — skipping.`); continue; }

  let token;
  try { token = await accessToken(refresh); }
  catch (e) { console.error(`Token error for "${ch.name}":`, e.message); continue; }

  const cid = ch.youtube_channel_id;
  console.log(`\n=== ${ch.name} ===`);

  // 1. Daily metrics, 365 days (upsert).
  const daily = await report(token, cid, daysAgo(365), { dimensions: 'day', metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost', sort: 'day' }, 'daily');
  if (daily.rows && daily.rows.length) {
    const rows = daily.rows.map((r) => ({ channel_id: ch.id, date: r[0], views: r[1], watch_minutes: r[2], subs_gained: r[3], subs_lost: r[4] }));
    await sb('yt_daily?on_conflict=channel_id,date', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
    console.log(`  daily: ${rows.length} days`);
  } else if (daily.error) console.warn(`  daily: skipped (${daily.error})`);

  // 2. Top videos, 90 days (replace only on rows).
  const vids = await report(token, cid, daysAgo(90), { dimensions: 'video', metrics: 'views,averageViewDuration', sort: '-views', maxResults: '10' }, 'top videos');
  if (vids.rows && vids.rows.length) {
    const ids = vids.rows.map((r) => r[0]);
    const titles = {};
    try {
      const tRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids.join(',')}&key=${env.YOUTUBE_API_KEY}`);
      const tData = await tRes.json();
      for (const it of tData.items || []) titles[it.id] = it.snippet.title;
    } catch (_) {}
    const rows = vids.rows.map((r) => ({ channel_id: ch.id, video_id: r[0], title: titles[r[0]] || r[0], views: r[1], avg_view_duration: Math.round(r[2]), period_days: 90 }));
    await sb(`yt_top_videos?channel_id=eq.${ch.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    await sb('yt_top_videos', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
    console.log(`  top videos: ${rows.length}`);
  } else if (vids.error) console.warn(`  top videos: skipped (${vids.error})`);

  // 3. Breakdowns, 28 days — each logged explicitly.
  async function doBreakdown(kind, params, mapper, label) {
    const res = await report(token, cid, daysAgo(28), params, label);
    if (res.error) { console.warn(`  ${label}: skipped (${res.error})`); return; }
    if (!res.rows.length) { console.log(`  ${label}: 0 rows returned by YouTube`); return; }
    const mapped = res.rows.map((r) => ({ channel_id: ch.id, kind, period_days: 28, ...mapper(r) }));
    await sb(`yt_breakdowns?channel_id=eq.${ch.id}&kind=eq.${kind}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    const insRes = await sb('yt_breakdowns', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(mapped) });
    if (!insRes.ok) { console.warn(`  ${label}: INSERT FAILED (${insRes.status}) ${await insRes.text()}`); return; }
    console.log(`  ${label}: ${mapped.length} rows saved`);
  }

  await doBreakdown('traffic',    { dimensions: 'insightTrafficSourceType', metrics: 'views,estimatedMinutesWatched', sort: '-views' }, (r) => ({ label: r[0], views: r[1], watch_minutes: r[2] }), 'traffic');
  await doBreakdown('device',     { dimensions: 'deviceType', metrics: 'views,estimatedMinutesWatched', sort: '-views' },              (r) => ({ label: r[0], views: r[1], watch_minutes: r[2] }), 'device');
  await doBreakdown('subscribed', { dimensions: 'subscribedStatus', metrics: 'views,estimatedMinutesWatched' },                        (r) => ({ label: r[0], views: r[1], watch_minutes: r[2] }), 'subscribed');
  await doBreakdown('age_gender', { dimensions: 'ageGroup,gender', metrics: 'viewerPercentage', sort: '-viewerPercentage' },           (r) => ({ label: r[0] + '|' + r[1], percent: r[2] }), 'age/gender');
}
console.log('\nAnalytics sync complete.');
