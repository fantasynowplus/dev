import http from 'node:http';

const CLIENT_ID = process.env.YT_CLIENT_ID;
const CLIENT_SECRET = process.env.YT_CLIENT_SECRET;
const CHANNEL_ID = process.env.YT_CHANNEL_ID || '';
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set YT_CLIENT_ID and YT_CLIENT_SECRET environment variables first.');
  process.exit(1);
}

const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly';

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code',
  scope: SCOPE, access_type: 'offline', prompt: 'consent',
});

console.log('\n1) Open this URL in your browser:\n\n' + authUrl.toString());
console.log('\n2) Pick the Google account, choose the CHANNEL you want a token for, click through');
console.log('   the "unverified app" screen (Advanced -> Go to <app>), and allow.\n');
console.log('   (Waiting for you to finish in the browser...)\n');

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, REDIRECT).searchParams.get('code');
  if (!code) { res.end('No authorization code received.'); return; }
  const tokRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT, grant_type: 'authorization_code',
    }),
  });
  const tok = await tokRes.json();
  res.end('Done - close this tab and return to the terminal.');
  if (!tok.refresh_token) {
    console.log('\nNo refresh token returned:', JSON.stringify(tok));
    console.log('Revoke this app at https://myaccount.google.com/permissions and run again.\n');
  } else if (CHANNEL_ID) {
    console.log('\nAdd this line to your YT_REFRESH_TOKENS JSON:\n');
    console.log(`  "${CHANNEL_ID}": "${tok.refresh_token}"`);
    console.log('');
  } else {
    console.log('\nRefresh token:\n\n' + tok.refresh_token + '\n');
  }
  server.close();
});
server.listen(PORT, () => {});
