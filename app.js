/**
 * MOMENTUM — app.js v6
 * Features: onboarding, skeleton loader, bottom nav, completion animation,
 * drag-to-reorder, empty dashboard state, auth screens
 */

import {
  auth, onAuthStateChanged,
  signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, logOut,
  saveHabitsToCloud, loadHabitsFromCloud, subscribeToHabits,
} from './firebase.js';

/* ═══════════════════════════════════════════════════════════
   LOCAL STORAGE
═══════════════════════════════════════════════════════════ */
const LocalStorage = (() => {
  const KEY = 'momentum_habits_v2';
  const OB  = 'momentum_onboarded';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const save = (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} };
  const hasOnboarded = () => !!localStorage.getItem(OB);
  const setOnboarded = () => localStorage.setItem(OB, '1');
  return { load, save, hasOnboarded, setOnboarded };
})();

/* ═══════════════════════════════════════════════════════════
   DATE UTILITIES
═══════════════════════════════════════════════════════════ */
const DateUtils = (() => {
  const today = () => new Date().toISOString().split('T')[0];
  const yesterday = () => { const d=new Date(); d.setDate(d.getDate()-1); return d.toISOString().split('T')[0]; };
  const daysAgo = (n) => { const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().split('T')[0]; };
  const daysBetween = (a,b) => Math.floor((new Date(b)-new Date(a))/86400000);
  const formatShort = (s) => new Date(s+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const formatFull  = () => new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const startOfWeek = (off=0) => { const d=new Date(); d.setDate(d.getDate()-d.getDay()-off*7); return d.toISOString().split('T')[0]; };
  const endOfWeek   = (off=0) => { const d=new Date(); d.setDate(d.getDate()-d.getDay()+6-off*7); return d.toISOString().split('T')[0]; };
  return { today, yesterday, daysAgo, daysBetween, formatShort, formatFull, startOfWeek, endOfWeek };
})();

/* ═══════════════════════════════════════════════════════════
   HABIT LOGIC
═══════════════════════════════════════════════════════════ */
const HabitLogic = (() => {
  const getComp = (h,date) => h.completions.find(c=>c.date===date)||null;
  const getTodayCount    = (h) => { const r=getComp(h,DateUtils.today()); return r?r.count:0; };
  const isDailyDoneToday = (h) => h.type==='daily' && getTodayCount(h)>=1;

  const complete = (h) => {
    const t=DateUtils.today(), ex=getComp(h,t);
    if(h.type==='daily'&&ex&&ex.count>=1) return h;
    if(ex) ex.count+=1; else h.completions.push({date:t,count:1});
    recalcStreaks(h); return h;
  };

  const undo = (h) => {
    const t=DateUtils.today(), ex=getComp(h,t);
    if(!ex||ex.count<=0) return h;
    ex.count-=1;
    if(ex.count===0) h.completions=h.completions.filter(c=>c.date!==t);
    recalcStreaks(h); return h;
  };

  const recalcStreaks = (h) => {
    const active=new Set(h.completions.filter(c=>c.count>0).map(c=>c.date));
    if(!active.size){h.currentStreak=0;h.longestStreak=0;return;}
    const sorted=[...active].sort();
    let longest=1,cur=1;
    for(let i=1;i<sorted.length;i++)
      DateUtils.daysBetween(sorted[i-1],sorted[i])===1?(cur++,longest=Math.max(longest,cur)):(cur=1);
    h.longestStreak=longest;
    let streak=0,check=active.has(DateUtils.today())?DateUtils.today():DateUtils.yesterday();
    while(active.has(check)){streak++;const d=new Date(check+'T00:00:00');d.setDate(d.getDate()-1);check=d.toISOString().split('T')[0];}
    h.currentStreak=streak;
  };

  const getAuraIntensity  = (habits) => habits.reduce((s,h)=>s+h.currentStreak,0);
  const getDailyAlignment = (habits) => {
    if(!habits.length) return 0;
    return Math.round((habits.filter(h=>h.completions.some(c=>c.date===DateUtils.today()&&c.count>0)).length/habits.length)*100);
  };
  const getDisciplineDepth = (habits) => {
    const all=new Set();
    habits.forEach(h=>h.completions.forEach(c=>{if(c.count>0)all.add(c.date);}));
    return all.size;
  };

  const computeStats = (h) => {
    const totalDays=DateUtils.daysBetween(h.createdAt,DateUtils.today())+1;
    const active=new Set(h.completions.filter(c=>c.count>0).map(c=>c.date));
    const total=h.completions.reduce((s,c)=>s+c.count,0);
    const compRate=Math.min((total/Math.max(h.goal,1))*100,100);
    const consist=(active.size/Math.max(totalDays,1))*100;
    const sratio=h.longestStreak>0?h.currentStreak/h.longestStreak:0;
    const hsi=Math.min((compRate*0.4)+(consist*0.3)+(sratio*100*0.3),100);
    const tw=DateUtils.startOfWeek(0),lws=DateUtils.startOfWeek(1),lwe=DateUtils.endOfWeek(1);
    const thisWeek=h.completions.filter(c=>c.date>=tw).reduce((s,c)=>s+c.count,0);
    const lastWeek=h.completions.filter(c=>c.date>=lws&&c.date<=lwe).reduce((s,c)=>s+c.count,0);
    const velocityPct=lastWeek===0?(thisWeek>0?100:0):Math.round(((thisWeek-lastWeek)/lastWeek)*100);
    const isMSDaily=h.type==='daily', msValue=isMSDaily?active.size:total;
    const milestones=isMSDaily?[7,14,21,30,45,60,75,90,120,150,180,210,270,365]:[5,10,25,50,100,250,500,1000];
    const nextMS=milestones.find(m=>m>msValue)||msValue+(isMSDaily?30:100);
    const prevMS=milestones.filter(m=>m<=msValue).pop()||0;
    const msPct=nextMS===prevMS?100:Math.round(((msValue-prevMS)/(nextMS-prevMS))*100);
    return {
      totalCompletions:total,activeDays:active.size,totalDays,
      completionRate:Math.round(compRate*10)/10,consistency:Math.round(consist*10)/10,
      currentStreak:h.currentStreak,longestStreak:h.longestStreak,
      hsi:Math.round(hsi*10)/10,thisWeek,lastWeek,velocityPct,
      nextMilestone:nextMS,prevMilestone:prevMS,milestoneProgress:msPct,msValue,isMSDaily,
      hasData: total > 0,
    };
  };

  const getLast14Days = (h) => Array.from({length:14},(_,i)=>{const date=DateUtils.daysAgo(13-i),rec=getComp(h,date);return{date,count:rec?rec.count:0};});
  const getLast30Days = (h) => Array.from({length:30},(_,i)=>{const date=DateUtils.daysAgo(29-i),rec=getComp(h,date);return{date,count:rec?rec.count:0};});
  const getAllTimeTrend= (h) => {
    if(!h.completions.length) return [];
    let run=0;
    return [...h.completions].sort((a,b)=>a.date.localeCompare(b.date)).map(c=>{run+=c.count;return{date:c.date,total:run};});
  };

  return { complete,undo,recalcStreaks,isDailyDoneToday,getTodayCount,
    getAuraIntensity,getDailyAlignment,getDisciplineDepth,
    computeStats,getLast14Days,getLast30Days,getAllTimeTrend };
})();

/* ═══════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════ */
const state = {
  habits:[],currentView:'habits',
  editingId:null,deletingId:null,selectedHabitId:null,
  charts:{},user:null,isOfflineMode:false,unsubscribeSync:null,
  dragSrcIndex:null,
};

/* ═══════════════════════════════════════════════════════════
   SYNC
═══════════════════════════════════════════════════════════ */
let syncTimeout=null;
const saveHabits = async () => {
  LocalStorage.save(state.habits);
  if(state.user&&!state.isOfflineMode){
    clearTimeout(syncTimeout);
    syncTimeout=setTimeout(async()=>{
      showSyncToast('Syncing…');
      await saveHabitsToCloud(state.user.uid,state.habits);
      showSyncToast('Synced ✓',true);
    },1000);
  }
};

const showSyncToast = (msg,success=false) => {
  const t=document.getElementById('syncToast'); if(!t) return;
  t.textContent=msg; t.className='sync-toast show'+(success?' success':'');
  if(success) setTimeout(()=>t.classList.remove('show'),2000);
};

/* ═══════════════════════════════════════════════════════════
   GLOBAL LOADER
═══════════════════════════════════════════════════════════ */
const showGlobalLoader = () => document.getElementById('globalLoader').classList.remove('hidden');
const hideGlobalLoader = () => document.getElementById('globalLoader').classList.add('fade-out',()=>{});

/* ═══════════════════════════════════════════════════════════
   ONBOARDING
═══════════════════════════════════════════════════════════ */
let obStep = 0;
const initOnboarding = () => {
  const ob = document.getElementById('onboarding');
  ob.classList.remove('hidden');
  updateObStep(0);

  document.getElementById('obNextBtn').addEventListener('click', () => {
    if(obStep < 3) { obStep++; updateObStep(obStep); }
    else finishOnboarding();
  });
  document.getElementById('obSkipBtn').addEventListener('click', finishOnboarding);
};

const updateObStep = (step) => {
  document.querySelectorAll('.onboarding-step').forEach(s => s.classList.toggle('active', parseInt(s.dataset.step)===step));
  document.querySelectorAll('.ob-dot').forEach(d => d.classList.toggle('active', parseInt(d.dataset.dot)===step));
  document.getElementById('obNextBtn').textContent = step === 3 ? "Let's Go 🚀" : 'Next';
  document.getElementById('obSkipBtn').style.visibility = step === 3 ? 'hidden' : 'visible';
};

const finishOnboarding = () => {
  LocalStorage.setOnboarded();
  document.getElementById('onboarding').classList.add('hidden');
  showScreen('loginScreen');
};

/* ═══════════════════════════════════════════════════════════
   SKELETON LOADER
═══════════════════════════════════════════════════════════ */
const showSkeleton = () => {
  document.getElementById('habitsSkeleton').classList.remove('hidden');
  document.getElementById('habitsContent').classList.add('hidden');
};
const hideSkeleton = () => {
  document.getElementById('habitsSkeleton').classList.add('hidden');
  document.getElementById('habitsContent').classList.remove('hidden');
};

/* ═══════════════════════════════════════════════════════════
   SCREEN NAVIGATION
═══════════════════════════════════════════════════════════ */
const screens = ['loginScreen','signupScreen','forgotScreen','app','onboarding'];
const showScreen = (id) => {
  screens.forEach(s => document.getElementById(s).classList.toggle('hidden', s!==id));
};

/* ═══════════════════════════════════════════════════════════
   AUTH EVENTS
═══════════════════════════════════════════════════════════ */
const initAuthEvents = () => {
  document.getElementById('goToSignupBtn').addEventListener('click',()=>showScreen('signupScreen'));
  document.getElementById('goToForgotBtn').addEventListener('click',()=>showScreen('forgotScreen'));
  document.getElementById('backToLoginFromSignup').addEventListener('click',()=>showScreen('loginScreen'));
  document.getElementById('backToLoginFromForgot').addEventListener('click',()=>showScreen('loginScreen'));
  document.getElementById('goToLoginFromSignup').addEventListener('click',()=>showScreen('loginScreen'));
  document.getElementById('goToLoginFromForgot').addEventListener('click',()=>showScreen('loginScreen'));

  const handleGoogle = async (errorId) => {
    document.getElementById(errorId).textContent='';
    try { await signInWithGoogle(); }
    catch { document.getElementById(errorId).textContent='Google sign-in failed. Try again.'; }
  };
  document.getElementById('googleSignInBtn').addEventListener('click',()=>handleGoogle('loginError'));
  document.getElementById('googleSignUpBtn').addEventListener('click',()=>handleGoogle('signupError'));

  document.getElementById('loginBtn').addEventListener('click', async () => {
    const err=document.getElementById('loginError'); err.textContent='';
    const email=document.getElementById('loginEmail').value.trim();
    const pass=document.getElementById('loginPassword').value;
    if(!email||!pass){err.textContent='Please enter your email and password.';return;}
    try { await signInWithEmail(email,pass); }
    catch(e){ err.textContent=e.code==='auth/invalid-credential'?'Wrong email or password.':'Login failed.'; }
  });

  document.getElementById('signupBtn').addEventListener('click', async () => {
    const err=document.getElementById('signupError'); err.textContent='';
    const name=document.getElementById('signupName').value.trim();
    const email=document.getElementById('signupEmail').value.trim();
    const pass=document.getElementById('signupPassword').value;
    const confirm=document.getElementById('signupConfirm').value;
    if(!name){err.textContent='Please enter your name.';return;}
    if(!email){err.textContent='Please enter your email.';return;}
    if(pass.length<6){err.textContent='Password must be at least 6 characters.';return;}
    if(pass!==confirm){err.textContent='Passwords do not match.';return;}
    try { await signUpWithEmail(email,pass,name); }
    catch(e){ err.textContent=e.code==='auth/email-already-in-use'?'Email already in use.':'Sign up failed.'; }
  });

  document.getElementById('sendResetBtn').addEventListener('click', async () => {
    const err=document.getElementById('forgotError'),suc=document.getElementById('forgotSuccess');
    err.textContent='';suc.textContent='';
    const email=document.getElementById('forgotEmail').value.trim();
    if(!email){err.textContent='Please enter your email.';return;}
    try { await resetPassword(email); suc.textContent='Reset link sent! Check your inbox.'; document.getElementById('forgotEmail').value=''; }
    catch(e){ err.textContent=e.code==='auth/user-not-found'?'No account found.':'Failed to send email.'; }
  });

  document.getElementById('offlineBtn').addEventListener('click',()=>{
    state.isOfflineMode=true;
    state.habits=LocalStorage.load();
    state.habits.forEach(h=>HabitLogic.recalcStreaks(h));
    showScreen('app');
    initAppUI();
    hideSkeleton();
    renderHabitsView();
  });

  document.getElementById('signOutBtn').addEventListener('click', async () => {
    if(state.unsubscribeSync) state.unsubscribeSync();
    await logOut();
    state.user=null;state.habits=[];state.isOfflineMode=false;
    showScreen('loginScreen');
  });

  document.getElementById('loginPassword').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('loginBtn').click();});
  document.getElementById('signupConfirm').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('signupBtn').click();});
  document.getElementById('forgotEmail').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('sendResetBtn').click();});
};

/* ═══════════════════════════════════════════════════════════
   AUTH STATE
═══════════════════════════════════════════════════════════ */
const handleAuthStateChange = async (user) => {
  document.getElementById('globalLoader').classList.add('hidden');

  if(user){
    state.user=user;state.isOfflineMode=false;
    const userInfo=document.getElementById('userInfo');
    if(userInfo) userInfo.innerHTML=`
      <img src="${user.photoURL||''}" class="user-avatar" onerror="this.style.display='none'" />
      <span class="user-name">${user.displayName||user.email}</span>`;

    showScreen('app');
    showSkeleton();
    initAppUI();

    showSyncToast('Loading…');
    const cloudHabits=await loadHabitsFromCloud(user.uid);
    if(cloudHabits!==null){
      state.habits=cloudHabits;
      LocalStorage.save(state.habits);
    } else {
      state.habits=LocalStorage.load();
      if(state.habits.length>0) await saveHabitsToCloud(user.uid,state.habits);
    }
    state.habits.forEach(h=>HabitLogic.recalcStreaks(h));
    showSyncToast('Synced ✓',true);

    if(state.unsubscribeSync) state.unsubscribeSync();
    state.unsubscribeSync=subscribeToHabits(user.uid,(habits)=>{
      state.habits=habits;
      state.habits.forEach(h=>HabitLogic.recalcStreaks(h));
      LocalStorage.save(state.habits);
      renderHabitsView();
      if(state.currentView==='dashboard') renderDashboard();
    });

    hideSkeleton();
    renderHabitsView();
  } else {
    if(!LocalStorage.hasOnboarded()) {
      initOnboarding();
    } else {
      showScreen('loginScreen');
    }
  }
};

/* ═══════════════════════════════════════════════════════════
   UI HELPERS
═══════════════════════════════════════════════════════════ */
const $=(id)=>document.getElementById(id);
const esc=(s)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const showModal=(id)=>{$(id).hidden=false;$('modalBackdrop').hidden=false;};
const hideModal=(id)=>{$(id).hidden=true;$('modalBackdrop').hidden=true;};
const hideAllModals=()=>{['habitModal','deleteModal'].forEach(id=>$(id).hidden=true);$('modalBackdrop').hidden=true;};

/* ═══════════════════════════════════════════════════════════
   COMPLETION ANIMATION
═══════════════════════════════════════════════════════════ */
const triggerCompleteAnimation = (cardEl) => {
  cardEl.classList.add('complete-pulse');
  setTimeout(() => cardEl.classList.remove('complete-pulse'), 600);
};

/* ═══════════════════════════════════════════════════════════
   RENDER: HABIT CARD
═══════════════════════════════════════════════════════════ */
const renderHabitCard = (habit, index) => {
  const todayCount=HabitLogic.getTodayCount(habit);
  const totalDone=habit.completions.reduce((s,c)=>s+c.count,0);
  const pct=Math.min(Math.round((totalDone/Math.max(habit.goal,1))*100),100);
  const isDaily=habit.type==='daily';
  const doneTodayFlag=HabitLogic.isDailyDoneToday(habit);
  const hasToday=todayCount>0;

  const dots=Array.from({length:7},(_,i)=>{
    const date=DateUtils.daysAgo(6-i),rec=habit.completions.find(c=>c.date===date);
    return `<span class="week-dot${rec&&rec.count>0?' week-dot--on':''}" title="${date}"></span>`;
  }).join('');

  const card=document.createElement('article');
  card.className=`habit-card${hasToday?' completed-today':''}`;
  card.dataset.id=habit.id;
  card.dataset.index=index;
  card.draggable=true;

  card.innerHTML=`
    <div class="drag-handle" title="Drag to reorder">⠿</div>
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
        <div class="progress-bar"><div class="progress-fill${pct>=100?' full':''}" style="width:${pct}%"></div></div>
        <span class="progress-pct">${pct}%</span>
      </div>
    </div>
    <div class="habit-actions">
      <div class="counter-row">
        <button class="counter-btn undo-btn" data-id="${habit.id}"${!hasToday?' disabled':''}>−</button>
        <span class="counter-val">${isDaily?(doneTodayFlag?'✓':'○'):'×'+todayCount}</span>
        <button class="counter-btn complete-btn" data-id="${habit.id}"${isDaily&&doneTodayFlag?' disabled':''}>+</button>
      </div>
      <div class="icon-actions">
        <button class="icon-btn edit-btn" data-id="${habit.id}" title="Edit">✎</button>
        <button class="icon-btn delete icon-btn-delete" data-id="${habit.id}" title="Delete">⌫</button>
      </div>
    </div>`;

  // Drag events
  card.addEventListener('dragstart', (e) => {
    state.dragSrcIndex = index;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over'); });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', async (e) => {
    e.preventDefault();
    card.classList.remove('drag-over');
    const targetIndex = parseInt(card.dataset.index);
    if(state.dragSrcIndex === null || state.dragSrcIndex === targetIndex) return;
    const moved = state.habits.splice(state.dragSrcIndex, 1)[0];
    state.habits.splice(targetIndex, 0, moved);
    state.dragSrcIndex = null;
    await saveHabits();
    renderHabitsView();
  });

  return card;
};

/* ═══════════════════════════════════════════════════════════
   RENDER: HABITS VIEW
═══════════════════════════════════════════════════════════ */
const renderHabitsView = () => {
  const strip=$('summaryStrip');
  strip.innerHTML=`
    <div class="summary-card">
      <div class="summary-label">⚡ Aura Intensity</div>
      <div class="summary-value">${HabitLogic.getAuraIntensity(state.habits)}</div>
      <div class="summary-sub">Sum of all active streaks</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">◎ Daily Alignment</div>
      <div class="summary-value">${HabitLogic.getDailyAlignment(state.habits)}<span style="font-size:1.1rem;font-weight:500">%</span></div>
      <div class="summary-sub">Habits completed today</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">◈ Discipline Depth</div>
      <div class="summary-value">${HabitLogic.getDisciplineDepth(state.habits)}</div>
      <div class="summary-sub">Total active days ever</div>
    </div>`;

  const list=$('habitsList'); list.innerHTML='';
  if(!state.habits.length){
    strip.style.display = 'none';
    list.style.display  = 'none';
    $('emptyState').style.display = 'flex';
  } else {
    strip.style.display = '';
    list.style.display  = '';
    $('emptyState').style.display = 'none';
    state.habits.forEach((h,i) => list.appendChild(renderHabitCard(h,i)));
  }
};

/* ═══════════════════════════════════════════════════════════
   RENDER: DASHBOARD
═══════════════════════════════════════════════════════════ */
const renderDashboard = () => {
  const sel=$('dashboardSelect'); sel.innerHTML='';

  // Hide everything first, then show what's needed
  $('dashboardSelectWrap').style.display='none';
  $('dashboardContent').style.display='none';
  $('dashboardEmpty').style.display='none';
  $('dashboardNoData').style.display='none';

  if(!state.habits.length){
    $('dashboardEmpty').style.display='flex';
    return;
  }
  $('dashboardSelectWrap').hidden=false;
  state.habits.forEach(h=>{const o=document.createElement('option');o.value=h.id;o.textContent=h.name;sel.appendChild(o);});
  if(state.selectedHabitId) sel.value=state.selectedHabitId;
  else{state.selectedHabitId=state.habits[0].id;sel.value=state.selectedHabitId;}
  renderDashboardStats();
};

const milestoneBadge=(n,isDaily=false)=>{
  if(isDaily) return n<=14?'🌱':n<=30?'⭐':n<=60?'🔥':n<=90?'💎':n<=180?'🏆':n<=270?'👑':'🌟';
  return n<=10?'🌱':n<=25?'⭐':n<=50?'🔥':n<=100?'💎':n<=250?'🏆':n<=500?'👑':'🌟';
};

const renderDashboardStats = () => {
  const habit=state.habits.find(h=>h.id===state.selectedHabitId); if(!habit) return;
  const s=HabitLogic.computeStats(habit);

  // No data state
  if(!s.hasData){
    $('dashboardContent').style.display='none';
    $('dashboardEmpty').style.display='none';
    $('dashboardNoData').style.display='flex';
    return;
  }

  $('dashboardNoData').style.display='none';
  $('dashboardEmpty').style.display='none';
  $('dashboardContent').style.display='';

  $('statsGrid').innerHTML=`
    <div class="stat-card stat-card--milestone">
      <div class="milestone-header">
        <div>
          <div class="milestone-title">🏆 Milestone Tracker</div>
          <div class="milestone-sub">
            ${s.isMSDaily?`<strong>${s.msValue} days</strong> completed`:`<strong>${s.msValue} logs</strong> total`} ·
            <span class="milestone-next">${s.nextMilestone-s.msValue} ${s.isMSDaily?'days':'logs'} away from <strong>${s.nextMilestone}</strong> ${milestoneBadge(s.nextMilestone,s.isMSDaily)}</span>
          </div>
          <div class="milestone-type-tag">${s.isMSDaily?'📅 Consistency milestones':'📊 Volume milestones'}</div>
        </div>
        <div class="milestone-badge-icon">${milestoneBadge(s.nextMilestone,s.isMSDaily)}</div>
      </div>
      <div class="milestone-bar-wrap">
        <div class="milestone-bar"><div class="milestone-fill" style="width:${s.milestoneProgress}%"></div></div>
        <span class="milestone-pct">${s.milestoneProgress}%</span>
      </div>
      <div class="milestone-labels"><span>${s.prevMilestone} ${s.isMSDaily?'days':'logs'}</span><span>${s.nextMilestone} ${s.isMSDaily?'days':'logs'}</span></div>
    </div>
    <div class="stat-card">
      <div class="stat-card__accent stat-card__accent--purple">◈</div>
      <div class="stat-card__value">${s.hsi}</div>
      <div class="stat-card__label">Strength Index</div>
      <div class="stat-card__sub">Consistency · Streak · Volume</div>
      <div class="mini-bar"><div class="mini-fill mini-fill--purple" style="width:${s.hsi}%"></div></div>
    </div>
    <div class="stat-card">
      <div class="stat-card__accent stat-card__accent--amber">🔥</div>
      <div class="stat-card__value">${s.currentStreak}</div>
      <div class="stat-card__label">Current Streak</div>
      <div class="stat-card__sub">Best ever: ${s.longestStreak} days</div>
      <div class="mini-bar"><div class="mini-fill mini-fill--amber" style="width:${s.longestStreak>0?Math.round((s.currentStreak/s.longestStreak)*100):0}%"></div></div>
    </div>
    <div class="stat-card">
      <div class="stat-card__accent ${s.velocityPct>=0?'stat-card__accent--green':'stat-card__accent--red'}">${s.velocityPct>=0?'↑':'↓'}</div>
      <div class="stat-card__value velocity-val ${s.velocityPct>=0?'pos':'neg'}">${s.velocityPct>=0?'+':''}${s.velocityPct}%</div>
      <div class="stat-card__label">Velocity</div>
      <div class="stat-card__sub">This week <strong>${s.thisWeek}</strong> vs last <strong>${s.lastWeek}</strong></div>
    </div>`;
  renderCharts(habit);
};

/* ═══════════════════════════════════════════════════════════
   CHARTS
═══════════════════════════════════════════════════════════ */
const C={accent:'#7c6bff',green:'#34d399',amber:'#fbbf24',red:'#f87171',grid:'rgba(255,255,255,0.05)',text:'#6b6890'};
const destroyCharts=()=>{Object.values(state.charts).forEach(c=>{try{c.destroy();}catch{}});state.charts={};};
const baseScales=()=>({
  x:{grid:{color:C.grid},ticks:{color:C.text,font:{family:'DM Sans',size:11}}},
  y:{grid:{color:C.grid},ticks:{color:C.text,font:{family:'DM Sans',size:11}},beginAtZero:true},
});

const renderCharts=(habit)=>{
  destroyCharts();
  const last14=HabitLogic.getLast14Days(habit),last30=HabitLogic.getLast30Days(habit),allTime=HabitLogic.getAllTimeTrend(habit);
  renderHeatmap(last30);
  const srCtx=$('successRateChart').getContext('2d');
  const srGrad=srCtx.createLinearGradient(0,0,0,180);
  srGrad.addColorStop(0,'rgba(124,107,255,0.3)');srGrad.addColorStop(1,'rgba(124,107,255,0)');
  const srData=last14.map(d=>d.count>0?100:0);
  state.charts.sr=new Chart(srCtx,{type:'line',data:{labels:last14.map(d=>DateUtils.formatShort(d.date)),datasets:[{data:srData,borderColor:C.accent,backgroundColor:srGrad,borderWidth:2.5,tension:0.35,fill:true,pointRadius:4,pointBackgroundColor:srData.map(v=>v===100?C.green:'rgba(248,113,113,0.7)')}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{...baseScales(),y:{...baseScales().y,max:100,ticks:{...baseScales().y.ticks,callback:v=>v+'%'}}},animation:{duration:600}}});
  const buildWeekDays=(off)=>Array.from({length:7},(_,i)=>{const base=new Date(DateUtils.startOfWeek(off)+'T00:00:00');base.setDate(base.getDate()+i);const ds=base.toISOString().split('T')[0];const rec=habit.completions.find(c=>c.date===ds);return rec?rec.count:0;});
  const wkCtx=$('weekCompChart').getContext('2d');
  state.charts.wk=new Chart(wkCtx,{type:'bar',data:{labels:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],datasets:[{label:'This week',data:buildWeekDays(0),backgroundColor:'rgba(124,107,255,0.75)',borderRadius:5,borderSkipped:false},{label:'Last week',data:buildWeekDays(1),backgroundColor:'rgba(96,165,250,0.4)',borderRadius:5,borderSkipped:false}]},options:{responsive:true,plugins:{legend:{display:true,labels:{color:C.text,font:{family:'DM Sans',size:11},boxWidth:12}}},scales:baseScales(),animation:{duration:700}}});
  const atCtx=$('allTimeTrendChart').getContext('2d');
  const atGrad=atCtx.createLinearGradient(0,0,0,200);
  atGrad.addColorStop(0,'rgba(52,211,153,0.35)');atGrad.addColorStop(1,'rgba(52,211,153,0)');
  state.charts.at=new Chart(atCtx,{type:'line',data:{labels:allTime.length?allTime.map(d=>DateUtils.formatShort(d.date)):['–'],datasets:[{data:allTime.length?allTime.map(d=>d.total):[0],borderColor:C.green,backgroundColor:atGrad,borderWidth:2.5,tension:0.4,fill:true,pointRadius:allTime.length>30?0:3,pointBackgroundColor:C.green}]},options:{responsive:true,plugins:{legend:{display:false}},scales:baseScales(),animation:{duration:800}}});
};

const renderHeatmap=(last30)=>{
  const canvas=$('heatmapCanvas');if(!canvas)return;
  const dpr=window.devicePixelRatio||1,COLS=10,ROWS=3;
  const cell=Math.floor((canvas.parentElement.clientWidth-32-(COLS-1)*4)/COLS),gap=4;
  const W=COLS*(cell+gap)-gap,H=ROWS*(cell+gap)-gap;
  canvas.width=W*dpr;canvas.height=H*dpr;canvas.style.width=W+'px';canvas.style.height=H+'px';
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
  const maxCount=Math.max(...last30.map(d=>d.count),1);
  last30.forEach((d,i)=>{
    const col=i%COLS,row=Math.floor(i/COLS),x=col*(cell+gap),y=row*(cell+gap);
    ctx.fillStyle='rgba(255,255,255,0.04)';ctx.beginPath();ctx.roundRect(x,y,cell,cell,4);ctx.fill();
    if(d.count>0){
      const intensity=d.count/maxCount;
      ctx.fillStyle=`rgba(124,107,255,${0.2+intensity*0.8})`;ctx.beginPath();ctx.roundRect(x,y,cell,cell,4);ctx.fill();
      if(intensity>0.5){ctx.fillStyle=`rgba(192,132,252,${intensity*0.5})`;ctx.beginPath();ctx.roundRect(x+2,y+2,cell-4,cell-4,3);ctx.fill();}
    }
  });
};

/* ═══════════════════════════════════════════════════════════
   VIEW SWITCHING
═══════════════════════════════════════════════════════════ */
const switchView=(view)=>{
  state.currentView=view;
  $('habitsView').classList.toggle('hidden',view!=='habits');
  $('dashboardView').classList.toggle('hidden',view!=='dashboard');
  // Sync both nav bars
  document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('topbarTitle').textContent=view==='habits'?"Today's Habits":'Dashboard';
  $('addHabitBtn').hidden=view!=='habits';
  if(view==='dashboard') renderDashboard();
  closeSidebar();
};

/* ═══════════════════════════════════════════════════════════
   SIDEBAR
═══════════════════════════════════════════════════════════ */
let overlay=null;
const openSidebar=()=>{$('sidebar').classList.add('open');if(!overlay){overlay=document.createElement('div');overlay.className='sidebar-overlay';document.body.appendChild(overlay);overlay.addEventListener('click',closeSidebar);}overlay.classList.add('active');};
const closeSidebar=()=>{$('sidebar').classList.remove('open');if(overlay)overlay.classList.remove('active');};

/* ═══════════════════════════════════════════════════════════
   HABIT MODAL
═══════════════════════════════════════════════════════════ */
let selectedType='daily';
const openAddModal=()=>{state.editingId=null;selectedType='daily';$('modalTitle').textContent='New Habit';$('modalSave').textContent='Create Habit';$('habitName').value='';$('habitGoal').value='';setTypeActive('daily');showModal('habitModal');setTimeout(()=>$('habitName').focus(),50);};
const openEditModal=(id)=>{const h=state.habits.find(h=>h.id===id);if(!h)return;state.editingId=id;selectedType=h.type;$('modalTitle').textContent='Edit Habit';$('modalSave').textContent='Save Changes';$('habitName').value=h.name;$('habitGoal').value=h.goal;setTypeActive(h.type);showModal('habitModal');setTimeout(()=>$('habitName').focus(),50);};
const setTypeActive=(type)=>{selectedType=type;$('typeDaily').classList.toggle('active',type==='daily');$('typeFlexible').classList.toggle('active',type==='flexible');};
const saveHabit=async()=>{
  const name=($('habitName').value||'').trim(),goal=parseInt($('habitGoal').value,10);
  let ok=true;
  if(!name){$('habitName').classList.add('error');ok=false;}else $('habitName').classList.remove('error');
  if(!goal||goal<1){$('habitGoal').classList.add('error');ok=false;}else $('habitGoal').classList.remove('error');
  if(!ok)return;
  if(state.editingId){const h=state.habits.find(h=>h.id===state.editingId);if(h){h.name=name;h.goal=goal;h.type=selectedType;}}
  else state.habits.push({id:crypto.randomUUID(),name,goal,type:selectedType,createdAt:DateUtils.today(),completions:[],currentStreak:0,longestStreak:0});
  await saveHabits();hideModal('habitModal');renderHabitsView();
};

/* ═══════════════════════════════════════════════════════════
   DELETE
═══════════════════════════════════════════════════════════ */
const openDeleteModal=(id)=>{const h=state.habits.find(h=>h.id===id);if(!h)return;state.deletingId=id;$('deleteHabitName').textContent=h.name;showModal('deleteModal');};
const confirmDelete=async()=>{
  state.habits=state.habits.filter(h=>h.id!==state.deletingId);
  if(state.selectedHabitId===state.deletingId)state.selectedHabitId=null;
  await saveHabits();hideModal('deleteModal');renderHabitsView();
  if(state.currentView==='dashboard')renderDashboard();
};

/* ═══════════════════════════════════════════════════════════
   COMPLETE / UNDO
═══════════════════════════════════════════════════════════ */
const completeHabit=async(id, cardEl)=>{
  const h=state.habits.find(h=>h.id===id);if(!h)return;
  HabitLogic.complete(h);
  if(cardEl) triggerCompleteAnimation(cardEl);
  await saveHabits();renderHabitsView();
};
const undoHabit=async(id)=>{const h=state.habits.find(h=>h.id===id);if(!h)return;HabitLogic.undo(h);await saveHabits();renderHabitsView();};

/* ═══════════════════════════════════════════════════════════
   APP UI INIT
═══════════════════════════════════════════════════════════ */
let appUIInited=false;
const initAppUI=()=>{
  if(appUIInited)return; appUIInited=true;

  // Both sidebar nav + bottom nav
  document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));

  $('addHabitBtn').addEventListener('click',openAddModal);
  $('emptyAddBtn').addEventListener('click',openAddModal);
  $('dashGoAddBtn')?.addEventListener('click',()=>switchView('habits'));
  $('menuBtn').addEventListener('click',openSidebar);
  $('sidebarClose').addEventListener('click',closeSidebar);

  $('habitsList').addEventListener('click',(e)=>{
    const cb=e.target.closest('.complete-btn');
    if(cb){completeHabit(cb.dataset.id, cb.closest('.habit-card'));return;}
    const ub=e.target.closest('.undo-btn');if(ub){undoHabit(ub.dataset.id);return;}
    const eb=e.target.closest('.edit-btn');if(eb){openEditModal(eb.dataset.id);return;}
    const db=e.target.closest('.icon-btn-delete');if(db){openDeleteModal(db.dataset.id);return;}
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
  window.addEventListener('resize',()=>{if(state.currentView==='dashboard'&&state.selectedHabitId){const h=state.habits.find(h=>h.id===state.selectedHabitId);if(h)renderHeatmap(HabitLogic.getLast30Days(h));}});
  $('sidebarDate').textContent=DateUtils.formatFull();
};

/* ═══════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════ */
const init=()=>{
  initAuthEvents();
  onAuthStateChanged(auth,handleAuthStateChange);
  if('serviceWorker' in navigator)
    window.addEventListener('load',()=>navigator.serviceWorker.register('service-worker.js').catch(()=>{}));
};

document.addEventListener('DOMContentLoaded',init);
