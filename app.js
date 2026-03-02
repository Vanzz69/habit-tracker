/**
 * MOMENTUM — Habit Tracker v3
 * app.js — Full application module
 */

/* ═══════════════════════════════════════════════════════════
   STORAGE
═══════════════════════════════════════════════════════════ */
const Storage = (() => {
  const KEY = 'momentum_habits_v2';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const save = (data) => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} };
  return { load, save };
})();

/* ═══════════════════════════════════════════════════════════
   DATE UTILITIES
═══════════════════════════════════════════════════════════ */
const DateUtils = (() => {
  const today = () => new Date().toISOString().split('T')[0];
  const yesterday = () => { const d = new Date(); d.setDate(d.getDate()-1); return d.toISOString().split('T')[0]; };
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate()-n); return d.toISOString().split('T')[0]; };
  const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);
  const formatShort = (s) => new Date(s+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const formatFull  = () => new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const startOfWeek = (offsetWeeks=0) => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay() - offsetWeeks*7);
    return d.toISOString().split('T')[0];
  };
  const endOfWeek = (offsetWeeks=0) => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay() + 6 - offsetWeeks*7);
    return d.toISOString().split('T')[0];
  };
  return { today, yesterday, daysAgo, daysBetween, formatShort, formatFull, startOfWeek, endOfWeek };
})();

/* ═══════════════════════════════════════════════════════════
   HABIT LOGIC
═══════════════════════════════════════════════════════════ */
const HabitLogic = (() => {
  const getComp = (habit, date) => habit.completions.find(c => c.date === date) || null;
  const getTodayCount   = (habit) => { const r = getComp(habit, DateUtils.today()); return r ? r.count : 0; };
  const isDailyDoneToday = (habit) => habit.type === 'daily' && getTodayCount(habit) >= 1;

  const complete = (habit) => {
    const t = DateUtils.today(), ex = getComp(habit, t);
    if (habit.type === 'daily' && ex && ex.count >= 1) return habit;
    if (ex) ex.count += 1;
    else habit.completions.push({ date: t, count: 1 });
    recalcStreaks(habit); return habit;
  };

  const undo = (habit) => {
    const t = DateUtils.today(), ex = getComp(habit, t);
    if (!ex || ex.count <= 0) return habit;
    ex.count -= 1;
    if (ex.count === 0) habit.completions = habit.completions.filter(c => c.date !== t);
    recalcStreaks(habit); return habit;
  };

  const recalcStreaks = (habit) => {
    const active = new Set(habit.completions.filter(c => c.count > 0).map(c => c.date));
    if (!active.size) { habit.currentStreak = 0; habit.longestStreak = 0; return; }
    const sorted = [...active].sort();
    let longest = 1, cur = 1;
    for (let i = 1; i < sorted.length; i++) {
      DateUtils.daysBetween(sorted[i-1], sorted[i]) === 1 ? (cur++, longest = Math.max(longest, cur)) : (cur = 1);
    }
    habit.longestStreak = longest;
    let streak = 0, check = active.has(DateUtils.today()) ? DateUtils.today() : DateUtils.yesterday();
    while (active.has(check)) {
      streak++;
      const d = new Date(check+'T00:00:00'); d.setDate(d.getDate()-1);
      check = d.toISOString().split('T')[0];
    }
    habit.currentStreak = streak;
  };

  // Global metrics
  const getAuraIntensity   = (habits) => habits.reduce((s, h) => s + h.currentStreak, 0);
  const getDailyAlignment  = (habits) => {
    if (!habits.length) return 0;
    const done = habits.filter(h => h.completions.some(c => c.date === DateUtils.today() && c.count > 0)).length;
    return Math.round((done / habits.length) * 100);
  };
  const getDisciplineDepth = (habits) => {
    const all = new Set();
    habits.forEach(h => h.completions.forEach(c => { if (c.count > 0) all.add(c.date); }));
    return all.size;
  };

  // Per-habit stats
  const computeStats = (habit) => {
    const totalDays = DateUtils.daysBetween(habit.createdAt, DateUtils.today()) + 1;
    const active    = new Set(habit.completions.filter(c => c.count > 0).map(c => c.date));
    const total     = habit.completions.reduce((s, c) => s + c.count, 0);
    const compRate  = Math.min((total / Math.max(habit.goal, 1)) * 100, 100);
    const consist   = (active.size / Math.max(totalDays, 1)) * 100;
    const sratio    = habit.longestStreak > 0 ? habit.currentStreak / habit.longestStreak : 0;
    const hsi       = Math.min((compRate*0.4) + (consist*0.3) + (sratio*100*0.3), 100);

    const tw  = DateUtils.startOfWeek(0), lws = DateUtils.startOfWeek(1), lwe = DateUtils.endOfWeek(1);
    const thisWeek = habit.completions.filter(c => c.date >= tw).reduce((s,c)=>s+c.count,0);
    const lastWeek = habit.completions.filter(c => c.date >= lws && c.date <= lwe).reduce((s,c)=>s+c.count,0);
    const velocityPct = lastWeek === 0 ? (thisWeek > 0 ? 100 : 0) : Math.round(((thisWeek-lastWeek)/lastWeek)*100);

    const milestones   = [5,10,25,50,100,250,500,1000];
    const nextMS       = milestones.find(m => m > total) || total + 100;
    const prevMS       = milestones.filter(m => m <= total).pop() || 0;
    const msPct        = nextMS === prevMS ? 100 : Math.round(((total-prevMS)/(nextMS-prevMS))*100);

    return {
      totalCompletions: total, activeDays: active.size, totalDays,
      completionRate: Math.round(compRate*10)/10,
      consistency: Math.round(consist*10)/10,
      currentStreak: habit.currentStreak, longestStreak: habit.longestStreak,
      hsi: Math.round(hsi*10)/10,
      thisWeek, lastWeek, velocityPct,
      nextMilestone: nextMS, prevMilestone: prevMS, milestoneProgress: msPct,
    };
  };

  // Chart data
  const getLast14Days = (habit) => Array.from({length:14},(_,i) => {
    const date = DateUtils.daysAgo(13-i), rec = getComp(habit,date);
    return { date, count: rec ? rec.count : 0 };
  });
  const getLast30Days = (habit) => Array.from({length:30},(_,i) => {
    const date = DateUtils.daysAgo(29-i), rec = getComp(habit,date);
    return { date, count: rec ? rec.count : 0 };
  });
  const getAllTimeTrend = (habit) => {
    if (!habit.completions.length) return [];
    const sorted = [...habit.completions].sort((a,b)=>a.date.localeCompare(b.date));
    let run = 0;
    return sorted.map(c => { run += c.count; return { date: c.date, total: run }; });
  };

  return {
    complete, undo, recalcStreaks, isDailyDoneToday, getTodayCount,
    getAuraIntensity, getDailyAlignment, getDisciplineDepth,
    computeStats, getLast14Days, getLast30Days, getAllTimeTrend,
  };
})();

/* ═══════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════ */
const state = {
  habits: Storage.load(),
  currentView: 'habits',
  editingId: null, deletingId: null, selectedHabitId: null,
  charts: {},
};

/* ═══════════════════════════════════════════════════════════
   UI HELPERS
═══════════════════════════════════════════════════════════ */
const $ = (id) => document.getElementById(id);
const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const showModal = (id) => { $(id).hidden = false; $('modalBackdrop').hidden = false; };
const hideModal = (id) => { $(id).hidden = true;  $('modalBackdrop').hidden = true; };
const hideAllModals = () => { ['habitModal','deleteModal'].forEach(id=>$(id).hidden=true); $('modalBackdrop').hidden=true; };

/* ═══════════════════════════════════════════════════════════
   RENDER: HABIT CARD
═══════════════════════════════════════════════════════════ */
const renderHabitCard = (habit) => {
  const todayCount    = HabitLogic.getTodayCount(habit);
  const totalDone     = habit.completions.reduce((s,c)=>s+c.count,0);
  const pct           = Math.min(Math.round((totalDone / Math.max(habit.goal,1))*100),100);
  const isDaily       = habit.type === 'daily';
  const doneTodayFlag = HabitLogic.isDailyDoneToday(habit);
  const hasToday      = todayCount > 0;

  // Weekly dots: last 7 days
  const dots = Array.from({length:7},(_,i) => {
    const date = DateUtils.daysAgo(6-i);
    const rec  = habit.completions.find(c => c.date === date);
    return `<span class="week-dot${rec && rec.count > 0 ? ' week-dot--on' : ''}" title="${date}"></span>`;
  }).join('');

  const card = document.createElement('article');
  card.className = `habit-card${hasToday ? ' completed-today' : ''}`;
  card.dataset.id = habit.id;
  card.innerHTML = `
    <div class="habit-main">
      <div class="habit-top">
        <span class="habit-type-badge">${habit.type}</span>
        <span class="habit-name">${esc(habit.name)}</span>
      </div>
      <div class="habit-week-dots">${dots}</div>
      <div class="habit-meta">
        <span class="habit-stat">🔥 <strong>${habit.currentStreak}</strong> streak</span>
        <span class="habit-stat">↑ <strong>${habit.longestStreak}</strong> best</span>
        <span class="habit-stat">✓ <strong>${totalDone}</strong> / ${habit.goal}</span>
      </div>
      <div class="progress-wrap">
        <div class="progress-bar">
          <div class="progress-fill${pct>=100?' full':''}" style="width:${pct}%"></div>
        </div>
        <span class="progress-pct">${pct}%</span>
      </div>
    </div>
    <div class="habit-actions">
      <div class="counter-row">
        <button class="counter-btn undo-btn" data-id="${habit.id}" aria-label="Undo"${!hasToday?' disabled':''}>−</button>
        <span class="counter-val">${isDaily ? (doneTodayFlag?'✓':'○') : '×'+todayCount}</span>
        <button class="counter-btn complete-btn" data-id="${habit.id}" aria-label="Complete"${isDaily&&doneTodayFlag?' disabled':''}>+</button>
      </div>
      <div class="icon-actions">
        <button class="icon-btn edit-btn" data-id="${habit.id}" title="Edit">✎</button>
        <button class="icon-btn delete icon-btn-delete" data-id="${habit.id}" title="Delete">⌫</button>
      </div>
    </div>
  `;
  return card;
};

/* ═══════════════════════════════════════════════════════════
   RENDER: HABITS VIEW
═══════════════════════════════════════════════════════════ */
const renderHabitsView = () => {
  const strip = $('summaryStrip');
  const aura  = HabitLogic.getAuraIntensity(state.habits);
  const align = HabitLogic.getDailyAlignment(state.habits);
  const depth = HabitLogic.getDisciplineDepth(state.habits);

  strip.innerHTML = `
    <div class="summary-card">
      <div class="summary-label">⚡ Aura Intensity</div>
      <div class="summary-value">${aura}</div>
      <div class="summary-sub">Sum of all active streaks</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">◎ Daily Alignment</div>
      <div class="summary-value">${align}<span style="font-size:1.1rem;font-weight:500">%</span></div>
      <div class="summary-sub">Habits completed today</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">◈ Discipline Depth</div>
      <div class="summary-value">${depth}</div>
      <div class="summary-sub">Total active days ever</div>
    </div>
  `;

  const list = $('habitsList');
  list.innerHTML = '';
  if (state.habits.length === 0) {
    $('emptyState').hidden = false; strip.hidden = true;
  } else {
    $('emptyState').hidden = true; strip.hidden = false;
    state.habits.forEach(h => list.appendChild(renderHabitCard(h)));
  }
};

/* ═══════════════════════════════════════════════════════════
   RENDER: DASHBOARD
═══════════════════════════════════════════════════════════ */
const renderDashboard = () => {
  const sel = $('dashboardSelect');
  sel.innerHTML = '';
  if (!state.habits.length) {
    $('dashboardSelectWrap').hidden = true;
    $('dashboardContent').hidden = true;
    $('dashboardEmpty').hidden = false;
    return;
  }
  $('dashboardEmpty').hidden = true;
  $('dashboardSelectWrap').hidden = false;
  state.habits.forEach(h => {
    const o = document.createElement('option');
    o.value = h.id; o.textContent = h.name; sel.appendChild(o);
  });
  if (state.selectedHabitId) sel.value = state.selectedHabitId;
  else { state.selectedHabitId = state.habits[0].id; sel.value = state.selectedHabitId; }
  renderDashboardStats();
};

const milestoneBadge = (n) => n<=10?'🌱':n<=25?'⭐':n<=50?'🔥':n<=100?'💎':n<=250?'🏆':n<=500?'👑':'🌟';

const renderDashboardStats = () => {
  const habit = state.habits.find(h => h.id === state.selectedHabitId);
  if (!habit) return;
  $('dashboardContent').hidden = false;
  const s = HabitLogic.computeStats(habit);

  $('statsGrid').innerHTML = `
    <!-- MILESTONE -->
    <div class="stat-card stat-card--milestone">
      <div class="milestone-header">
        <div>
          <div class="milestone-title">🏆 Milestone Tracker</div>
          <div class="milestone-sub">
            <strong>${s.totalCompletions}</strong> logs ·
            <span class="milestone-next">${s.nextMilestone - s.totalCompletions} away from
              <strong>${s.nextMilestone}</strong> ${milestoneBadge(s.nextMilestone)}
            </span>
          </div>
        </div>
        <div class="milestone-badge-icon">${milestoneBadge(s.nextMilestone)}</div>
      </div>
      <div class="milestone-bar-wrap">
        <div class="milestone-bar">
          <div class="milestone-fill" style="width:${s.milestoneProgress}%"></div>
        </div>
        <span class="milestone-pct">${s.milestoneProgress}%</span>
      </div>
      <div class="milestone-labels">
        <span>${s.prevMilestone}</span>
        <span>${s.nextMilestone}</span>
      </div>
    </div>

    <!-- STRENGTH INDEX -->
    <div class="stat-card">
      <div class="stat-card__accent stat-card__accent--purple">◈</div>
      <div class="stat-card__value">${s.hsi}</div>
      <div class="stat-card__label">Strength Index</div>
      <div class="stat-card__sub">Consistency · Streak · Volume</div>
      <div class="mini-bar"><div class="mini-fill mini-fill--purple" style="width:${s.hsi}%"></div></div>
    </div>

    <!-- CURRENT STREAK -->
    <div class="stat-card">
      <div class="stat-card__accent stat-card__accent--amber">🔥</div>
      <div class="stat-card__value">${s.currentStreak}</div>
      <div class="stat-card__label">Current Streak</div>
      <div class="stat-card__sub">Best ever: ${s.longestStreak} days</div>
      <div class="mini-bar">
        <div class="mini-fill mini-fill--amber"
          style="width:${s.longestStreak>0?Math.round((s.currentStreak/s.longestStreak)*100):0}%">
        </div>
      </div>
    </div>

    <!-- VELOCITY -->
    <div class="stat-card">
      <div class="stat-card__accent ${s.velocityPct>=0?'stat-card__accent--green':'stat-card__accent--red'}">
        ${s.velocityPct>=0?'↑':'↓'}
      </div>
      <div class="stat-card__value velocity-val ${s.velocityPct>=0?'pos':'neg'}">
        ${s.velocityPct>=0?'+':''}${s.velocityPct}%
      </div>
      <div class="stat-card__label">Velocity</div>
      <div class="stat-card__sub">This week <strong>${s.thisWeek}</strong> vs last <strong>${s.lastWeek}</strong></div>
    </div>
  `;

  renderCharts(habit, s);
};

/* ═══════════════════════════════════════════════════════════
   CHARTS
═══════════════════════════════════════════════════════════ */
const C = {
  accent:'#7c6bff', accent2:'#c084fc', green:'#34d399',
  amber:'#fbbf24',  red:'#f87171',     blue:'#60a5fa',
  grid:'rgba(255,255,255,0.05)', text:'#6b6890',
};

const destroyCharts = () => {
  Object.values(state.charts).forEach(c => { try { c.destroy(); } catch {} });
  state.charts = {};
};

const baseScales = () => ({
  x: { grid:{color:C.grid}, ticks:{color:C.text, font:{family:'DM Sans',size:11}} },
  y: { grid:{color:C.grid}, ticks:{color:C.text, font:{family:'DM Sans',size:11}}, beginAtZero:true },
});

const renderCharts = (habit) => {
  destroyCharts();
  const last14  = HabitLogic.getLast14Days(habit);
  const last30  = HabitLogic.getLast30Days(habit);
  const allTime = HabitLogic.getAllTimeTrend(habit);

  renderHeatmap(last30);

  /* ── SUCCESS RATE (line) ── */
  const srCtx = $('successRateChart').getContext('2d');
  const srGrad = srCtx.createLinearGradient(0,0,0,180);
  srGrad.addColorStop(0,'rgba(124,107,255,0.3)'); srGrad.addColorStop(1,'rgba(124,107,255,0)');
  const srData = last14.map(d => d.count > 0 ? 100 : 0);
  state.charts.sr = new Chart(srCtx, {
    type: 'line',
    data: {
      labels: last14.map(d => DateUtils.formatShort(d.date)),
      datasets: [{
        data: srData, borderColor: C.accent, backgroundColor: srGrad,
        borderWidth: 2.5, tension: 0.35, fill: true,
        pointRadius: 4,
        pointBackgroundColor: srData.map(v => v===100 ? C.green : 'rgba(248,113,113,0.7)'),
      }]
    },
    options: {
      responsive: true, plugins:{legend:{display:false}},
      scales: { ...baseScales(), y:{ ...baseScales().y, max:100, ticks:{...baseScales().y.ticks, callback:v=>v+'%'} } },
      animation:{duration:600}
    }
  });

  /* ── WEEKLY COMPARISON (grouped bar) ── */
  const buildWeekDays = (offset) => Array.from({length:7},(_,i) => {
    const base = new Date(DateUtils.startOfWeek(offset)+'T00:00:00');
    base.setDate(base.getDate()+i);
    const ds = base.toISOString().split('T')[0];
    const rec = habit.completions.find(c=>c.date===ds);
    return rec ? rec.count : 0;
  });
  const wkCtx = $('weekCompChart').getContext('2d');
  state.charts.wk = new Chart(wkCtx, {
    type: 'bar',
    data: {
      labels: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
      datasets: [
        { label:'This week', data:buildWeekDays(0), backgroundColor:'rgba(124,107,255,0.75)', borderRadius:5, borderSkipped:false },
        { label:'Last week',  data:buildWeekDays(1), backgroundColor:'rgba(96,165,250,0.4)',   borderRadius:5, borderSkipped:false },
      ]
    },
    options: {
      responsive: true,
      plugins:{ legend:{ display:true, labels:{color:C.text,font:{family:'DM Sans',size:11},boxWidth:12} } },
      scales: baseScales(), animation:{duration:700}
    }
  });

  /* ── ALL-TIME TREND (line) ── */
  const atCtx = $('allTimeTrendChart').getContext('2d');
  const atGrad = atCtx.createLinearGradient(0,0,0,200);
  atGrad.addColorStop(0,'rgba(52,211,153,0.35)'); atGrad.addColorStop(1,'rgba(52,211,153,0)');
  const atLabels = allTime.map(d => DateUtils.formatShort(d.date));
  const atData   = allTime.map(d => d.total);
  state.charts.at = new Chart(atCtx, {
    type: 'line',
    data: {
      labels: atLabels.length ? atLabels : ['–'],
      datasets: [{
        data: atData.length ? atData : [0],
        borderColor: C.green, backgroundColor: atGrad,
        borderWidth: 2.5, tension: 0.4, fill: true,
        pointRadius: atData.length > 30 ? 0 : 3,
        pointBackgroundColor: C.green,
      }]
    },
    options: { responsive:true, plugins:{legend:{display:false}}, scales:baseScales(), animation:{duration:800} }
  });
};

/* ── HEATMAP (vanilla canvas) ─────────────────────────── */
const renderHeatmap = (last30) => {
  const canvas = $('heatmapCanvas');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const COLS = 10, ROWS = 3;
  const containerW = canvas.parentElement.clientWidth - 32;
  const cell = Math.floor((containerW - (COLS-1)*4) / COLS);
  const gap  = 4;
  const W = COLS*(cell+gap)-gap, H = ROWS*(cell+gap)-gap;

  canvas.width  = W*dpr; canvas.height = H*dpr;
  canvas.style.width = W+'px'; canvas.style.height = H+'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const maxCount = Math.max(...last30.map(d=>d.count), 1);

  last30.forEach((d,i) => {
    const col = i%COLS, row = Math.floor(i/COLS);
    const x = col*(cell+gap), y = row*(cell+gap);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.beginPath(); ctx.roundRect(x,y,cell,cell,4); ctx.fill();
    if (d.count > 0) {
      const intensity = d.count/maxCount;
      ctx.fillStyle = `rgba(124,107,255,${0.2+intensity*0.8})`;
      ctx.beginPath(); ctx.roundRect(x,y,cell,cell,4); ctx.fill();
      if (intensity > 0.5) {
        ctx.fillStyle = `rgba(192,132,252,${intensity*0.5})`;
        ctx.beginPath(); ctx.roundRect(x+2,y+2,cell-4,cell-4,3); ctx.fill();
      }
    }
  });
};

/* ═══════════════════════════════════════════════════════════
   VIEW SWITCHING
═══════════════════════════════════════════════════════════ */
const switchView = (view) => {
  state.currentView = view;
  $('habitsView').classList.toggle('hidden', view!=='habits');
  $('dashboardView').classList.toggle('hidden', view!=='dashboard');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view===view));
  $('topbarTitle').textContent = view==='habits' ? "Today's Habits" : 'Dashboard';
  $('addHabitBtn').hidden = view !== 'habits';
  if (view==='dashboard') renderDashboard();
  closeSidebar();
};

/* ═══════════════════════════════════════════════════════════
   SIDEBAR
═══════════════════════════════════════════════════════════ */
let overlay = null;
const openSidebar  = () => {
  $('sidebar').classList.add('open');
  if (!overlay) { overlay = document.createElement('div'); overlay.className='sidebar-overlay'; document.body.appendChild(overlay); overlay.addEventListener('click',closeSidebar); }
  overlay.classList.add('active');
};
const closeSidebar = () => { $('sidebar').classList.remove('open'); if(overlay) overlay.classList.remove('active'); };

/* ═══════════════════════════════════════════════════════════
   HABIT MODAL
═══════════════════════════════════════════════════════════ */
let selectedType = 'daily';
const openAddModal = () => {
  state.editingId=null; selectedType='daily';
  $('modalTitle').textContent='New Habit'; $('modalSave').textContent='Create Habit';
  $('habitName').value=''; $('habitGoal').value='';
  setTypeActive('daily'); showModal('habitModal');
  setTimeout(()=>$('habitName').focus(),50);
};
const openEditModal = (id) => {
  const h = state.habits.find(h=>h.id===id); if(!h) return;
  state.editingId=id; selectedType=h.type;
  $('modalTitle').textContent='Edit Habit'; $('modalSave').textContent='Save Changes';
  $('habitName').value=h.name; $('habitGoal').value=h.goal;
  setTypeActive(h.type); showModal('habitModal');
  setTimeout(()=>$('habitName').focus(),50);
};
const setTypeActive = (type) => {
  selectedType=type;
  $('typeDaily').classList.toggle('active',type==='daily');
  $('typeFlexible').classList.toggle('active',type==='flexible');
};
const saveHabit = () => {
  const name=($('habitName').value||'').trim(), goal=parseInt($('habitGoal').value,10);
  let ok=true;
  if(!name){$('habitName').classList.add('error');ok=false;}else $('habitName').classList.remove('error');
  if(!goal||goal<1){$('habitGoal').classList.add('error');ok=false;}else $('habitGoal').classList.remove('error');
  if(!ok) return;
  if(state.editingId){
    const h=state.habits.find(h=>h.id===state.editingId);
    if(h){h.name=name;h.goal=goal;h.type=selectedType;}
  } else {
    state.habits.push({id:crypto.randomUUID(),name,goal,type:selectedType,createdAt:DateUtils.today(),completions:[],currentStreak:0,longestStreak:0});
  }
  Storage.save(state.habits); hideModal('habitModal'); renderHabitsView();
};

/* ═══════════════════════════════════════════════════════════
   DELETE MODAL
═══════════════════════════════════════════════════════════ */
const openDeleteModal = (id) => {
  const h=state.habits.find(h=>h.id===id); if(!h) return;
  state.deletingId=id; $('deleteHabitName').textContent=h.name; showModal('deleteModal');
};
const confirmDelete = () => {
  state.habits=state.habits.filter(h=>h.id!==state.deletingId);
  if(state.selectedHabitId===state.deletingId) state.selectedHabitId=null;
  Storage.save(state.habits); hideModal('deleteModal'); renderHabitsView();
  if(state.currentView==='dashboard') renderDashboard();
};

/* ═══════════════════════════════════════════════════════════
   COMPLETE / UNDO
═══════════════════════════════════════════════════════════ */
const completeHabit = (id) => {
  const h=state.habits.find(h=>h.id===id); if(!h) return;
  HabitLogic.complete(h); Storage.save(state.habits); renderHabitsView();
};
const undoHabit = (id) => {
  const h=state.habits.find(h=>h.id===id); if(!h) return;
  HabitLogic.undo(h); Storage.save(state.habits); renderHabitsView();
};

/* ═══════════════════════════════════════════════════════════
   EVENTS
═══════════════════════════════════════════════════════════ */
const initEvents = () => {
  document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click',()=>switchView(b.dataset.view)));
  $('addHabitBtn').addEventListener('click',openAddModal);
  $('emptyAddBtn').addEventListener('click',openAddModal);
  $('menuBtn').addEventListener('click',openSidebar);
  $('sidebarClose').addEventListener('click',closeSidebar);

  $('habitsList').addEventListener('click',(e)=>{
    const cb=e.target.closest('.complete-btn'); if(cb){completeHabit(cb.dataset.id);return;}
    const ub=e.target.closest('.undo-btn');    if(ub){undoHabit(ub.dataset.id);return;}
    const eb=e.target.closest('.edit-btn');    if(eb){openEditModal(eb.dataset.id);return;}
    const db=e.target.closest('.icon-btn-delete'); if(db){openDeleteModal(db.dataset.id);return;}
  });

  $('typeDaily').addEventListener('click',()=>setTypeActive('daily'));
  $('typeFlexible').addEventListener('click',()=>setTypeActive('flexible'));
  $('modalSave').addEventListener('click',saveHabit);
  $('modalCancel').addEventListener('click',()=>hideModal('habitModal'));
  $('modalClose').addEventListener('click',()=>hideModal('habitModal'));
  $('deleteConfirmBtn').addEventListener('click',confirmDelete);
  $('deleteCancelBtn').addEventListener('click',()=>hideModal('deleteModal'));
  $('deleteModalClose').addEventListener('click',()=>hideModal('deleteModal'));
  $('modalBackdrop').addEventListener('click',hideAllModals);
  $('dashboardSelect').addEventListener('change',(e)=>{state.selectedHabitId=e.target.value;renderDashboardStats();});
  document.addEventListener('keydown',(e)=>{if(e.key==='Escape')hideAllModals();});
  [$('habitName'),$('habitGoal')].forEach(el=>el.addEventListener('keydown',(e)=>{if(e.key==='Enter')saveHabit();}));
  window.addEventListener('resize',()=>{
    if(state.currentView==='dashboard'&&state.selectedHabitId){
      const h=state.habits.find(h=>h.id===state.selectedHabitId);
      if(h) renderHeatmap(HabitLogic.getLast30Days(h));
    }
  });
};

/* ═══════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════ */
const init = () => {
  state.habits.forEach(h=>HabitLogic.recalcStreaks(h));
  Storage.save(state.habits);
  $('sidebarDate').textContent = DateUtils.formatFull();
  initEvents();
  renderHabitsView();
  if('serviceWorker' in navigator)
    window.addEventListener('load',()=>navigator.serviceWorker.register('service-worker.js').catch(()=>{}));
};

document.addEventListener('DOMContentLoaded', init);
