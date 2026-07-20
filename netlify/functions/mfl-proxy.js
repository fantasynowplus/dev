export default async (request, context) => {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);
  
  const type = params.get('TYPE');
  const leagueId = params.get('LEAGUE_ID');
  
  if (!type || !leagueId) {
    return new Response(JSON.stringify({ error: 'Missing TYPE or LEAGUE_ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const mflUrl = `https://api.myfantasyleague.com/2026/export?TYPE=${type}&LEAGUE_ID=${leagueId}&JSON=1`;
  
  try {
    const response = await fetch(mflUrl);
    const data = await response.json();
    
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
