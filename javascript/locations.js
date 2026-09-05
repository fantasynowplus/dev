async function loadLocations() {
  if (!can('locations', 'r')) return;
  const [pins, staffList] = await Promise.all([
    dbGet('map_pins?select=*&order=type&order=name'),
    dbGet('staff?select=id,name,role,avatar_url')
  ]);
  window.LOC_STAFF = staffList;
  renderLocations(pins);
}

function renderLocations(pins) {
  const rows = pins.map(p => `
    <tr>
      <td>${esc(p.name)}</td>
      <td>${badge(p.type)}</td>
      <td>${esc(p.city)}${p.state ? ', ' + esc(p.state) : ''}</td>
      <td>${p.lat ? 'yes' : 'pending'}</td>
      <td>${p.is_visible ? 'shown' : 'hidden'}</td>
      <td class="row-actions">
        ${ifCan('locations','u', `<button class="btn-sm" onclick="locationForm('${p.id}')">Edit</button>`)}
        ${ifCan('locations','d', `<button class="btn-sm btn-danger" onclick="locationDelete('${p.id}')">Delete</button>`)}
      </td>
    </tr>
  `).join('');

  topAction(ifCan('locations','c', `<button class="btn-primary" onclick="locationForm()">+ Add pin</button>`));

  document.querySelector('#content').innerHTML = `
    <div class="panel">
      <div class="panel-head">Locations</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>City</th><th>Geocoded</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

async function geocodeCity(city, state) {
  const q = encodeURIComponent(state ? `${city}, ${state}` : city);
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`);
  const data = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

function locationForm(id) {
  const existing = id ? LOC_CURRENT_PINS?.find(p => p.id === id) : null;
  const staffOptions = (LOC_STAFF || []).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');

  modal({
    title: id ? 'Edit pin' : 'Add pin',
    body: `
      <div class="form-grid">
        <div class="field">
          <label>Type</label>
          <select name="type" id="locType">
            <option value="staff">Staff</option>
            <option value="community">Community / Discord</option>
          </select>
        </div>
        <div class="field" id="locStaffField">
          <label>Staff member</label>
          <select name="staff_id"><option value="">—</option>${staffOptions}</select>
        </div>
        <div class="field">
          <label>Name</label>
          <input name="name" value="${existing ? esc(existing.name) : ''}">
        </div>
        <div class="field">
          <label>Label / role</label>
          <input name="label" value="${existing ? esc(existing.label || '') : ''}">
        </div>
        <div class="field">
          <label>City</label>
          <input name="city" value="${existing ? esc(existing.city) : ''}">
        </div>
        <div class="field">
          <label>State</label>
          <input name="state" value="${existing ? esc(existing.state || '') : ''}">
        </div>
        <div class="field full">
          <label><input type="checkbox" name="is_visible" ${!existing || existing.is_visible ? 'checked' : ''}> Visible on public map</label>
        </div>
      </div>
    `,
    saveLabel: id ? 'Save' : 'Add',
    onSave: async (bg) => {
      const type = bg.querySelector('#locType').value;
      const staff_id = type === 'staff' ? (val(bg, 'staff_id') || null) : null;
      const name = val(bg, 'name');
      const city = val(bg, 'city');
      const state = val(bg, 'state');
      if (!name || !city) throw new Error('Name and city are required');

      let lat = existing?.lat, lng = existing?.lng;
      if (!existing || existing.city !== city || existing.state !== state) {
        const geo = await geocodeCity(city, state);
        if (!geo) throw new Error('Could not find that location — check spelling');
        lat = geo.lat; lng = geo.lng;
      }

      const payload = {
        type, staff_id, name, city, state: state || null,
        label: val(bg, 'label') || null,
        lat, lng,
        is_visible: bg.querySelector('[name="is_visible"]').checked
      };

      if (id) await dbPatch(`map_pins?id=eq.${id}`, payload);
      else await dbPost('map_pins', payload);
      toast('Pin saved');
      loadLocations();
    }
  });
}

async function locationDelete(id) {
  confirmDelete('this pin', async () => {
    await dbDel(`map_pins?id=eq.${id}`);
    toast('Pin deleted');
    loadLocations();
  });
}