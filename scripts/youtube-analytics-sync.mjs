// YouTube Analytics sync for the FantasyNow+ admin portal.
// For each channel it refreshes an access token (from YT_REFRESH_TOKENS), then
// pulls: daily views/watch-time/subscribers (365d), top videos (90d), and
// traffic / device / subscribed-status / age+gender breakdowns (28d).
// Writes into yt_daily, yt_top_videos, yt_breakdowns with the SERVICE key.
//
// Each report is independent: transient 500/503 errors are retried, and a
// report that still fails (e.g. a channel with no data for it) is skipped with
// a warning so the rest of the channel's data still saves.
//
// Env (GitHub secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   YT_CLIENT_ID, YT_CLIENT_SECRET
//   YT_REFRESH_TOKENS   JSON: { "UC…channelId": "1//refreshToken", ... }
//   YOUTUBE_API_KEY     (Data API key, used only to fetch video titles)

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

// Runs one report. Retries transient 500/503 up to 3 times; on any other error
// (or persistent failure) logs a warning and returns [] so the channel continues.
async function report(token, channelId, startDate, params, label) {
  const url = 'https://youtubeanalytics.googleapis.com/v2/reports?' +
    new URLSearchParams({ ids: 'channel==' + channelId, startDate, endDate: TODAY, ...params });
  for (let attempt = 1; attempt <= 3; attempt++) {
    let d;
    try {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      d = await r.json();
    } catch (e) {
      if (attempt < 3) { await sleep(attempt * 1500); continue; }
      console.warn(`  ${label}: request failed (${e.message})`);
      return [];
    }
    if (!d.error) return d.rows || [];
    const code = d.error.code;
    if ((code === 500 || code === 503) && attempt < 3) { await sleep(attempt * 1500); continue; }
    console.warn(`  ${label}: skipped (${d.error.message || JSON.stringify(d.error)})`);
    return [];
  }
  return [];
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

  // 1. Daily metrics, last 365 days (upsert so re-runs backfill/update).
  const daily = await report(token, cid, daysAgo(365), { dimensions: 'day', metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost', sort: 'day' }, 'daily');
  if (daily.length) {
    const rows = daily.map((r) => ({ channel_id: ch.id, date: r[0], views: r[1], watch_minutes: r[2], subs_gained: r[3], subs_lost: r[4] }));
    await sb('yt_daily?on_conflict=channel_id,date', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
  }

  // Replace this channel's top-videos + breakdown rows each run.
  await sb(`yt_top_videos?channel_id=eq.${ch.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  await sb(`yt_breakdowns?channel_id=eq.${ch.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });

  // 2. Top videos, last 90 days (titles come from the Data API key).
  const vids = await report(token, cid, daysAgo(90), { dimensions: 'video', metrics: 'views,averageViewDuration', sort: '-views', maxResults: '10' }, 'top videos');
  if (vids.length) {
    const ids = vids.map((r) => r[0]);
    const titles = {};
    try {
      const tRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids.join(',')}&key=${env.YOUTUBE_API_KEY}`);
      const tData = await tRes.json();
      for (const it of tData.items || []) titles[it.id] = it.snippet.title;
    } catch (_) { /* titles are best-effort */ }
    const rows = vids.map((r) => ({ channel_id: ch.id, video_id: r[0], title: titles[r[0]] || r[0], views: r[1], avg_view_duration: Math.round(r[2]), period_days: 90 }));
    await sb('yt_top_videos', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
  }

  // 3. Breakdowns, last 28 days.
  const breakdowns = [];
  const push = (rows, kind, mapper) => { for (const r of rows) breakdowns.push({ channel_id: ch.id, kind, period_days: 28, ...mapper(r) }); };
  push(await report(token, cid, daysAgo(28), { dimensions: 'insightTrafficSourceType', metrics: 'views,estimatedMinutesWatched', sort: '-views' }, 'traffic'), 'traffic', (r) => ({ label: r[0], views: r[1], watch_minutes: r[2] }));
  push(await report(token, cid, daysAgo(28), { dimensions: 'deviceType', metrics: 'views,estimatedMinutesWatched', sort: '-views' }, 'device'), 'device', (r) => ({ label: r[0], views: r[1], watch_minutes: r[2] }));
  push(await report(token, cid, daysAgo(28), { dimensions: 'subscribedStatus', metrics: 'views,estimatedMinutesWatched' }, 'subscribed'), 'subscribed', (r) => ({ label: r[0], views: r[1], watch_minutes: r[2] }));
  push(await report(token, cid, daysAgo(28), { dimensions: 'ageGroup,gender', metrics: 'viewerPercentage', sort: '-viewerPercentage' }, 'age/gender'), 'age_gender', (r) => ({ label: r[0] + '|' + r[1], percent: r[2] }));
  if (breakdowns.length) await sb('yt_breakdowns', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(breakdowns) });

  console.log(`Synced "${ch.name}": ${daily.length} days, ${vids.length} videos, ${breakdowns.length} breakdown rows.`);
}
console.log('Analytics sync complete.');
