const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CHANNELS = [
  { ucId: 'UCCW6qFFB7ezwJk1cLPjPHDg', allVideosPlaylistId: 'PLX9LyZ57O4HCZOz665YESxq60eiU0c6Gz', limit: 15 },
  { ucId: 'UCwbYE7IpXw0GEMB03vQcfPg', allVideosPlaylistId: 'PLD17XfyD48QU', limit: 15 },
  { ucId: 'UCYVj7kCSQ5iogXUGoVV5uqA', allVideosPlaylistId: 'PLeOI83uRg6RY', limit: 15 }
];

async function getPlaylistVideos(playlistId, limit){
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=${limit}&key=${YOUTUBE_API_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('playlistItems.list ' + r.status + ' (' + playlistId + ')');
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

async function upsertVideos(sourceType, sourceId, videos){
  if (!videos.length) return;
  const rows = videos.map(v => Object.assign({ source_type: sourceType, source_id: sourceId }, v));
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

async function getShowPlaylists(){
  const url = `${SUPABASE_URL}/rest/v1/shows?select=id,youtube_playlist_id&youtube_playlist_id=not.is.null`;
  const r = await fetch(url, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
  });
  if (!r.ok) throw new Error('shows fetch failed ' + r.status);
  return r.json();
}

async function run(){
  for (const ch of CHANNELS) {
    try {
      const videos = await getPlaylistVideos(ch.allVideosPlaylistId, ch.limit);
      await upsertVideos('playlist', ch.allVideosPlaylistId, videos);
      console.log(`synced ${videos.length} videos for All Videos (${ch.ucId})`);
    } catch (e) {
      console.error(`failed for channel ${ch.ucId}:`, e.message);
    }
  }

  const shows = await getShowPlaylists();
  for (const show of shows) {
    try {
      const videos = await getPlaylistVideos(show.youtube_playlist_id, 15);
      await upsertVideos('playlist', show.youtube_playlist_id, videos);
      console.log(`synced ${videos.length} videos for show playlist ${show.youtube_playlist_id}`);
    } catch (e) {
      console.error(`failed for playlist ${show.youtube_playlist_id}:`, e.message);
    }
  }
}

run();