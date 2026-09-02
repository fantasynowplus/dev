const CAL_TARGET = '#content';
function calMount(html){ document.querySelector(CAL_TARGET).innerHTML = html; }

const EV_SELECT = 'id,title,show_id,channel_id,series_id,format,status,starts_at,release_at,duration_minutes,video_url,notes,'
  + 'show:shows(id,name,channel_id),channel:channels(id,name),'
  + 'people:event_people(id,role,staff_id,guest_id,staff:staff(id,name),guest:guests(id,name))';
const SER_SELECT = 'id,title,show_id,format,freq,dow,day_of_month,start_time,duration_minutes,release_offset_days,release_time,tz,starts_on,ends_on,occurrences,is_active,notes,show:shows(id,name)';

let CAL_TAB = 'month';
let CAL_MONTH = (function(){ const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; })();
let CAL_EVENTS = [], CAL_SERIES = [], CAL_GUESTS = [], CAL_SHOWS = [], CAL_CHANNELS = [], CAL_STAFF = [], CAL_MARKERS = [];
let CAL_FILTER = { show:'', channel:'', format:'' };
const CAL_EXPAND = {};

const calv = id => (document.getElementById(id)?.value || '').trim();
const calChecked = sel => Array.from(document.querySelectorAll(sel)).filter(c=>c.checked).map(c=>c.value);
const DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const CAL_TZ = 'America/New_York';
const CAL_TZ_LABEL = 'ET';
function calDayKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function calDayKeyET(iso){ return new Date(iso).toLocaleDateString('en-CA',{timeZone:CAL_TZ}); }
function calTimeValET(iso){ return new Date(iso).toLocaleTimeString('en-GB',{timeZone:CAL_TZ,hour:'2-digit',minute:'2-digit'}); }
function calTime(iso){ return new Date(iso).toLocaleTimeString('en-US',{timeZone:CAL_TZ,hour:'numeric',minute:'2-digit'}); }
function calLongDay(d){ return new Date(d).toLocaleDateString('en-US',{timeZone:CAL_TZ,weekday:'long',month:'long',day:'numeric'}); }
function calTzOffset(date){
  const p = {};
  new Intl.DateTimeFormat('en-US',{timeZone:CAL_TZ,hour12:false,year:'numeric',month:'2-digit',
    day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})
    .formatToParts(date).forEach(x => p[x.type] = x.value);
  const asUTC = Date.UTC(+p.year, +p.month-1, +p.day, p.hour==='24'?0:+p.hour, +p.minute, +p.second);
  return asUTC - date.getTime();
}
function etToISO(dateStr, timeStr){
  const guess = new Date(`${dateStr}T${timeStr||'00:00'}:00Z`);
  let ms = guess.getTime() - calTzOffset(guess);
  ms = guess.getTime() - calTzOffset(new Date(ms));
  return new Date(ms).toISOString();
}
function calTitle(e){ return e.title || e.show?.name || 'Untitled'; }
function calHosts(e){ return (e.people||[]).filter(p=>p.role==='host'||p.role==='cohost'); }
function calGuestsOf(e){ return (e.people||[]).filter(p=>p.role==='guest'); }
function calMarkersFor(key){
  return CAL_MARKERS.filter(mk => key >= mk.starts_on && key <= (mk.ends_on || mk.starts_on));
}
function calMarkerHtml(key){
  const ms = calMarkersFor(key);
  if (!ms.length) return '';
  const label = ms.map(mk => mk.title).join(' · ');
  const click = can('markers','u') ? ` onclick="markerForm('${ms[0].id}')"` : '';
  return `<span class="cal-mark" title="${esc(label)}"${click}>${esc(label)}</span>`;
}
function calOccurrences(){
  const out = [];
  calFiltered().forEach(e => {
    out.push({ e, kind: e.format === 'live' ? 'live' : 'record', at: e.starts_at });
    if (e.format === 'prerecorded' && e.release_at) out.push({ e, kind:'release', at: e.release_at });
  });
  return out;
}
function calPairText(e){
  if (e.format !== 'prerecorded') return calTitle(e) + ' — live ' + fmtDate(e.starts_at);
  return calTitle(e) + ' — records ' + fmtDate(e.starts_at)
       + (e.release_at ? ', releases ' + fmtDate(e.release_at) : ', release TBD');
}

async function loadCalendar(){
  const from = new Date(CAL_MONTH.getFullYear(), CAL_MONTH.getMonth()-1, 1).toISOString();
  const to   = new Date(CAL_MONTH.getFullYear(), CAL_MONTH.getMonth()+3, 1).toISOString();
  const safe = p => p.catch(()=>[]);
  const [evs, rels, series, guests, shows, chans, staff, marks] = await Promise.all([
    safe(dbGet(`content_events?select=${EV_SELECT}&starts_at=gte.${from}&starts_at=lt.${to}&order=starts_at.asc`)),
    safe(dbGet(`content_events?select=${EV_SELECT}&release_at=gte.${from}&release_at=lt.${to}&order=release_at.asc`)),
    safe(dbGet(`content_series?select=${SER_SELECT}&order=title.asc`)),
    safe(dbGet('guests?select=id,name,org,email,handle,notes&order=name.asc')),
    safe(dbGet('shows?select=id,name,channel_id&order=name.asc')),
    safe(dbGet('channels?select=id,name&order=name.asc')),
    safe(dbGet('staff?select=id,name&is_active=eq.true&order=name.asc')),
    safe(dbGet('calendar_markers?select=id,title,starts_on,ends_on,notes&order=starts_on.asc'))
  ]);
  const seen = {};
  CAL_EVENTS = [];
  evs.concat(rels).forEach(e => { if (!seen[e.id]) { seen[e.id] = 1; CAL_EVENTS.push(e); } });
  CAL_SERIES = series; CAL_GUESTS = guests;
  CAL_SHOWS = shows; CAL_CHANNELS = chans; CAL_STAFF = staff; CAL_MARKERS = marks;
  renderCalendar();
}

function calTab(t){ CAL_TAB = t; renderCalendar(); }
function calSetFilter(k, v){ CAL_FILTER[k] = v; renderCalendar(); }
function calShift(n){
  CAL_MONTH = new Date(CAL_MONTH.getFullYear(), CAL_MONTH.getMonth()+n, 1);
  loadCalendar();
}
function calToday(){
  const d = new Date(); d.setDate(1); d.setHours(0,0,0,0);
  CAL_MONTH = d; loadCalendar();
}

function calFiltered(){
  return CAL_EVENTS.filter(e =>
    (!CAL_FILTER.show    || e.show_id === CAL_FILTER.show) &&
    (!CAL_FILTER.channel || (e.channel_id || e.show?.channel_id) === CAL_FILTER.channel) &&
    (!CAL_FILTER.format  || e.format === CAL_FILTER.format));
}

function renderCalendar(){
  const tabs = [['month','Calendar'],['list','Upcoming'],['series','Recurring'],['guests','Guests']];
  if (can('markers','r')) tabs.push(['markers','Key dates']);
  const add = CAL_TAB === 'markers' ? ifCan('markers','c','<button class="btn btn-primary" onclick="markerForm()">+ Add key date</button>')
            : CAL_TAB === 'series' ? ifCan('calendar','c','<button class="btn btn-primary" onclick="seriesForm()">+ Add recurring show</button>')
            : CAL_TAB === 'guests' ? ifCan('calendar','c','<button class="btn btn-primary" onclick="guestForm()">+ Add guest</button>')
            : ifCan('calendar','c','<button class="btn btn-primary" onclick="eventForm()">+ Add episode</button>');
  const body = CAL_TAB === 'month'  ? calMonthHtml()
             : CAL_TAB === 'list'   ? calListHtml()
             : CAL_TAB === 'series' ? calSeriesHtml()
             : CAL_TAB === 'markers' ? calMarkersHtml()
             : calGuestsHtml();
  topAction(add);
  calMount(`<div class="onb-tabs">${tabs.map(([k,l])=>`<button class="${CAL_TAB===k?'on':''}" onclick="calTab('${k}')">${l}</button>`).join('')}</div>${body}`);
}

function calFilterBar(withNav){
  const opt = (list, sel) => list.map(x=>`<option value="${x.id}" ${sel===x.id?'selected':''}>${esc(x.name)}</option>`).join('');
  return `<div class="cal-toolbar">
    ${withNav ? `<button class="btn btn-ghost btn-sm" onclick="calShift(-1)">‹</button>
      <span class="cal-month">${CAL_MONTH.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</span>
      <button class="btn btn-ghost btn-sm" onclick="calShift(1)">›</button>
      <button class="btn btn-ghost btn-sm" onclick="calToday()">Today</button>` : ''}
    <select onchange="calSetFilter('show',this.value)"><option value="">All shows</option>${opt(CAL_SHOWS, CAL_FILTER.show)}</select>
    <select onchange="calSetFilter('channel',this.value)"><option value="">All channels</option>${opt(CAL_CHANNELS, CAL_FILTER.channel)}</select>
    <select onchange="calSetFilter('format',this.value)">
      <option value="">Live + pre-recorded</option>
      <option value="live" ${CAL_FILTER.format==='live'?'selected':''}>Live only</option>
      <option value="prerecorded" ${CAL_FILTER.format==='prerecorded'?'selected':''}>Pre-recorded only</option>
    </select>
    <span class="cal-legend"><span><i style="background:#EA4E3D"></i>Live</span><span><i style="background:#FFA515"></i>Record</span><span><i style="background:#42F4B0"></i>Release</span><span>All times ET</span></span>
  </div>`;
}

function calMonthHtml(){
  const y = CAL_MONTH.getFullYear(), m = CAL_MONTH.getMonth();
  const first = new Date(y, m, 1);
  const days = new Date(y, m+1, 0).getDate();
  const weeks = Math.ceil((first.getDay() + days) / 7);
  const start = new Date(y, m, 1 - first.getDay());
  const todayKey = calDayKeyET(new Date());
  const byDay = {};
  calOccurrences().forEach(o => { const k = calDayKeyET(o.at); (byDay[k] = byDay[k] || []).push(o); });

  let cells = '';
  for (let i = 0; i < weeks*7; i++){
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate()+i);
    const key = calDayKey(d);
    const list = byDay[key] || [];
    const show = CAL_EXPAND[key] ? list : list.slice(0,3);
    cells += `<div class="cal-cell ${d.getMonth()!==m?'out':''} ${key===todayKey?'today':''}">
      <div class="cal-date"><span><i class="cal-dow-label">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]}</i>${d.getDate()}</span>
        ${calMarkerHtml(key)}
        ${ifCan('calendar','c',`<button class="cal-add" title="Add episode" onclick="eventForm(null,'${key}')">+</button>`)}</div>
      ${show.map(o=>`<button class="cal-ev cal-${o.kind} ${o.e.status==='canceled'?'canceled':''}"
          title="${esc(calPairText(o.e))}" onclick="eventDetail('${o.e.id}')">
          <span class="cal-t">${calTime(o.at)}</span><span class="cal-k">${o.kind==='record'?'●':o.kind==='release'?'▶':''}</span>${esc(calTitle(o.e))}</button>`).join('')}
      ${list.length>3 && !CAL_EXPAND[key] ? `<button class="cal-more" onclick="calExpand('${key}')">+${list.length-3} more</button>` : ''}
    </div>`;
  }
  return calFilterBar(true) + `<div class="cal-grid">
    ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="cal-dow">${d}</div>`).join('')}
    ${cells}</div>`;
}
function calExpand(k){ CAL_EXPAND[k] = true; renderCalendar(); }

function calListHtml(){
  const now = Date.now();
  const list = calOccurrences().filter(o => new Date(o.at).getTime() > now - 6*3600e3)
                               .sort((a,b)=> new Date(a.at) - new Date(b.at));
  if (!list.length) return calFilterBar(false) + '<div class="empty">Nothing scheduled ahead.</div>';
  const byDay = {};
  list.forEach(o => { const k = calDayKeyET(o.at); (byDay[k] = byDay[k] || []).push(o); });
  return calFilterBar(false) + Object.keys(byDay).sort().map(k => {
    const d = new Date(k + 'T12:00:00Z');
    return `<div class="cal-day"><h4>${calLongDay(d)} ${calMarkerHtml(k)}</h4>${byDay[k].map(calRowHtml).join('')}</div>`;
  }).join('');
}

function calRowHtml(o){
  const e = o.e;
  const hosts = calHosts(e).map(p => p.staff?.name || p.guest?.name).filter(Boolean);
  const gs = calGuestsOf(e).map(p => p.guest?.name || p.staff?.name).filter(Boolean);
  const tag = o.kind === 'live'   ? '<span class="tag tag-live">Live</span>'
            : o.kind === 'record' ? '<span class="tag tag-rec">Record</span>'
            :                       '<span class="tag tag-pre">Release</span>';
  const pair = e.format !== 'prerecorded' ? ''
    : o.kind === 'record' ? (e.release_at ? 'Releases ' + fmtDate(e.release_at) : 'Release date not set')
    :                       'Recorded ' + fmtDate(e.starts_at);
  return `<div class="cal-row" onclick="eventDetail('${e.id}')">
    <div class="cal-when">${calTime(o.at)}</div>
    <div class="cal-body">
      <div class="cal-title">${esc(calTitle(e))} ${tag}
        ${e.status!=='scheduled'?`<span class="tag tag-status">${esc(e.status)}</span>`:''}</div>
      <div class="cal-meta">
        ${e.show?esc(e.show.name):'No show'}${e.channel?' · '+esc(e.channel.name):''}
        ${pair?' · '+pair:''}
        ${hosts.length?' · Host: '+esc(hosts.join(', ')):''}
        ${gs.length?' · Guests: '+esc(gs.join(', ')):''}
      </div>
    </div>
  </div>`;
}

/* ----- event create / edit ----- */
function eventForm(id, dayKey){
  const e = id ? CAL_EVENTS.find(x=>x.id===id) : null;
  const dv = e ? calDayKeyET(e.starts_at) : (dayKey || calDayKeyET(new Date()));
  const tv = e ? calTimeValET(e.starts_at) : '19:00';
  const rdv = e?.release_at ? calDayKeyET(e.release_at) : '';
  const rtv = e?.release_at ? calTimeValET(e.release_at) : '12:00';
  const hostIds = e ? calHosts(e).map(p=>p.staff_id).filter(Boolean) : [];
  const guestIds = e ? calGuestsOf(e).map(p=>p.guest_id).filter(Boolean) : [];
  const opts = (list, sel) => list.map(x=>`<option value="${x.id}" ${sel===x.id?'selected':''}>${esc(x.name)}</option>`).join('');

  const m = modal({
    title: e ? 'Edit episode' : 'Add episode',
    wide: true,
    saveLabel: 'Save episode',
    body: `<div class="form-grid">
      <div class="field full"><label>Episode title</label>
        <input id="evTitle" value="${e?esc(e.title||''):''}" placeholder="Leave blank to use the show name"></div>
      <div class="field"><label>Show</label>
        <select id="evShow" onchange="evShowPick(this.value)"><option value="">— none —</option>${opts(CAL_SHOWS, e?.show_id)}</select></div>
      <div class="field"><label>Channel</label>
        <select id="evChannel"><option value="">— none —</option>${opts(CAL_CHANNELS, e?.channel_id || e?.show?.channel_id)}</select></div>
      <div class="field"><label>Type</label>
        <select id="evFormat" onchange="evFormatToggle()">
          <option value="live" ${e?.format!=='prerecorded'?'selected':''}>Live</option>
          <option value="prerecorded" ${e?.format==='prerecorded'?'selected':''}>Pre-recorded</option>
        </select></div>
      <div class="field"><label>Status</label>
        <select id="evStatus">${['scheduled','recorded','published','canceled'].map(s=>
          `<option value="${s}" ${e?.status===s?'selected':''}>${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}</select></div>
      <div class="field"><label id="evDateLbl">Date</label><input type="date" id="evDate" value="${dv}"></div>
      <div class="field"><label id="evTimeLbl">Start time (ET)</label><input type="time" id="evTime" value="${tv}"></div>
      <div class="field" id="evRelWrap" style="display:none"><label>Release date</label><input type="date" id="evRelDate" value="${rdv}"></div>
      <div class="field" id="evRelTimeWrap" style="display:none"><label>Release time (ET)</label><input type="time" id="evRelTime" value="${rtv}"></div>
      <div class="field"><label>Length (min)</label><input type="number" id="evLen" min="5" step="5" value="${e?e.duration_minutes:60}"></div>
      <div class="field full"><label>Video / stream link</label><input id="evUrl" value="${e?esc(e.video_url||''):''}"></div>
      <div class="field"><label>Hosts (staff)</label>
        <div class="ppl-pick">${CAL_STAFF.length?CAL_STAFF.map(s=>
          `<label><input type="checkbox" class="evHost" value="${s.id}" ${hostIds.includes(s.id)?'checked':''}>${esc(s.name)}</label>`).join(''):'<div class="empty">No staff visible.</div>'}</div></div>
      <div class="field"><label>Guests</label>
        <div class="ppl-pick" id="evGuestPick">${CAL_GUESTS.length?CAL_GUESTS.map(g=>
          `<label><input type="checkbox" class="evGuest" value="${g.id}" ${guestIds.includes(g.id)?'checked':''}>${esc(g.name)}${g.org?' <span class="mono">· '+esc(g.org)+'</span>':''}</label>`).join(''):'<div class="empty">No guests yet.</div>'}</div>
        ${ifCan('calendar','c','<button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="guestQuickAdd()">+ New guest</button>')}</div>
      <div class="field full"><label>Notes</label><textarea id="evNotes" rows="3">${e?esc(e.notes||''):''}</textarea></div>
    </div>`,
    onSave: async () => {
      const date = calv('evDate'), time = calv('evTime');
      if (!date || !time) throw new Error('Pick a date and time');
      const payload = {
        title: calv('evTitle') || null,
        show_id: calv('evShow') || null,
        channel_id: calv('evChannel') || null,
        format: calv('evFormat'),
        status: calv('evStatus'),
        starts_at: etToISO(date, time),
        release_at: (calv('evFormat')==='prerecorded' && calv('evRelDate'))
          ? etToISO(calv('evRelDate'), calv('evRelTime')||'12:00') : null,
        duration_minutes: parseInt(calv('evLen')||'60', 10),
        video_url: calv('evUrl') || null,
        notes: calv('evNotes') || null
      };
      const hosts = calChecked('.evHost'), guests = calChecked('.evGuest');
      let eid = id;
      if (id){
        await dbPatch(`content_events?id=eq.${id}`, payload);            // db call
      } else {
        const ins = await dbPost('content_events', payload);
        eid = Array.isArray(ins) ? ins[0]?.id : ins?.id;
      }
      if (eid){
        await dbDel(`event_people?event_id=eq.${eid}`);                  // db call
        const rows = hosts.map(s=>({event_id:eid, role:'host', staff_id:s, guest_id:null}))
          .concat(guests.map(g=>({event_id:eid, role:'guest', staff_id:null, guest_id:g})));
        if (rows.length) await dbPost('event_people', rows);
      }
      toast('Episode saved');
      loadCalendar();
    },
    onReady: () => evFormatToggle()
  });
}

function evFormatToggle(){
  const pre = calv('evFormat') === 'prerecorded';
  const dl = document.getElementById('evDateLbl'), tl = document.getElementById('evTimeLbl');
  if (dl) dl.textContent = pre ? 'Record date' : 'Date';
  if (tl) tl.textContent = (pre ? 'Record time' : 'Start time') + ' (' + CAL_TZ_LABEL + ')';
  ['evRelWrap','evRelTimeWrap'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = pre ? '' : 'none';
  });
  const rd = document.getElementById('evRelDate');
  if (pre && rd && !rd.value) rd.value = calv('evDate');
}

function evShowPick(showId){
  const s = CAL_SHOWS.find(x=>x.id===showId);
  const sel = document.getElementById('evChannel');
  if (s && s.channel_id && sel && !sel.value) sel.value = s.channel_id;
}

async function guestQuickAdd(){
  const name = prompt('Guest name');
  if (!name) return;
  const ins = await dbPost('guests', { name: name.trim() });
  const g = Array.isArray(ins) ? ins[0] : ins;
  if (!g?.id) return toast('Could not add guest');
  CAL_GUESTS.push({ id:g.id, name:g.name });
  CAL_GUESTS.sort((a,b)=>a.name.localeCompare(b.name));
  const pick = document.getElementById('evGuestPick');
  if (pick) pick.insertAdjacentHTML('beforeend',
    `<label><input type="checkbox" class="evGuest" value="${g.id}" checked>${esc(g.name)}</label>`);
}

/* ----- event detail (cross-links) ----- */
async function eventDetail(id){
  const rows = await dbGet(`content_events?select=${EV_SELECT}&id=eq.${id}`);
  const e = rows[0];
  if (!e) return toast('Episode not found');
  const chip = (label, fn) => `<button class="chip chip-link" onclick="${fn}">${esc(label)}</button>`;
  const hosts = calHosts(e).map(p => p.staff
      ? chip(p.staff.name, `viewStaff('${p.staff.id}')`)
      : chip(p.guest?.name || '—', `guestDetail('${p.guest_id}')`)).join(' ') || '<span class="mono">—</span>';
  const gs = calGuestsOf(e).map(p => p.guest
      ? chip(p.guest.name, `guestDetail('${p.guest.id}')`)
      : chip(p.staff?.name || '—', `viewStaff('${p.staff_id}')`)).join(' ') || '<span class="mono">—</span>';
  const when = new Date(e.starts_at);

  const m = modal({
    title: calTitle(e),
    wide: true,
    footer: false,
    body: `<div>
      <p class="mono">${e.format==='prerecorded'?'Records ':''}${calLongDay(when)} · ${calTime(e.starts_at)} ${CAL_TZ_LABEL} · ${e.duration_minutes} min</p>
      ${e.format==='prerecorded'?`<p class="mono">Releases ${e.release_at?calLongDay(new Date(e.release_at))+' · '+calTime(e.release_at)+' '+CAL_TZ_LABEL:'— not set —'}</p>`:''}
      <p><span class="tag ${e.format==='live'?'tag-live':'tag-pre'}">${e.format==='live'?'Live':'Pre-recorded'}</span>
         <span class="tag tag-status">${esc(e.status)}</span>
         ${e.series_id?'<span class="tag tag-status">Recurring</span>':''}</p>
      ${detailRow('Show', e.show ? chip(e.show.name, `viewShow('${e.show.id}')`) : '—')}
      ${detailRow('Channel', e.channel ? chip(e.channel.name, `viewChannel('${e.channel.id}')`) : '—')}
      ${detailRow('Hosts', hosts)}
      ${detailRow('Guests', gs)}
      ${detailRow('Link', e.video_url?`<a href="${esc(e.video_url)}" target="_blank" rel="noopener">${esc(e.video_url)}</a>`:'—')}
      ${detailRow('Notes', esc(e.notes||'—'))}
      <div class="row-actions" style="margin-top:14px">
        ${ifCan('calendar','u',`<button class="btn btn-primary btn-sm" onclick="calCloseThen(()=>eventForm('${e.id}'))">Edit</button>`)}
        ${ifCan('calendar','d',`<button class="btn btn-danger btn-sm" onclick="eventDelete('${e.id}')">Delete</button>`)}
      </div>
    </div>`
  });
  window.__calModal = m;
}
function calCloseThen(fn){ if (window.__calModal?.close) window.__calModal.close(); fn(); }

async function eventDelete(id){
  if (!confirm('Delete this episode?')) return;
  await dbDel(`content_events?id=eq.${id}`);                            // db call
  if (window.__calModal?.close) window.__calModal.close();
  toast('Episode deleted');
  loadCalendar();
}

/* ----- recurring series ----- */
function calSeriesHtml(){
  if (!CAL_SERIES.length) return '<div class="empty">No recurring shows yet. Add one to auto-fill the calendar.</div>';
  return `<div class="table-wrap"><table><thead><tr>
      <th>Series</th><th>Show</th><th>Type</th><th>Repeats</th><th>Runs</th><th></th>
    </tr></thead><tbody>${CAL_SERIES.map(s=>`<tr>
      <td><strong>${esc(s.title)}</strong>${s.is_active?'':' <span class="tag tag-status">Paused</span>'}</td>
      <td>${s.show?esc(s.show.name):'—'}</td>
      <td><span class="tag ${s.format==='live'?'tag-live':'tag-pre'}">${s.format==='live'?'Live':'Pre-rec'}</span></td>
      <td class="ser-when">${calFreqText(s)}</td>
      <td class="ser-when">${fmtDate(s.starts_on)}${s.occurrences?' · '+s.occurrences+' episodes':s.ends_on?' – '+fmtDate(s.ends_on):' – ongoing'}</td>
      <td class="row-actions">
        ${ifCan('calendar','c',`<button class="btn btn-ghost btn-sm" onclick="seriesGenerate('${s.id}',false)">Generate</button>`)}
        ${ifCan('calendar','u',`<button class="btn btn-ghost btn-sm" onclick="seriesForm('${s.id}')">Edit</button>`)}
        ${ifCan('calendar','d',`<button class="btn btn-danger btn-sm" onclick="seriesDelete('${s.id}')">Delete</button>`)}
      </td></tr>`).join('')}</tbody></table></div>`;
}

function calFreqText(s){
  const t = s.start_time ? s.start_time.slice(0,5) : '';
  if (s.freq === 'daily') return `Every day at ${t}`;
  if (s.freq === 'monthly') return `Monthly on day ${s.day_of_month||'—'} at ${t}`;
  return `${s.freq==='biweekly'?'Every other':'Every'} ${DOW[s.dow??0]} at ${t}`;
}

function seriesForm(id){
  const s = id ? CAL_SERIES.find(x=>x.id===id) : null;
  const opts = list => list.map(x=>`<option value="${x.id}" ${s?.show_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('');
  const m = modal({
    title: s ? 'Edit recurring show' : 'New recurring show',
    wide: true,
    saveLabel: 'Save & generate',
    body: `<div class="form-grid">
      <div class="field full"><label>Series title</label><input id="srTitle" value="${s?esc(s.title):''}" placeholder="e.g. Monday Night Waivers"></div>
      <div class="field"><label>Show</label><select id="srShow"><option value="">— none —</option>${opts(CAL_SHOWS)}</select></div>
      <div class="field"><label>Type</label><select id="srFormat" onchange="srFreqToggle()">
        <option value="live" ${s?.format!=='prerecorded'?'selected':''}>Live</option>
        <option value="prerecorded" ${s?.format==='prerecorded'?'selected':''}>Pre-recorded</option></select></div>
      <div class="field"><label>Repeats</label><select id="srFreq" onchange="srFreqToggle()">
        ${['weekly','biweekly','daily','monthly'].map(f=>`<option value="${f}" ${s?.freq===f?'selected':''}>${f[0].toUpperCase()+f.slice(1)}</option>`).join('')}</select></div>
      <div class="field" id="srDowWrap"><label>Day of week</label><select id="srDow">
        ${DOW.map((d,i)=>`<option value="${i}" ${(s?.dow??1)===i?'selected':''}>${d}</option>`).join('')}</select></div>
      <div class="field" id="srDomWrap" style="display:none"><label>Day of month</label>
        <input type="number" id="srDom" min="1" max="31" value="${s?.day_of_month||1}"></div>
      <div class="field"><label>Start time (ET)</label><input type="time" id="srTime" value="${s?s.start_time.slice(0,5):'19:00'}"></div>
      <div class="field"><label>Length (min)</label><input type="number" id="srLen" min="5" step="5" value="${s?s.duration_minutes:60}"></div>
      <div class="field" id="srRelWrap" style="display:none"><label>Release (days after record)</label>
        <input type="number" id="srRelOff" min="0" max="60" value="${s?.release_offset_days ?? 0}"></div>
      <div class="field" id="srRelTimeWrap" style="display:none"><label>Release time (ET)</label>
        <input type="time" id="srRelTime" value="${s?.release_time ? s.release_time.slice(0,5) : '12:00'}"></div>
      <div class="field"><label>First date</label><input type="date" id="srStart" value="${s?s.starts_on:calDayKeyET(new Date())}"></div>
      <div class="field"><label>Ends</label><select id="srEndMode" onchange="srFreqToggle()">
        <option value="never" ${s && (s.occurrences || s.ends_on) ? '' : 'selected'}>Never</option>
        <option value="count" ${s?.occurrences ? 'selected' : ''}>After a number of episodes</option>
        <option value="date" ${(s?.ends_on && !s?.occurrences) ? 'selected' : ''}>On a date</option>
      </select></div>
      <div class="field" id="srCountWrap" style="display:none"><label>Number of episodes</label>
        <input type="number" id="srCount" min="1" max="200" value="${s?.occurrences || 10}"></div>
      <div class="field" id="srEndWrap" style="display:none"><label>End date</label>
        <input type="date" id="srEnd" value="${s?.ends_on||''}"></div>
      <div class="field"><label>Active</label><select id="srActive">
        <option value="true" ${s?.is_active!==false?'selected':''}>Yes</option>
        <option value="false" ${s?.is_active===false?'selected':''}>Paused</option></select></div>
      <div class="field full"><label>Notes</label><textarea id="srNotes" rows="2">${s?esc(s.notes||''):''}</textarea></div>
      ${s?`<div class="field full"><label><input type="checkbox" id="srReset"> Rebuild future episodes (wipes upcoming occurrences of this series and re-creates them)</label></div>`:''}
    </div>`,
    onSave: async () => {
      const payload = {
        title: calv('srTitle'),
        show_id: calv('srShow') || null,
        format: calv('srFormat'),
        freq: calv('srFreq'),
        dow: calv('srFreq')==='monthly' || calv('srFreq')==='daily' ? null : parseInt(calv('srDow'),10),
        day_of_month: calv('srFreq')==='monthly' ? parseInt(calv('srDom'),10) : null,
        start_time: calv('srTime'),
        duration_minutes: parseInt(calv('srLen')||'60',10),
        release_offset_days: calv('srFormat')==='prerecorded' ? parseInt(calv('srRelOff')||'0',10) : 0,
        release_time: calv('srFormat')==='prerecorded' ? (calv('srRelTime')||null) : null,
        starts_on: calv('srStart'),
        ends_on: calv('srEndMode') === 'date' ? (calv('srEnd') || null) : null,
        occurrences: calv('srEndMode') === 'count' ? parseInt(calv('srCount')||'1',10) : null,
        is_active: calv('srActive') === 'true',
        notes: calv('srNotes') || null
      };
      if (!payload.title) throw new Error('Give the series a title');
      let sid = id;
      if (id){
        await dbPatch(`content_series?id=eq.${id}`, payload);           // db call
      } else {
        const ins = await dbPost('content_series', payload);
        sid = Array.isArray(ins) ? ins[0]?.id : ins?.id;
      }
      const reset = !!document.getElementById('srReset')?.checked;
      if (sid) await seriesGenerate(sid, reset, true);
      loadCalendar();
    },
    onReady: () => srFreqToggle()
  });
}

function srFreqToggle(){
  const f = calv('srFreq');
  const dow = document.getElementById('srDowWrap'), dom = document.getElementById('srDomWrap');
  if (dow) dow.style.display = (f==='weekly'||f==='biweekly') ? '' : 'none';
  if (dom) dom.style.display = (f==='monthly') ? '' : 'none';
  const pre = calv('srFormat') === 'prerecorded';
  ['srRelWrap','srRelTimeWrap'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = pre ? '' : 'none';
  });
  const mode = calv('srEndMode');
  const cw = document.getElementById('srCountWrap'), ew = document.getElementById('srEndWrap');
  if (cw) cw.style.display = mode === 'count' ? '' : 'none';
  if (ew) ew.style.display = mode === 'date' ? '' : 'none';
}

async function seriesGenerate(id, reset, quiet){
  try {
    const n = await rpc('generate_series_events', { p_series:id, p_through:null, p_reset:!!reset });
    toast(`${n||0} episode${n===1?'':'s'} scheduled`);
  } catch(err){ toast('Could not generate episodes'); }
  if (!quiet) loadCalendar();
}

async function seriesDelete(id){
  if (!confirm('Delete this recurring show? Episodes already on the calendar are kept.')) return;
  await dbDel(`content_series?id=eq.${id}`);                            // db call
  toast('Recurring show deleted');
  loadCalendar();
}

/* ----- key dates (markers) ----- */
function calMarkersHtml(){
  if (!CAL_MARKERS.length) return '<div class="empty">No key dates yet. These show in grey next to the date on the calendar.</div>';
  const today = calDayKeyET(new Date());
  return `<div class="table-wrap"><table><thead><tr>
      <th>Key date</th><th>When</th><th>Notes</th><th></th>
    </tr></thead><tbody>${CAL_MARKERS.map(mk=>`<tr style="${(mk.ends_on||mk.starts_on) < today ? 'opacity:.55' : ''}">
      <td><strong>${esc(mk.title)}</strong></td>
      <td class="ser-when">${fmtDate(mk.starts_on)}${mk.ends_on && mk.ends_on !== mk.starts_on ? ' – '+fmtDate(mk.ends_on) : ''}</td>
      <td class="ser-when">${esc(mk.notes||'—')}</td>
      <td class="row-actions">
        ${ifCan('markers','u',`<button class="btn btn-ghost btn-sm" onclick="markerForm('${mk.id}')">Edit</button>`)}
        ${ifCan('markers','d',`<button class="btn btn-danger btn-sm" onclick="markerDelete('${mk.id}')">Delete</button>`)}
      </td></tr>`).join('')}</tbody></table></div>`;
}

function markerForm(id){
  if (!can('markers', id ? 'u' : 'c')) return;
  const mk = id ? CAL_MARKERS.find(x=>x.id===id) : null;
  modal({
    title: mk ? 'Edit key date' : 'Add key date',
    saveLabel: 'Save key date',
    body: `<div class="form-grid">
      <div class="field full"><label>Label</label>
        <input id="mkTitle" value="${mk?esc(mk.title):''}" placeholder="e.g. Week 1 starts"></div>
      <div class="field"><label>Date</label><input type="date" id="mkStart" value="${mk?mk.starts_on:calDayKeyET(new Date())}"></div>
      <div class="field"><label>Through (optional)</label><input type="date" id="mkEnd" value="${mk?.ends_on||''}"></div>
      <div class="field full"><label>Notes</label><textarea id="mkNotes" rows="2">${mk?esc(mk.notes||''):''}</textarea></div>
    </div>`,
    onSave: async () => {
      const payload = { title: calv('mkTitle'), starts_on: calv('mkStart'),
        ends_on: calv('mkEnd') || null, notes: calv('mkNotes') || null };
      if (!payload.title) throw new Error('Give it a label');
      if (!payload.starts_on) throw new Error('Pick a date');
      if (payload.ends_on && payload.ends_on < payload.starts_on) throw new Error('End date is before the start date');
      if (id) await dbPatch(`calendar_markers?id=eq.${id}`, payload);
      else    await dbPost('calendar_markers', payload);
      toast('Key date saved');
      loadCalendar();
    }
  });
}

async function markerDelete(id){
  if (!confirm('Delete this key date?')) return;
  await dbDel(`calendar_markers?id=eq.${id}`);
  toast('Key date deleted');
  loadCalendar();
}

/* ----- guests ----- */
function calGuestsHtml(){
  if (!CAL_GUESTS.length) return '<div class="empty">No guests yet.</div>';
  const count = {};
  CAL_EVENTS.forEach(e => calGuestsOf(e).forEach(p => { if (p.guest_id) count[p.guest_id] = (count[p.guest_id]||0)+1; }));
  return `<div class="table-wrap"><table><thead><tr>
      <th>Name</th><th>Org</th><th>Contact</th><th>Appearances</th><th></th>
    </tr></thead><tbody>${CAL_GUESTS.map(g=>`<tr>
      <td><button class="chip chip-link" onclick="guestDetail('${g.id}')">${esc(g.name)}</button></td>
      <td>${esc(g.org||'—')}</td>
      <td class="mono">${esc(g.email||g.handle||'—')}</td>
      <td>${count[g.id]||0}</td>
      <td class="row-actions">
        ${ifCan('calendar','u',`<button class="btn btn-ghost btn-sm" onclick="guestForm('${g.id}')">Edit</button>`)}
        ${ifCan('calendar','d',`<button class="btn btn-danger btn-sm" onclick="guestDelete('${g.id}')">Delete</button>`)}
      </td></tr>`).join('')}</tbody></table></div>`;
}

function guestForm(id){
  const g = id ? CAL_GUESTS.find(x=>x.id===id) : null;
  const m = modal({
    title: g ? 'Edit guest' : 'Add guest',
    saveLabel: 'Save guest',
    body: `<div class="form-grid">
      <div class="field full"><label>Name</label><input id="gsName" value="${g?esc(g.name):''}"></div>
      <div class="field"><label>Organization</label><input id="gsOrg" value="${g?esc(g.org||''):''}"></div>
      <div class="field"><label>Handle</label><input id="gsHandle" value="${g?esc(g.handle||''):''}" placeholder="@"></div>
      <div class="field"><label>Email</label><input id="gsEmail" value="${g?esc(g.email||''):''}"></div>
      <div class="field"><label>Phone</label><input id="gsPhone" value="${g?esc(g.phone||''):''}"></div>
      <div class="field full"><label>Notes</label><textarea id="gsNotes" rows="3">${g?esc(g.notes||''):''}</textarea></div>
    </div>`,
    onSave: async () => {
      const payload = { name: calv('gsName'), org: calv('gsOrg')||null, handle: calv('gsHandle')||null,
        email: calv('gsEmail')||null, phone: calv('gsPhone')||null, notes: calv('gsNotes')||null };
      if (!payload.name) throw new Error('Name is required');
      if (id) await dbPatch(`guests?id=eq.${id}`, payload);             // db call
      else    await dbPost('guests', payload);
      toast('Guest saved');
      loadCalendar();
    }
  });
}

async function guestDelete(id){
  if (!confirm('Delete this guest? They will be removed from any episodes.')) return;
  await dbDel(`guests?id=eq.${id}`);                                    // db call
  toast('Guest deleted');
  loadCalendar();
}

async function guestDetail(id){
  const [rows, apps] = await Promise.all([
    dbGet(`guests?select=*&id=eq.${id}`),
    dbGet(`event_people?select=role,event:content_events(id,title,starts_at,format,show:shows(id,name))&guest_id=eq.${id}`).catch(()=>[])
  ]);
  const g = rows[0];
  if (!g) return toast('Guest not found');
  const list = apps.filter(a=>a.event).sort((a,b)=> new Date(b.event.starts_at) - new Date(a.event.starts_at));
  const m = modal({
    title: g.name,
    footer: false,
    body: `<div>
      ${detailRow('Organization', esc(g.org||'—'))}
      ${detailRow('Handle', esc(g.handle||'—'))}
      ${detailRow('Email', esc(g.email||'—'))}
      ${detailRow('Phone', esc(g.phone||'—'))}
      ${detailRow('Notes', esc(g.notes||'—'))}
      ${detailRow('Appearances', list.length ? list.map(a=>
        `<button class="chip chip-link" onclick="calCloseThen(()=>eventDetail('${a.event.id}'))">${esc(a.event.title||a.event.show?.name||'Episode')} · ${fmtDate(a.event.starts_at)}</button>`).join(' ') : '—')}
      <div class="row-actions" style="margin-top:14px">
        ${ifCan('calendar','u',`<button class="btn btn-primary btn-sm" onclick="calCloseThen(()=>guestForm('${g.id}'))">Edit</button>`)}
      </div>
    </div>`
  });
  window.__calModal = m;
}