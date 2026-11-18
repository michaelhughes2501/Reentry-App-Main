// ==================== STATE ====================
const API = '';
let token = localStorage.getItem('ra_token');
let currentUser = JSON.parse(localStorage.getItem('ra_user') || 'null');
let allResources = [];
let allJobs = [];
let allHousing = [];
let resourceFilter = 'all';
let apiOnline = true;

// ==================== DEMO DATA ====================
const demoResources = [
  { id:1, title:'Legal Aid Society', category:'Legal', description:'Free legal assistance for reentry issues including expungement, record sealing, and housing discrimination.', phone:'1-800-555-0101', website:'https://example.com', city:'Nationwide' },
  { id:2, title:'Second Chance Food Pantry', category:'Food', description:'No-questions-asked food assistance for returning citizens and families in need.', phone:'1-800-555-0102', website:'', city:'Multiple Locations' },
  { id:3, title:'Reentry Housing Coalition', category:'Housing', description:'Transitional housing placement and permanent supportive housing for people with felony convictions.', phone:'1-800-555-0103', website:'https://example.com', city:'Nationwide' },
  { id:4, title:'Workforce Development Center', category:'Employment', description:'Free job training, resume help, and placement services for formerly incarcerated people.', phone:'1-800-555-0104', website:'https://example.com', city:'Multiple Locations' },
  { id:5, title:'Peer Support Network', category:'Mental Health', description:'One-on-one peer counseling and group support facilitated by people with lived experience.', phone:'1-800-555-0105', website:'', city:'Nationwide' },
  { id:6, title:'GED & Vocational Training', category:'Education', description:'Free GED prep, vocational certifications, and college enrollment assistance for returning citizens.', phone:'1-800-555-0106', website:'https://example.com', city:'Multiple Locations' },
];

const demoJobs = [
  { id:1, title:'Warehouse Associate', company:'Fresh Start Logistics', location:'Chicago, IL', salary:'$18-20/hr', type:'Full-time', description:'Picking, packing, and shipping in a supportive environment. Background-friendly employer.', posted_at: new Date().toISOString() },
  { id:2, title:'CDL Truck Driver', company:'Road to Recovery Transport', location:'Remote/Travel', salary:'$55,000-70,000/yr', type:'Full-time', description:'Long haul trucking. We help cover CDL costs. Felony-friendly. Medical included.', posted_at: new Date().toISOString() },
  { id:3, title:'Construction Laborer', company:'Build Again Construction', location:'Atlanta, GA', salary:'$16-22/hr', type:'Full-time', description:'General construction labor. On-the-job training. No background check for most positions.', posted_at: new Date().toISOString() },
];

const demoHousing = [
  { id:1, title:'Transitional House — Men', location:'Detroit, MI', rent:'$400/mo', bedrooms:'Shared', description:'Safe, sober transitional housing for men recently released. No background check required. Includes meals.', posted_at: new Date().toISOString() },
  { id:2, title:'2BR Apartment - Criminal Record OK', location:'Houston, TX', rent:'$850/mo', bedrooms:'2', description:'Landlord works with returning citizens. Background check reviewed holistically. Security deposit assistance available.', posted_at: new Date().toISOString() },
];

// ==================== API HELPERS ====================
async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  try {
    const res = await fetch(API + path, { ...options, headers });
    if (res.status === 401) { logout(); return null; }
    const data = await res.json();
    apiOnline = true;
    return { ok: res.ok, status: res.status, data };
  } catch {
    apiOnline = false;
    return null;
  }
}

// ==================== AUTH ====================
function setAuthMode(mode) {
  document.getElementById('login-form').style.display = mode === 'login' ? '' : 'none';
  document.getElementById('register-form').style.display = mode === 'register' ? '' : 'none';
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) return showToast('Fill in all fields', 'error');
  const r = await apiFetch('/api/auth/login', { method:'POST', body: JSON.stringify({email, password}) });
  if (r && r.ok) {
    token = r.data.token;
    currentUser = r.data.user;
    localStorage.setItem('ra_token', token);
    localStorage.setItem('ra_user', JSON.stringify(currentUser));
    closeModal('auth-modal');
    updateAuthUI();
    showToast('Welcome back, ' + currentUser.name + '! ✓', 'success');
    loadRollCall();
  } else {
    showToast((r && r.data && r.data.error) || 'Login failed', 'error');
  }
}

async function doRegister() {
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  if (!name || !email || !password) return showToast('Name, email, and password required', 'error');
  if (password.length < 6) return showToast('Password must be 6+ characters', 'error');
  const r = await apiFetch('/api/auth/register', { method:'POST', body: JSON.stringify({name, email, password}) });
  if (r && r.ok) {
    token = r.data.token;
    currentUser = r.data.user;
    localStorage.setItem('ra_token', token);
    localStorage.setItem('ra_user', JSON.stringify(currentUser));
    closeModal('auth-modal');
    updateAuthUI();
    showToast('Welcome to ReentryApp! ✓', 'success');
    loadRollCall();
  } else {
    showToast((r && r.data && r.data.error) || 'Registration failed', 'error');
  }
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('ra_token');
  localStorage.removeItem('ra_user');
  updateAuthUI();
  showToast('Logged out');
}

function updateAuthUI() {
  const loggedIn = !!currentUser;
  document.getElementById('btn-login').style.display = loggedIn ? 'none' : '';
  document.getElementById('btn-register').style.display = loggedIn ? 'none' : '';
  document.getElementById('btn-logout').style.display = loggedIn ? '' : 'none';
  document.getElementById('user-greeting').style.display = loggedIn ? '' : 'none';
  document.getElementById('tab-profile').style.display = loggedIn ? '' : 'none';
  if (loggedIn) {
    document.getElementById('user-greeting').textContent = 'Hi, ' + currentUser.name;
    updateProfilePage();
  }
}

function requireAuth(cb) {
  if (currentUser) { cb(); } else { openModal('auth-modal'); setAuthMode('register'); }
}

// ==================== TABS ====================
function showTab(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const page = document.getElementById('page-' + name);
  if (page) page.classList.add('active');
  document.querySelectorAll('.nav-tab').forEach(t => {
    if (t.textContent.toLowerCase().includes(name) || t.dataset.tab === name) {
      t.classList.add('active');
    }
  });
  if (name === 'resources') loadResources();
  if (name === 'jobs') loadJobs();
  if (name === 'housing') loadHousing();
  if (name === 'community') loadCommunity();
  if (name === 'rollcall') loadRollCall();
  if (name === 'profile' && currentUser) updateProfilePage();
}

// ==================== RESOURCES ====================
async function loadResources() {
  const r = await apiFetch('/api/resources');
  if (r && r.ok) {
    allResources = r.data;
  } else {
    allResources = demoResources;
  }
  renderResources();
}

function setResourceFilter(cat, btn) {
  resourceFilter = cat;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderResources();
}

function filterResources() { renderResources(); }

function renderResources() {
  const search = (document.getElementById('resource-search')?.value || '').toLowerCase();
  let list = allResources;
  if (resourceFilter !== 'all') list = list.filter(r => r.category === resourceFilter);
  if (search) list = list.filter(r => (r.title+r.description+r.category+r.city).toLowerCase().includes(search));
  document.getElementById('resource-count').textContent = list.length + ' resource' + (list.length !== 1 ? 's' : '');
  if (!list.length) {
    document.getElementById('resources-list').innerHTML = '<div class="empty-state"><div class="icon">&#128203;</div><p>No resources found.</p></div>';
    return;
  }
  const catColors = { Legal:'badge-blue', Housing:'badge-purple', Employment:'badge-green', 'Mental Health':'badge-yellow', Food:'badge-green', Education:'badge-blue' };
  document.getElementById('resources-list').innerHTML = '<div class="cards-grid">' + list.map(r => `
    <div class="card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.5rem;margin-bottom:0.5rem;">
        <div class="card-title">${esc(r.title)}</div>
        <span class="badge ${catColors[r.category]||'badge-purple'}">${esc(r.category)}</span>
      </div>
      <div class="card-meta">${r.city?'&#128205; '+esc(r.city):''}${r.phone?' | &#128222; '+esc(r.phone):''}</div>
      <div class="card-desc">${esc(r.description)}</div>
      ${safeUrl(r.website)?`<a href="${esc(safeUrl(r.website))}" target="_blank" rel="noopener" style="display:inline-block;margin-top:0.75rem;font-size:0.8rem;color:var(--accent);">Visit Website &#8599;</a>`:''}
    </div>`).join('') + '</div>';
}

// ==================== JOBS ====================
async function loadJobs() {
  const r = await apiFetch('/api/jobs');
  allJobs = (r && r.ok) ? r.data : demoJobs;
  renderJobs();
}

function filterJobs() { renderJobs(); }

function renderJobs() {
  const search = (document.getElementById('job-search')?.value || '').toLowerCase();
  let list = search ? allJobs.filter(j => (j.title+j.company+j.location+j.description).toLowerCase().includes(search)) : allJobs;
  if (!list.length) {
    document.getElementById('jobs-list').innerHTML = '<div class="empty-state"><div class="icon">&#128188;</div><p>No jobs found. Be the first to post one!</p></div>';
    return;
  }
  document.getElementById('jobs-list').innerHTML = list.map(j => `
    <div class="card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;">
        <div>
          <div class="card-title">${esc(j.title)}</div>
          <div class="card-meta">
            &#127970; ${esc(j.company||'')}
            ${j.location?' &bull; &#128205; '+esc(j.location):''}
            ${j.salary?' &bull; &#128176; '+esc(j.salary):''}
          </div>
        </div>
        <span class="badge badge-green">${esc(j.type||'Full-time')}</span>
      </div>
      <div class="card-desc" style="margin-top:0.5rem;">${esc(j.description||'')}</div>
      <div style="margin-top:0.75rem;font-size:0.78rem;color:var(--muted);">${timeAgo(j.posted_at)}</div>
    </div>`).join('');
}

async function submitJob() {
  const title = document.getElementById('job-title').value.trim();
  const company = document.getElementById('job-company').value.trim();
  if (!title || !company) return showToast('Title and company required', 'error');
  const body = {
    title, company,
    location: document.getElementById('job-location').value.trim(),
    salary: document.getElementById('job-salary').value.trim(),
    description: document.getElementById('job-desc').value.trim(),
    type: document.getElementById('job-type').value,
  };
  const r = await apiFetch('/api/jobs', { method:'POST', body: JSON.stringify(body) });
  if (r && r.ok) {
    closeModal('job-modal');
    clearFields(['job-title','job-company','job-location','job-salary','job-desc']);
    showToast('Job posted! ✓', 'success');
    loadJobs();
  } else { showToast('Failed to post job', 'error'); }
}

// ==================== HOUSING ====================
async function loadHousing() {
  const r = await apiFetch('/api/housing');
  allHousing = (r && r.ok) ? r.data : demoHousing;
  renderHousing();
}

function filterHousing() { renderHousing(); }

function renderHousing() {
  const search = (document.getElementById('housing-search')?.value || '').toLowerCase();
  let list = search ? allHousing.filter(h => (h.title+h.location+h.description).toLowerCase().includes(search)) : allHousing;
  if (!list.length) {
    document.getElementById('housing-list').innerHTML = '<div class="empty-state"><div class="icon">&#127968;</div><p>No housing listed. Add yours!</p></div>';
    return;
  }
  document.getElementById('housing-list').innerHTML = list.map(h => `
    <div class="card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;">
        <div>
          <div class="card-title">${esc(h.title)}</div>
          <div class="card-meta">
            &#128205; ${esc(h.location||'')}
            ${h.rent?' &bull; &#128176; '+esc(h.rent):''}
            ${h.bedrooms?' &bull; &#127968; '+esc(h.bedrooms)+' bed':''}
          </div>
        </div>
        <span class="badge badge-purple">Available</span>
      </div>
      <div class="card-desc" style="margin-top:0.5rem;">${esc(h.description||'')}</div>
      <div style="margin-top:0.75rem;font-size:0.78rem;color:var(--muted);">${timeAgo(h.posted_at)}</div>
    </div>`).join('');
}

async function submitHousing() {
  const title = document.getElementById('h-title').value.trim();
  const location = document.getElementById('h-location').value.trim();
  if (!title || !location) return showToast('Title and location required', 'error');
  const body = {
    title, location,
    rent: document.getElementById('h-rent').value.trim(),
    bedrooms: document.getElementById('h-bedrooms').value,
    description: document.getElementById('h-desc').value.trim(),
  };
  const r = await apiFetch('/api/housing', { method:'POST', body: JSON.stringify(body) });
  if (r && r.ok) {
    closeModal('housing-modal');
    clearFields(['h-title','h-location','h-rent','h-desc']);
    showToast('Housing listed! ✓', 'success');
    loadHousing();
  } else { showToast('Failed to list housing', 'error'); }
}

// ==================== COMMUNITY ====================
async function loadCommunity() {
  const r = await apiFetch('/api/community');
  const posts = (r && r.ok) ? r.data : [];
  if (!posts.length) {
    document.getElementById('community-list').innerHTML = `
      <div class="empty-state">
        <div class="icon">&#128101;</div>
        <p>No posts yet. Be the first to share!</p>
        <button type="button" class="btn btn-primary" style="margin-top:1rem" data-action data-require-auth data-open="post-modal">Share Your Story</button>
      </div>`;
    return;
  }
  document.getElementById('community-list').innerHTML = posts.map(p => `
    <div class="post-card">
      <div class="post-header">
        <div class="post-avatar">${esc((p.username||'A').charAt(0).toUpperCase())}</div>
        <div>
          <div class="post-author">${esc(p.username||'Anonymous')}</div>
          <div class="post-time">${timeAgo(p.created_at)}</div>
        </div>
      </div>
      <div class="post-content">${esc(p.content)}</div>
    </div>`).join('');
}

async function submitPost() {
  const content = document.getElementById('post-content').value.trim();
  if (!content) return showToast('Write something first', 'error');
  const r = await apiFetch('/api/community', { method:'POST', body: JSON.stringify({content}) });
  if (r && r.ok) {
    closeModal('post-modal');
    document.getElementById('post-content').value = '';
    showToast('Posted! ✓', 'success');
    loadCommunity();
  } else { showToast('Failed to post', 'error'); }
}

// ==================== ROLL CALL ====================
async function loadRollCall() {
  const today = new Date();
  document.getElementById('today-date').textContent = today.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  if (!currentUser) {
    document.getElementById('checkin-btn').textContent = 'Sign In to Check In';
    document.getElementById('checkin-btn').onclick = () => { openModal('auth-modal'); setAuthMode('login'); };
    document.getElementById('checkin-history').innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--muted);">Sign in to view your history</div>';
    return;
  }
  const r = await apiFetch('/api/rollcall');
  if (!r || !r.ok) {
    document.getElementById('checkin-history').innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--muted);">Could not load history</div>';
    return;
  }
  const records = r.data;
  const todayStr = new Date().toISOString().split('T')[0];
  const checkedToday = records.some(rec => rec.check_in_date === todayStr);
  const btn = document.getElementById('checkin-btn');
  if (checkedToday) {
    btn.textContent = '✓ Checked In Today';
    btn.disabled = true;
    btn.style.opacity = '0.6';
  } else {
    btn.textContent = 'Check In Today';
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.onclick = doCheckIn;
  }
  const streak = calcStreak(records);
  document.getElementById('streak-info').textContent = streak > 0 ? '🔥 ' + streak + '-day streak!' : '';
  document.getElementById('pstat-streak').textContent = streak;
  document.getElementById('pstat-checkins').textContent = records.length;
  if (!records.length) {
    document.getElementById('checkin-history').innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--muted);">No check-ins yet. Start today!</div>';
    return;
  }
  document.getElementById('checkin-history').innerHTML = records.slice(0,14).map(rec => `
    <div class="checkin-row">
      <span>${new Date(rec.check_in_date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</span>
      <span class="badge badge-green">&#10003; Checked In</span>
    </div>`).join('');
}

async function doCheckIn() {
  if (!currentUser) { openModal('auth-modal'); return; }
  const r = await apiFetch('/api/rollcall', { method:'POST', body: JSON.stringify({}) });
  if (r && r.ok) {
    showToast('Checked in! Keep it up ✓', 'success');
    loadRollCall();
  } else if (r && r.status === 409) {
    showToast('Already checked in today!', 'error');
  } else {
    showToast('Check-in failed', 'error');
  }
}

function calcStreak(records) {
  if (!records.length) return 0;
  const sorted = [...records].sort((a,b) => b.check_in_date.localeCompare(a.check_in_date));
  const today = new Date().toISOString().split('T')[0];
  let streak = 0;
  let current = today;
  for (const rec of sorted) {
    if (rec.check_in_date === current) {
      streak++;
      const d = new Date(current + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      current = d.toISOString().split('T')[0];
    } else { break; }
  }
  return streak;
}

// ==================== PROFILE ====================
function updateProfilePage() {
  if (!currentUser) return;
  document.getElementById('profile-initial').textContent = currentUser.name.charAt(0).toUpperCase();
  document.getElementById('profile-name').textContent = currentUser.name;
  document.getElementById('profile-email').textContent = currentUser.email || '';
  const joined = currentUser.created_at ? new Date(currentUser.created_at).toLocaleDateString('en-US', {month:'long', year:'numeric'}) : 'Today';
  document.getElementById('profile-joined').textContent = joined;
}

// ==================== UTILS ====================
// Only allow http(s) links in rendered hrefs. Bare domains such as
// "reentrycouncil.org" (how the server seeds resources) get https://;
// any other scheme (javascript:, data:, ...) is dropped so a stored URL
// can't become script.
function safeUrl(url) {
  const s = String(url || '').trim();
  if (/^https?:\/\/[^\s]+$/i.test(s)) return s;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/[^\s]*)?$/i.test(s)) return 'https://' + s;
  return '';
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return d.toLocaleDateString();
}

function clearFields(ids) { ids.forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; }); }

// ==================== MODALS ====================
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});

// ==================== TOAST ====================
let toastTimer;
function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.className = '', 3000);
}

// ==================== INIT ====================
document.getElementById('today-date').textContent = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
updateAuthUI();
loadResources();

// ==================== EVENT WIRING ====================
// Handlers are bound here instead of inline on*="" attributes so the CSP can
// keep helmet's defaults (script-src 'self', script-src-attr 'none').
const ACTION_CALLS = { submitPost, submitJob, submitHousing, logout, doRegister, doLogin, doCheckIn };
const INPUT_HANDLERS = { filterResources, filterJobs, filterHousing };

function runAction(el) {
  const d = el.dataset;
  if (d.tab) return showTab(d.tab);
  if (d.close) return closeModal(d.close);
  if (d.resourceFilter) return setResourceFilter(d.resourceFilter, el);
  if (d.open) {
    const go = () => { openModal(d.open); if (d.authMode) setAuthMode(d.authMode); };
    return 'requireAuth' in d ? requireAuth(go) : go();
  }
  if (d.authMode) return setAuthMode(d.authMode);
  if (d.call && ACTION_CALLS[d.call]) return ACTION_CALLS[d.call]();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el) runAction(el);
});
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-input]');
  if (el && INPUT_HANDLERS[el.dataset.input]) INPUT_HANDLERS[el.dataset.input]();
});
