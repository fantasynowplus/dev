const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CHANNELS = [
  { ucId: 'UCCW6qFFB7ezwJk1cLPjPHDg', limit: 15 }
];

async function getUploadsPlaylistId(ucId){
  const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${ucId}&key=${YOUTUBE_API_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('channels.list ' + r.status);
  const data = await r.json();
  const item = data.items && data.items[0];
  if (!item) throw new Error('channel not found: ' + ucId);
  return item.contentDetails.relatedPlaylists.uploads;
}

async function getLatestVideos(playlistId, limit){
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=${limit}&key=${YOUTUBE_API_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('playlistItems.list ' + r.status);
  const data = await r.json();
  return (data.items || [])
    .map(it => {
      const sn = it.snippet;
      const thumb = (sn.thumbnails && (sn.thumbnails.maxres || sn.thumbnails.high || sn.thumbnails.medium || sn.thumbnails.default)) || {};
      return {
        video_id: sn.resourceId.videoId,
        title: sn.title,
        description: sn.description,
        thumbnail_url: thumb.url || '',
        published_at: sn.publishedAt
      };
    })
    .filter(v => v.title !== 'Private video' && v.title !== 'Deleted video');
}

async function upsertVideos(channelId, videos){
  if (!videos.length) return;
  const rows = videos.map(v => Object.assign({ channel_id: channelId }, v));
  const r = await fetch(`${SUPABASE_URL}/rest/v1/youtube_videos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify(rows)
  });
  if (!r.ok) throw new Error('upsert failed ' + r.status + ' ' + (await r.text()));
}

async function run(){
  for (const ch of CHANNELS) {
    try {
      const playlistId = await getUploadsPlaylistId(ch.ucId);
      const videos = await getLatestVideos(playlistId, ch.limit);
      await upsertVideos(ch.ucId, videos);
      console.log(`synced ${videos.length} videos for ${ch.ucId}`);
    } catch (e) {
      console.error(`failed for ${ch.ucId}:`, e.message);
    }
  }
}

run();