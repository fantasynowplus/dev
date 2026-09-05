(async function () {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/map_pins?select=*&is_visible=eq.true`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
  });
  const pins = await res.json();

  const map = L.map('teamMap').setView([39.5, -98.35], 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  const colors = { staff: '#FFA515', community: '#42F4B0' };

  pins.forEach(p => {
    if (!p.lat || !p.lng) return;
    L.circleMarker([p.lat, p.lng], {
      radius: 8,
      color: colors[p.type] || '#FFFFFF',
      fillColor: colors[p.type] || '#FFFFFF',
      fillOpacity: 0.85
    })
      .bindPopup(`<strong>${p.name}</strong>${p.label ? '<br>' + p.label : ''}<br>${p.city}${p.state ? ', ' + p.state : ''}`)
      .addTo(map);
  });
})();