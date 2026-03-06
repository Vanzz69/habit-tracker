/**
 * MOMENTUM — app.js v7
 * Features: onboarding, skeleton loader, bottom nav, completion animation,
 * drag-to-reorder, empty dashboard state, auth screens, priority system
 */

import {
  auth, onAuthStateChanged,
  signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, logOut,
  saveHabitsToCloud, loadHabitsFromCloud, subscribeToHabits,
  saveTasksToCloud, loadTasksFromCloud,
  checkRedirectResult,
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

  // Priority: check on app load — convert 'tomorrow' → 'now' if date has passed
  const processPriorityOnLoad = (habits) => {
    const today = DateUtils.today();
    habits.forEach(h => {
      if (!h.priority) return;
      if (h.priority === 'tomorrow' && h.prioritySetDate) {
        if (today > h.prioritySetDate) {
          // Activating today — log it now
          h.priority = 'now';
          h.prioritySetDate = today;
          if (!h.priorityHistory) h.priorityHistory = [];
          const existing = h.priorityHistory.find(p => p.date === today);
          if (!existing) h.priorityHistory.push({ date: today, type: 'now' });
        }
      } else if (h.priority === 'now' && h.prioritySetDate) {
        if (h.prioritySetDate < today) {
          h.priority = null;
          h.prioritySetDate = null;
        }
      }
    });
  };

  const setPriority = (h, type) => {
    const today = DateUtils.today();
    if (type === null) {
      h.priority = null;
      h.prioritySetDate = null;
    } else {
      // Only log to priorityHistory when actually active today (not tomorrow)
      if (type === 'now') {
        if (!h.priorityHistory) h.priorityHistory = [];
        const existing = h.priorityHistory.find(p => p.date === today);
        if (!existing) h.priorityHistory.push({ date: today, type });
      }
      h.priority = type;
      h.prioritySetDate = today;
    }
    return h;
  };

  const isPriorityActive = (h) => {
    // A habit is visually active (pink) if priority==='now' AND set today
    return h.priority === 'now';
  };

  const getPriorityChartData = (h) => {
    if (!h.priorityHistory || !h.priorityHistory.length) return [];
    return h.priorityHistory.map(p => {
      const comp = h.completions.find(c => c.date === p.date);
      return { date: p.date, type: p.type, completed: !!(comp && comp.count > 0) };
    }).sort((a,b) => a.date.localeCompare(b.date)).slice(-30); // last 30 priority events
  };

  return { complete,undo,recalcStreaks,isDailyDoneToday,getTodayCount,
    getAuraIntensity,getDailyAlignment,getDisciplineDepth,
    computeStats,getLast14Days,getLast30Days,getAllTimeTrend,
    processPriorityOnLoad, setPriority, isPriorityActive, getPriorityChartData };
})();

/* ═══════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════ */
const state = {
  habits:[],tasks:[],currentView:'habits',currentTasksView:'today',
  editingId:null,deletingId:null,deletingTaskId:null,selectedHabitId:null,
  charts:{},user:null,isOfflineMode:false,unsubscribeSync:null,
  dragSrcIndex:null,taskDragSrcIndex:null,priorityMenuId:null,
  notificationTimers:[],
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

const TASKS_KEY = 'momentum_tasks_v1';
const loadLocalTasks = () => { try { return JSON.parse(localStorage.getItem(TASKS_KEY)) || []; } catch { return []; } };
const saveLocalTasks = (t) => { try { localStorage.setItem(TASKS_KEY, JSON.stringify(t)); } catch {} };

let taskSyncTimeout = null;
const saveTasks = async () => {
  saveLocalTasks(state.tasks);
  if(state.user&&!state.isOfflineMode){
    clearTimeout(taskSyncTimeout);
    taskSyncTimeout=setTimeout(async()=>{
      await saveTasksToCloud(state.user.uid, state.tasks);
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
const hideGlobalLoader = () => {
  const el = document.getElementById('globalLoader');
  el.classList.add('fade-out');
  setTimeout(() => el.classList.add('hidden'), 400);
};

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
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    try {
      if (isMobile) {
        // Show loading — page will redirect, onAuthStateChanged handles result
        document.getElementById(errorId).textContent='';
        const btn = errorId === 'loginError'
          ? document.getElementById('googleSignInBtn')
          : document.getElementById('googleSignUpBtn');
        btn.textContent = 'Redirecting…'; btn.disabled = true;
      }
      await signInWithGoogle();
    } catch(e) {
      document.getElementById(errorId).textContent = e.code === 'auth/popup-blocked'
        ? 'Popup blocked. Try again or use email sign-in.'
        : 'Google sign-in failed. Try again.';
    }
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
    const err=document.getElementById('forgotError');
    const suc=document.getElementById('forgotSuccess');
    const btn=document.getElementById('sendResetBtn');
    err.textContent=''; suc.textContent='';
    const email=document.getElementById('forgotEmail').value.trim();
    if(!email){err.textContent='Please enter your email address.';return;}
    // Basic email format check
    if(!email.includes('@')){err.textContent='Please enter a valid email address.';return;}
    btn.textContent='Sending…'; btn.disabled=true;
    try {
      await resetPassword(email);
      suc.textContent='Reset link sent! Check your inbox (and spam folder).';
      document.getElementById('forgotEmail').value='';
    } catch(e) {
      console.error('Reset error:', e.code, e.message);
      if(e.code==='auth/user-not-found' || e.code==='auth/invalid-email') {
        err.textContent='No account found with that email address.';
      } else if(e.code==='auth/too-many-requests') {
        err.textContent='Too many attempts. Please try again later.';
      } else if(e.code==='auth/missing-email') {
        err.textContent='Please enter your email address.';
      } else {
        // Show real error so we can debug
        err.textContent=`Error: ${e.code || e.message}`;
      }
    } finally {
      btn.textContent='Send Reset Link'; btn.disabled=false;
    }
  });

  document.getElementById('offlineBtn').addEventListener('click',()=>{
    state.isOfflineMode=true;
    state.habits=LocalStorage.load();
    state.habits.forEach(h=>HabitLogic.recalcStreaks(h));
    state.tasks=loadLocalTasks();
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
  try {
    if(user){
      state.user=user; state.isOfflineMode=false;
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
      HabitLogic.processPriorityOnLoad(state.habits);

      const cloudTasks = await loadTasksFromCloud(user.uid);
      if(cloudTasks!==null){ state.tasks=cloudTasks; saveLocalTasks(state.tasks); }
      else { state.tasks=loadLocalTasks(); if(state.tasks.length>0) await saveTasksToCloud(user.uid,state.tasks); }
      await processDueTasks();

      showSyncToast('Synced ✓',true);

      if(state.unsubscribeSync) state.unsubscribeSync();
      state.unsubscribeSync=subscribeToHabits(user.uid,(habits)=>{
        state.habits=habits;
        state.habits.forEach(h=>HabitLogic.recalcStreaks(h));
        HabitLogic.processPriorityOnLoad(state.habits);
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
  } catch(err) {
    console.error('App init error:', err);
    // Always fall through to login on any error — never leave loader stuck
    document.getElementById('globalLoader').classList.add('hidden');
    showScreen('loginScreen');
  }
};

/* ═══════════════════════════════════════════════════════════
   UI HELPERS
═══════════════════════════════════════════════════════════ */
const $=(id)=>document.getElementById(id);
const esc=(s)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const showModal=(id)=>{$(id).hidden=false;$('modalBackdrop').hidden=false;};
const hideModal=(id)=>{$(id).hidden=true;$('modalBackdrop').hidden=true;};
const hideAllModals=()=>{['habitModal','deleteModal','deleteTaskModal'].forEach(id=>$(id).hidden=true);$('modalBackdrop').hidden=true;};

/* ═══════════════════════════════════════════════════════════
   PRIORITY CONTEXT MENU
═══════════════════════════════════════════════════════════ */
let priorityMenuEl = null;

const closePriorityMenu = () => {
  if (priorityMenuEl) { priorityMenuEl.remove(); priorityMenuEl = null; }
  const bd = document.getElementById('priorityBackdrop');
  if (bd) bd.remove();
  state.priorityMenuId = null;
};

const openPriorityMenu = (habitId, anchorEl) => {
  closePriorityMenu();
  const habit = state.habits.find(h => h.id === habitId);
  if (!habit) return;
  state.priorityMenuId = habitId;

  const isActive = HabitLogic.isPriorityActive(habit);
  const isTomorrow = habit.priority === 'tomorrow';

  const menu = document.createElement('div');
  menu.className = 'priority-menu';
  menu.innerHTML = `
    <div class="priority-menu-title">⚡ Set Priority</div>
    <button class="priority-menu-item ${isActive ? 'active' : ''}" data-action="now">
      <span class="pm-icon">🔴</span>
      <span class="pm-text">
        <strong>Priority Today</strong>
        <span>${isActive ? 'Currently active — tap to remove' : 'Mark as top priority now'}</span>
      </span>
      ${isActive ? '<span class="pm-check">✓</span>' : ''}
    </button>
    <button class="priority-menu-item ${isTomorrow ? 'active' : ''}" data-action="tomorrow">
      <span class="pm-icon">🌅</span>
      <span class="pm-text">
        <strong>Prioritize Tomorrow</strong>
        <span>${isTomorrow ? 'Set for tomorrow — tap to remove' : 'Flag for tomorrow morning'}</span>
      </span>
      ${isTomorrow ? '<span class="pm-check">✓</span>' : ''}
    </button>
  `;

  // Position: center on mobile, near card on desktop
  const menuW = 260;
  const isMobile = window.innerWidth <= 700;
  if (isMobile) {
    menu.style.position = 'fixed';
    menu.style.bottom = '90px';
    menu.style.left = '50%';
    menu.style.transform = 'translateX(-50%)';
    menu.style.width = `${menuW}px`;
    menu.style.top = 'auto';
  } else {
    const rect = anchorEl.getBoundingClientRect();
    const menuH = 170, padding = 12;
    let top = rect.bottom + 8;
    let left = rect.left;
    if (top + menuH > window.innerHeight - padding) top = rect.top - menuH - 8;
    left = Math.max(padding, Math.min(left, window.innerWidth - menuW - padding));
    top = Math.max(padding, top);
    menu.style.position = 'fixed';
    menu.style.top  = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.width = `${menuW}px`;
  }

  menu.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const h = state.habits.find(h => h.id === habitId);
    if (!h) return;

    if (action === 'now') {
      HabitLogic.setPriority(h, isActive ? null : 'now');
    } else if (action === 'tomorrow') {
      HabitLogic.setPriority(h, isTomorrow ? null : 'tomorrow');
    }
    closePriorityMenu();
    await saveHabits();
    renderHabitsView();
  });

  document.body.appendChild(menu);
  priorityMenuEl = menu;

  // On mobile add a dim backdrop
  if (window.innerWidth <= 700) {
    const bd = document.createElement('div');
    bd.className = 'priority-backdrop';
    bd.id = 'priorityBackdrop';
    document.body.appendChild(bd);
    bd.addEventListener('click', closePriorityMenu);
  }

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', closePriorityMenu, { once: true });
  }, 10);
};

// Long press detection — works on both touch and mouse
const addLongPress = (el, habitId, callback) => {
  let timer = null;
  let startX = 0, startY = 0;
  const MOVE_THRESHOLD = 8;

  const start = (e) => {
    const touch = e.touches ? e.touches[0] : e;
    startX = touch.clientX; startY = touch.clientY;
    el.classList.add('long-press-hold');
    timer = setTimeout(() => {
      el.classList.remove('long-press-hold');
      el.classList.add('long-press-triggered');
      setTimeout(() => el.classList.remove('long-press-triggered'), 400);
      callback(habitId, el);
    }, 700);
  };
  const cancel = () => {
    clearTimeout(timer); timer = null;
    el.classList.remove('long-press-hold');
  };
  const move = (e) => {
    const touch = e.touches ? e.touches[0] : e;
    const dx = Math.abs(touch.clientX - startX);
    const dy = Math.abs(touch.clientY - startY);
    if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) cancel();
  };

  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchend', cancel);
  el.addEventListener('touchmove', move, { passive: true });
  el.addEventListener('mousedown', start);
  el.addEventListener('mouseup', cancel);
  el.addEventListener('mousemove', move);
  // Cancel immediately when drag begins
  el.addEventListener('dragstart', cancel);
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); callback(habitId, el); });
};

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
  const isPriority=HabitLogic.isPriorityActive(habit);
  const isTomorrow=habit.priority==='tomorrow';

  const dots=Array.from({length:7},(_,i)=>{
    const date=DateUtils.daysAgo(6-i),rec=habit.completions.find(c=>c.date===date);
    return `<span class="week-dot${rec&&rec.count>0?' week-dot--on':''}" title="${date}"></span>`;
  }).join('');

  // Priority badge
  const priorityBadge = isPriority
    ? `<span class="priority-badge priority-badge--now">🔴 Priority</span>`
    : isTomorrow
    ? `<span class="priority-badge priority-badge--tomorrow">🌅 Tomorrow</span>`
    : '';

  const card=document.createElement('article');
  card.className=`habit-card${hasToday?' completed-today':''}${isPriority?' priority-active':''}`;
  card.dataset.id=habit.id;
  card.dataset.index=index;
  card.draggable=true;

  card.innerHTML=`
    <div class="drag-handle" title="Drag to reorder">⠿</div>
    <div class="habit-main">
      <div class="habit-top">
        <span class="habit-type-badge">${habit.type}</span>
        <span class="habit-name">${esc(habit.name)}</span>
        ${priorityBadge}
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

  // Long press → priority menu
  addLongPress(card, habit.id, openPriorityMenu);

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
  $('dashboardSelectWrap').style.display='';
  state.habits.forEach(h=>{const o=document.createElement('option');o.value=h.id;o.textContent=h.name;sel.appendChild(o);});
  if(state.selectedHabitId) sel.value=state.selectedHabitId;
  else{state.selectedHabitId=state.habits[0].id;sel.value=state.selectedHabitId;}
  renderDashboardStats();
};

const milestoneBadge=(n,isDaily=false)=>{
  if(isDaily) return n<=14?'🌱':n<=30?'⭐':n<=60?'🔥':n<=90?'💎':n<=180?'🏆':n<=270?'👑':'🌟';
  return n<=10?'🌱':n<=25?'⭐':n<=50?'🔥':n<=100?'💎':n<=250?'🏆':n<=500?'👑':'🌟';
};

// Returns which of 5 journey stages the user is at, and progress within it
const getMilestoneJourney = (s) => {
  const milestones = s.isMSDaily
    ? [7, 21, 45, 90, 180]   // 5 daily milestones = journey complete
    : [10, 25, 50, 100, 250]; // 5 flexible milestones
  const val = s.msValue;
  const total = milestones[4]; // 5th = "habit completed"

  // Which stage are we in (0-indexed)
  let stage = 0;
  for (let i = 0; i < milestones.length; i++) {
    if (val >= milestones[i]) stage = i + 1;
  }
  stage = Math.min(stage, 5);

  // Progress within current stage
  const stageStart = stage === 0 ? 0 : milestones[stage - 1];
  const stageEnd   = stage < 5 ? milestones[stage] : milestones[4];
  const stagePct   = stageEnd === stageStart ? 100
    : Math.round(((val - stageStart) / (stageEnd - stageStart)) * 100);

  const labels = ['🌱 Beginning', '⭐ Building', '🔥 Committed', '💎 Dedicated', '🏆 Mastered'];
  const nextLabel = stage < 5 ? `${milestones[stage]} ${s.isMSDaily?'days':'logs'}` : 'Complete!';

  return { stage, stagePct: Math.max(0, Math.min(100, stagePct)),
    stageLabel: labels[Math.max(0, stage - (stage===5?0:0))],
    milestones, val, nextLabel,
    currentLabel: labels[Math.max(0, Math.min(stage, 4))] };
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

  const journey = getMilestoneJourney(s);
  const journeyDots = Array.from({length:5}, (_,i) => {
    const filled = i < journey.stage;
    const active = i === journey.stage - 1 || (journey.stage === 0 && i === 0);
    return `<div class="journey-dot ${filled?'filled':''} ${active?'active':''}" title="${journey.milestones[i]} ${s.isMSDaily?'days':'logs'}">
      <span>${i+1}</span>
    </div>`;
  }).join('<div class="journey-line"></div>');

  $('statsGrid').innerHTML=`
    <div class="stat-card stat-card--milestone">
      <div class="milestone-header">
        <div>
          <div class="milestone-title">🗺️ Journey Progress</div>
          <div class="milestone-fraction">
            <span class="fraction-current">${journey.stage}</span>
            <span class="fraction-sep">/</span>
            <span class="fraction-total">5</span>
            <span class="fraction-label">${journey.currentLabel}</span>
          </div>
          <div class="milestone-sub">
            ${s.isMSDaily?`<strong>${s.msValue} days</strong> logged`:`<strong>${s.msValue} logs</strong> total`}
            ${journey.stage < 5 ? `· <span class="milestone-next">${journey.nextLabel} to next milestone</span>` : ' · <span class="milestone-next" style="color:var(--green)">Habit mastered! 🏆</span>'}
          </div>
        </div>
      </div>
      <div class="journey-track">${journeyDots}</div>
      <div class="milestone-bar-wrap" style="margin-top:var(--sp-3)">
        <div class="milestone-bar"><div class="milestone-fill" style="width:${journey.stagePct}%"></div></div>
        <span class="milestone-pct">${journey.stagePct}%</span>
      </div>
      <div class="milestone-labels">
        <span>${journey.stage > 0 ? journey.milestones[journey.stage-1] : 0} ${s.isMSDaily?'days':'logs'}</span>
        <span>${journey.nextLabel}</span>
      </div>
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

  // Priority chart
  const priorityData = HabitLogic.getPriorityChartData(habit);
  const pChartEmpty = document.getElementById('priorityChartEmpty');
  const pChartCanvas = document.getElementById('priorityChart');
  if (!priorityData.length) {
    pChartCanvas.style.display = 'none';
    pChartEmpty.style.display = 'block';
  } else {
    pChartCanvas.style.display = '';
    pChartEmpty.style.display = 'none';
    const pCtx = pChartCanvas.getContext('2d');
    state.charts.priority = new Chart(pCtx, {
      type: 'bar',
      data: {
        labels: priorityData.map(d => DateUtils.formatShort(d.date)),
        datasets: [
          {
            label: 'Priority day',
            data: priorityData.map(() => 1),
            backgroundColor: priorityData.map(d => d.completed ? 'rgba(52,211,153,0.75)' : 'rgba(251,113,133,0.65)'),
            borderRadius: 6,
            borderSkipped: false,
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const d = priorityData[ctx.dataIndex];
                return d.completed ? '✅ Completed on priority day' : '❌ Missed on priority day';
              }
            }
          }
        },
        scales: {
          x: { grid: { color: C.grid }, ticks: { color: C.text, font: { family: 'DM Sans', size: 11 } } },
          y: { display: false, max: 1.5 }
        },
        animation: { duration: 700 }
      }
    });
  }
};

const renderHeatmap=(last30)=>{
  const canvas=$('heatmapCanvas');if(!canvas)return;
  const dpr=window.devicePixelRatio||1,COLS=10,ROWS=3;
  const cell=Math.floor((canvas.parentElement.clientWidth-32-(COLS-1)*4)/COLS),gap=4;
  const W=COLS*(cell+gap)-gap,H=ROWS*(cell+gap)-gap;
  canvas.width=W*dpr;canvas.height=H*dpr;canvas.style.width=W+'px';canvas.style.height=H+'px';
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
  const maxCount=Math.max(...last30.map(d=>d.count),1);

  // Safe rounded rect — fallback for browsers without roundRect support
  const roundRect = (x,y,w,h,r) => {
    if(ctx.roundRect) { ctx.roundRect(x,y,w,h,r); return; }
    ctx.moveTo(x+r,y);
    ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
    ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
    ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
    ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r);
    ctx.closePath();
  };

  last30.forEach((d,i)=>{
    const col=i%COLS,row=Math.floor(i/COLS),x=col*(cell+gap),y=row*(cell+gap);
    ctx.fillStyle='rgba(255,255,255,0.04)';ctx.beginPath();roundRect(x,y,cell,cell,4);ctx.fill();
    if(d.count>0){
      const intensity=d.count/maxCount;
      ctx.fillStyle=`rgba(124,107,255,${0.2+intensity*0.8})`;ctx.beginPath();roundRect(x,y,cell,cell,4);ctx.fill();
      if(intensity>0.5){ctx.fillStyle=`rgba(192,132,252,${intensity*0.5})`;ctx.beginPath();roundRect(x+2,y+2,cell-4,cell-4,3);ctx.fill();}
    }
  });
};

/* ═══════════════════════════════════════════════════════════
   VIEW SWITCHING
═══════════════════════════════════════════════════════════ */
const switchView=(view)=>{
  state.currentView=view;
  closePriorityMenu();
  $('habitsView').classList.toggle('hidden',view!=='habits');
  $('tasksView').classList.toggle('hidden',view!=='tasks');
  $('dashboardView').classList.toggle('hidden',view!=='dashboard');
  document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  const titles = { habits:"Today's Habits", tasks:"Tasks", dashboard:"Dashboard" };
  $('topbarTitle').textContent = titles[view] || '';
  $('addHabitBtn').hidden = view !== 'habits';
  if(view==='dashboard') renderDashboard();
  if(view==='tasks') renderTasksView();
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
  else state.habits.push({id:genId(),name,goal,type:selectedType,createdAt:DateUtils.today(),completions:[],currentStreak:0,longestStreak:0});
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
   NOTIFICATIONS
═══════════════════════════════════════════════════════════ */
const requestNotificationPermission = async () => {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
};

const scheduleTaskNotification = (task) => {
  if (!task.time || task.completed) return;
  const today = DateUtils.today();
  if (task.date !== today) return;
  const [h, m] = task.time.split(':').map(Number);
  const now = new Date();
  const fireAt = new Date();
  fireAt.setHours(h, m, 0, 0);
  const ms = fireAt - now;
  if (ms <= 0) return;
  if (Notification.permission !== 'granted') return;
  const timer = setTimeout(() => {
    try {
      // Use service worker notification if available (works when app is backgrounded)
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification('⏰ Task Due — Momentum', {
            body: task.title,
            icon: './icons/icon-192.png',
            tag: task.id,
            renotify: true,
            requireInteraction: true,
            data: { taskId: task.id },
          });
        });
      } else {
        // Fallback to window notification
        const notif = new Notification('⏰ Task Due — Momentum', {
          body: task.title,
          icon: './icons/icon-192.png',
          tag: task.id,
          requireInteraction: true,
        });
        notif.onclick = () => { window.focus(); switchView('tasks'); notif.close(); };
      }
    } catch(e) { console.warn('Notification failed:', e); }
  }, ms);
  state.notificationTimers.push({ id: task.id, timer });
};

const cancelTaskNotification = (taskId) => {
  const idx = state.notificationTimers.findIndex(t => t.id === taskId);
  if (idx !== -1) { clearTimeout(state.notificationTimers[idx].timer); state.notificationTimers.splice(idx, 1); }
};

const scheduleAllNotifications = () => {
  state.notificationTimers.forEach(t => clearTimeout(t.timer));
  state.notificationTimers.length = 0;
  state.tasks.forEach(t => scheduleTaskNotification(t));
};

// Clean up old completed tasks (keep today + future only)
// Old incomplete tasks get auto-archived (marked as missed) so they don't pollute today
const cleanOldTasks = async () => {
  const today = DateUtils.today();
  const before = state.tasks.length;
  // Remove completed tasks older than today
  state.tasks = state.tasks.filter(t => {
    if (t.date < today && t.completed) return false; // remove old completed
    return true; // keep everything else (today, future, old incomplete kept as-is)
  });
  // Mark old incomplete tasks as missed so they don't show in Today
  state.tasks.forEach(t => {
    if (t.date < today && !t.completed) {
      t.missed = true; // flag but keep for history
    }
  });
  if (state.tasks.length !== before) await saveTasks();
};

// Set a timer to re-render and clean at midnight
const scheduleMidnightReset = () => {
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0); // next midnight
  const msToMidnight = midnight - now;
  setTimeout(async () => {
    await cleanOldTasks();
    renderTasksView();
    scheduleAllNotifications(); // reschedule for new day's tasks
    scheduleMidnightReset();    // re-arm for next midnight
  }, msToMidnight);
};

/* ═══════════════════════════════════════════════════════════
   TASK HELPERS
═══════════════════════════════════════════════════════════ */
const genId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const todayTasksSorted = () => {
  const today = DateUtils.today();
  const tasks = state.tasks.filter(t => t.date === today && !t.missed);
  const incomplete = tasks.filter(t => !t.completed).sort((a,b) => {
    if (!a.time && !b.time) return 0;
    if (!a.time) return 1; if (!b.time) return -1;
    return a.time.localeCompare(b.time);
  });
  const complete = tasks.filter(t => t.completed).sort((a,b) => (a.completedAt||0)-(b.completedAt||0));
  return { incomplete, complete };
};
const upcomingTasksSorted = () => {
  const today = DateUtils.today();
  return state.tasks
    .filter(t => t.date > today)
    .sort((a,b) => { const dc=a.date.localeCompare(b.date); if(dc) return dc; if(!a.time&&!b.time) return 0; if(!a.time) return 1; if(!b.time) return -1; return a.time.localeCompare(b.time); });
};
const fmt12 = (time24) => {
  if (!time24) return '';
  const [h,m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
};

/* ═══════════════════════════════════════════════════════════
   RENDER: TASKS VIEW
═══════════════════════════════════════════════════════════ */
const renderTasksView = () => {
  if (state.currentTasksView === 'today') renderTodayTasks();
  else renderUpcomingTasks();
};

const renderTodayTasks = () => {
  const list = $('todayTasksList');
  list.innerHTML = '';
  const { incomplete, complete } = todayTasksSorted();
  const all = [...incomplete, ...complete];

  if (!all.length) {
    list.style.display = 'none';
    $('todayTasksEmpty').style.display = 'flex';
  } else {
    list.style.display = '';
    $('todayTasksEmpty').style.display = 'none';
    // Divider between incomplete and complete
    incomplete.forEach((t, i) => list.appendChild(buildTaskCard(t, i, 'today')));
    if (complete.length && incomplete.length) {
      const div = document.createElement('div');
      div.className = 'tasks-divider';
      div.innerHTML = '<span>Completed</span>';
      list.appendChild(div);
    }
    complete.forEach((t, i) => list.appendChild(buildTaskCard(t, incomplete.length + i, 'today')));
  }
};

const renderUpcomingTasks = () => {
  const list = $('upcomingTasksList');
  list.innerHTML = '';
  const tasks = upcomingTasksSorted();
  if (!tasks.length) {
    list.style.display = 'none';
    $('upcomingTasksEmpty').style.display = 'flex';
  } else {
    list.style.display = '';
    $('upcomingTasksEmpty').style.display = 'none';
    // Group by date
    const grouped = {};
    tasks.forEach(t => { if (!grouped[t.date]) grouped[t.date] = []; grouped[t.date].push(t); });
    Object.keys(grouped).sort().forEach(date => {
      const header = document.createElement('div');
      header.className = 'tasks-date-header';
      const d = new Date(date + 'T00:00:00');
      header.textContent = d.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
      list.appendChild(header);
      grouped[date].forEach((t, i) => list.appendChild(buildTaskCard(t, i, 'upcoming')));
    });
  }
};

const buildTaskCard = (task, index, pane) => {
  const card = document.createElement('div');
  card.className = `task-card${task.completed ? ' task-completed' : ''}`;
  card.dataset.id = task.id;
  card.dataset.index = index;
  if (!task.completed && pane === 'today') card.draggable = true;

  card.innerHTML = `
    ${!task.completed && pane === 'today' ? '<div class="drag-handle task-drag-handle">⠿</div>' : '<div class="drag-handle task-drag-handle" style="opacity:0;pointer-events:none">⠿</div>'}
    <button class="task-check${task.completed ? ' checked' : ''}" data-id="${task.id}" aria-label="Complete task">
      ${task.completed ? '✓' : ''}
    </button>
    <div class="task-body">
      <span class="task-title">${esc(task.title)}</span>
      ${task.time ? `<span class="task-time">${fmt12(task.time)}</span>` : ''}
      ${pane === 'upcoming' ? `<span class="task-date-tag">${DateUtils.formatShort(task.date)}</span>` : ''}
    </div>
    <button class="task-delete-btn" data-id="${task.id}" title="Delete">✕</button>`;

  // Drag reorder (today incomplete only)
  if (!task.completed && pane === 'today') {
    card.addEventListener('dragstart', (e) => {
      state.taskDragSrcIndex = index;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over'); });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', async (e) => {
      e.preventDefault(); card.classList.remove('drag-over');
      const targetIndex = parseInt(card.dataset.index);
      if (state.taskDragSrcIndex === null || state.taskDragSrcIndex === targetIndex) return;
      const today = DateUtils.today();
      const incomplete = state.tasks.filter(t => t.date === today && !t.completed);
      const others = state.tasks.filter(t => !(t.date === today && !t.completed));
      const moved = incomplete.splice(state.taskDragSrcIndex, 1)[0];
      incomplete.splice(targetIndex, 0, moved);
      state.tasks = [...incomplete, ...others];
      state.taskDragSrcIndex = null;
      await saveTasks(); renderTodayTasks();
    });
  }

  return card;
};

/* ═══════════════════════════════════════════════════════════
   TASK ACTIONS
═══════════════════════════════════════════════════════════ */
const addTodayTask = async () => {
  const title = $('taskTitleInput').value.trim();
  if (!title) { $('taskTitleInput').classList.add('error'); setTimeout(() => $('taskTitleInput').classList.remove('error'), 800); return; }
  const time = $('taskTimeInput').value || null;
  // Request notification permission NOW (during user gesture) if there's a time
  if (time) await requestNotificationPermission();
  const task = { id: genId(), title, date: DateUtils.today(), time, completed: false, completedAt: null };
  state.tasks.push(task);
  $('taskTitleInput').value = ''; $('taskTimeInput').value = '';
  // Schedule after permission is already set
  if (time) scheduleTaskNotification(task);
  await saveTasks(); renderTodayTasks();
};

const addScheduledTask = async () => {
  const title = $('scheduledTitleInput').value.trim();
  const date  = $('scheduledDateInput').value;
  if (!title) { $('scheduledTitleInput').classList.add('error'); setTimeout(() => $('scheduledTitleInput').classList.remove('error'), 800); return; }
  if (!date)  { $('scheduledDateInput').classList.add('error');  setTimeout(() => $('scheduledDateInput').classList.remove('error'), 800); return; }
  if (date <= DateUtils.today()) { $('scheduledDateInput').classList.add('error'); setTimeout(() => $('scheduledDateInput').classList.remove('error'), 800); return; }
  const time = $('scheduledTimeInput').value || null;
  state.tasks.push({ id: genId(), title, date, time, completed: false, completedAt: null });
  $('scheduledTitleInput').value = ''; $('scheduledDateInput').value = ''; $('scheduledTimeInput').value = '';
  await saveTasks(); renderUpcomingTasks();
};

const completeTask = async (id) => {
  const t = state.tasks.find(t => t.id === id); if (!t) return;
  t.completed = true; t.completedAt = Date.now();
  cancelTaskNotification(id);
  await saveTasks(); renderTodayTasks();
};

const uncompleteTask = async (id) => {
  const t = state.tasks.find(t => t.id === id); if (!t) return;
  t.completed = false; t.completedAt = null;
  scheduleTaskNotification(t);
  await saveTasks(); renderTodayTasks();
};

const openDeleteTaskModal = (id) => {
  const t = state.tasks.find(t => t.id === id); if (!t) return;
  state.deletingTaskId = id;
  $('deleteTaskName').textContent = t.title;
  showModal('deleteTaskModal');
};

const confirmDeleteTask = async () => {
  cancelTaskNotification(state.deletingTaskId);
  state.tasks = state.tasks.filter(t => t.id !== state.deletingTaskId);
  hideModal('deleteTaskModal');
  await saveTasks(); renderTasksView();
};

// Called on app load — clean stale tasks, schedule notifications, arm midnight reset
const processDueTasks = async () => {
  await cleanOldTasks();
  scheduleAllNotifications();
  scheduleMidnightReset();
};

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

  // Task toggle (Today / Upcoming)
  document.querySelectorAll('.tasks-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentTasksView = btn.dataset.tasksview;
      document.querySelectorAll('.tasks-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
      $('todayTasksPane').style.display   = state.currentTasksView === 'today'    ? '' : 'none';
      $('upcomingTasksPane').style.display = state.currentTasksView === 'upcoming' ? '' : 'none';
      renderTasksView();
    });
  });

  // Add task buttons
  $('addTaskBtn').addEventListener('click', addTodayTask);
  $('addScheduledBtn').addEventListener('click', addScheduledTask);
  $('taskTitleInput').addEventListener('keydown', e => { if(e.key==='Enter') addTodayTask(); });
  $('scheduledTitleInput').addEventListener('keydown', e => { if(e.key==='Enter') addScheduledTask(); });

  // Set min date for scheduled task to tomorrow
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1);
  $('scheduledDateInput').min = tomorrow.toISOString().split('T')[0];

  // Task list click delegation (complete, uncomplete, delete)
  ['todayTasksList','upcomingTasksList'].forEach(listId => {
    $(listId).addEventListener('click', async (e) => {
      const checkBtn = e.target.closest('.task-check');
      if (checkBtn) {
        const id = checkBtn.dataset.id;
        const t = state.tasks.find(t => t.id === id);
        if (!t) return;
        if (t.completed) await uncompleteTask(id);
        else await completeTask(id);
        return;
      }
      const delBtn = e.target.closest('.task-delete-btn');
      if (delBtn) { openDeleteTaskModal(delBtn.dataset.id); return; }
    });
  });

  // Delete task modal
  $('deleteTaskConfirmBtn').addEventListener('click', confirmDeleteTask);
  $('deleteTaskCancelBtn').addEventListener('click', () => hideModal('deleteTaskModal'));
  $('deleteTaskModalClose').addEventListener('click', () => hideModal('deleteTaskModal'));
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

  // Handle mobile Google redirect result (page reloads after Google OAuth)
  checkRedirectResult().then(result => {
    if (result && result.user) {
      // Auth state change will fire automatically — nothing extra needed
    }
  }).catch(() => {});

  // Safety timeout — if Firebase auth hasn't responded in 8s, show login
  const authTimeout = setTimeout(() => {
    document.getElementById('globalLoader').classList.add('hidden');
    showScreen('loginScreen');
  }, 8000);

  onAuthStateChanged(auth, (user) => {
    clearTimeout(authTimeout);
    handleAuthStateChange(user);
  });

  if('serviceWorker' in navigator)
    window.addEventListener('load',()=>navigator.serviceWorker.register('service-worker.js').catch(()=>{}));
};

document.addEventListener('DOMContentLoaded',init);
