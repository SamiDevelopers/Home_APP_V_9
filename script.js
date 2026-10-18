// ==================== Firebase Init ====================
const firebaseConfig = {
  apiKey: "AIzaSyAnZeE70wtavGLBqFznC1LNiyJxkt9o5I0",
  authDomain: "home-app-2027.firebaseapp.com",
  projectId: "home-app-2027",
  storageBucket: "home-app-2027.firebasestorage.app",
  messagingSenderId: "651277293558",
  appId: "1:651277293558:web:19ae75ccb6603d9f0599d7"
};
let db = null, useFirebase = false;
try {
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    useFirebase = true;
    console.log('✅ Firebase متصل');
  }
} catch(e) { console.warn('⚠️ Firebase غير متاح:', e.message); }

const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const ALL_EXPENSE_CATEGORIES = ['كهرباء','مياه','المصعد صيانة دورية','أدوات نظافة','جلد كابينة الأسانسير','مفتاح باب الأسانسير','تصوير','مصاريف كاش','قطع غيار','دهانات','سباكة','مرتبات','حديقة','أخرى'];

// ==================== State ====================
const state = {
  units: [], payments: [], debts: [], codes: [],
  elevatorFund: [], generalFund: [], auditLog: [],
  emergencies: [], expenses: [], otherIncomes: [],
  settings: {
    buildingName: 'ملاك برج مريم',
    buildingAddress: '31 ش الأمراء التعاون - فيصل',
    floorsCount: 13, unitsPerFloor: 2, hasBasement: true,
    feeOwnerElevator: 170, feeOwnerNoElevator: 150,
    feeTenant: 220, feeClosed: 75,
    carryOver: 4085,
    selectedCategories: [...ALL_EXPENSE_CATEGORIES]
  },
  currentMainTab: 'dashboard',
  currentSubTab: 'monthly',
  currentFundTab: 'general',
  currentMatrixTab: 'income',
  currentMonth: MONTHS[new Date().getMonth()],
  currentYear: new Date().getFullYear(),
  selectedIds: new Set(),
  filterActive: false,
  yoyChart: null,
  matrixEdit: null
};

// ==================== Core Helpers ====================
function getFeeForMonth(unit, month, year) {
  const monthIdx = MONTHS.indexOf(month) + 1;
  const key = `${year}-${String(monthIdx).padStart(2, '0')}`;
  if (unit.feeHistory && unit.feeHistory.length > 0) {
    const sorted = [...unit.feeHistory].sort((a, b) => b.from.localeCompare(a.from));
    for (const entry of sorted) { if (entry.from <= key) return entry.fee; }
    return unit.feeHistory[0].fee;
  }
  return calcFee(unit, state.settings);
}

function getUnitStateForMonth(unit, month, year) {
  const monthIdx = MONTHS.indexOf(month) + 1;
  const key = `${year}-${String(monthIdx).padStart(2, '0')}`;
  if (unit.stateHistory && unit.stateHistory.length > 0) {
    const sorted = [...unit.stateHistory].sort((a, b) => b.from.localeCompare(a.from));
    for (const entry of sorted) { if (entry.from <= key) return entry; }
    return unit.stateHistory[0];
  }
  return { status: unit.status, type: unit.type, elevator: unit.elevator, resident: unit.resident };
}

function calcFee(unit, settings) {
  const s = settings || state.settings;
  if (!unit) return 0;
  if (unit.status === 'مغلقة' || unit.type === 'مغلق') return s.feeClosed || 75;
  if (unit.type === 'مستأجر') return s.feeTenant || 220;
  if (unit.type === 'مالك') return unit.elevator === 'yes' ? (s.feeOwnerElevator || 170) : (s.feeOwnerNoElevator || 150);
  return 0;
}

function getStateLabel(key, unit) {
  if (!unit.stateHistory) return '';
  const entry = unit.stateHistory.find(e => e.from === key);
  if (!entry) return '';
  return `${entry.status} - ${entry.type} - ${entry.elevator === 'yes' ? 'أسانسير ✅' : 'بدون أسانسير'}`;
}

function recordFeeChange(unit, month, year, newState) {
  const monthIdx = MONTHS.indexOf(month) + 1;
  const key = `${year}-${String(monthIdx).padStart(2, '0')}`;
  const newFee = calcFee(newState, state.settings);
  if (!unit.feeHistory) unit.feeHistory = [];
  if (!unit.stateHistory) unit.stateHistory = [];
  unit.feeHistory = unit.feeHistory.filter(e => e.from !== key);
  unit.stateHistory = unit.stateHistory.filter(e => e.from !== key);
  unit.feeHistory.push({ from: key, fee: newFee });
  unit.stateHistory.push({
    from: key, status: newState.status, type: newState.type,
    elevator: newState.elevator, resident: newState.resident, fee: newFee
  });
  unit.feeHistory.sort((a, b) => a.from.localeCompare(b.from));
  unit.stateHistory.sort((a, b) => a.from.localeCompare(b.from));
}

// ==================== Month Change ====================
function changeMonth(month, year) {
  state.currentMonth = month;
  state.currentYear = year;
  ['receiptMonth', 'expMonth', 'oiMonth', 'bulkMonth', 'bulkMatrixFromMonth', 'bulkMatrixToMonth'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = month;
  });
  ['receiptYear', 'expYear', 'oiYear', 'bulkYear', 'bulkMatrixYear'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = year;
  });
  const globalSel = document.getElementById('globalMonthSelect');
  const globalYear = document.getElementById('globalYearInput');
  if (globalSel) globalSel.value = month;
  if (globalYear) globalYear.value = year;
  
  renderDashboard();
  renderUnits();
  renderMatrix();
  renderExpenses();
  renderOI();
  updateBulkCounts();
}

function applyGlobalMonth() {
  const month = document.getElementById('globalMonthSelect').value;
  const year = +document.getElementById('globalYearInput').value;
  changeMonth(month, year);
  showToast(`📅 تم التطبيق على ${month} ${year}`, 'success');
}

function fillGlobalMonthSelect() {
  const sel = document.getElementById('globalMonthSelect');
  if (!sel) return;
  sel.innerHTML = MONTHS.map(m => `<option value="${m}">${m}</option>`).join('');
  sel.value = state.currentMonth;
  document.getElementById('globalYearInput').value = state.currentYear;
}

// ==================== Local Storage ====================
function saveLocal() {
  try {
    localStorage.setItem('homeAppState_v4', JSON.stringify({
      units: state.units, payments: state.payments, debts: state.debts,
      codes: state.codes, elevatorFund: state.elevatorFund, generalFund: state.generalFund,
      emergencies: state.emergencies, expenses: state.expenses, otherIncomes: state.otherIncomes,
      settings: state.settings, auditLog: state.auditLog
    }));
  } catch(e) { console.warn(e); }
}

function loadLocal() {
  try {
    const d = localStorage.getItem('homeAppState_v4') || localStorage.getItem('homeAppState_v3') || localStorage.getItem('homeAppState_v2') || localStorage.getItem('homeAppState');
    if (d) {
      const p = JSON.parse(d);
      state.units = p.units || [];
      state.payments = p.payments || [];
      state.debts = p.debts || [];
      state.codes = p.codes || [];
      state.elevatorFund = p.elevatorFund || [];
      state.generalFund = p.generalFund || [];
      state.emergencies = p.emergencies || [];
      state.expenses = p.expenses || [];
      state.otherIncomes = p.otherIncomes || [];
      state.auditLog = p.auditLog || [];
      state.settings = { ...state.settings, ...(p.settings || {}) };
      if (!state.settings.selectedCategories) state.settings.selectedCategories = [...ALL_EXPENSE_CATEGORIES];
      state.units.forEach(u => {
        if (!u.feeHistory || u.feeHistory.length === 0) u.feeHistory = [{ from: '2026-01', fee: u.amount || calcFee(u, state.settings) }];
        if (!u.stateHistory || u.stateHistory.length === 0) u.stateHistory = [{ from: '2026-01', status: u.status, type: u.type, elevator: u.elevator, resident: u.resident, fee: u.amount || calcFee(u, state.settings) }];
      });
      return true;
    }
  } catch(e) {}
  return false;
}

// ==================== Firebase CRUD ====================
async function fbAdd(col, data) {
  if (!useFirebase) return { id: 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2,5), ...data };
  try { const ref = await db.collection(col).add({ ...data, _created: firebase.firestore.FieldValue.serverTimestamp() }); return { id: ref.id, ...data }; }
  catch(e) { return { id: 'local_' + Date.now(), ...data }; }
}
async function fbUpdate(col, id, data) {
  if (!useFirebase || !id || id.startsWith('local_')) return;
  try { await db.collection(col).doc(id).update(data); } catch(e) {}
}
async function fbDelete(col, id) {
  if (!useFirebase || !id || id.startsWith('local_')) return;
  try { await db.collection(col).doc(id).delete(); } catch(e) {}
}
async function fbLoadAll() {
  if (!useFirebase) return false;
  try {
    let hasData = false;
    for (const col of ['units','payments','debts','codes','elevatorFund','generalFund','emergencies','expenses','otherIncomes','auditLog']) {
      const snap = await db.collection(col).get();
      const arr = [];
      snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
      if (arr.length > 0) hasData = true;
      if (col === 'units') state.units = arr.sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0));
      else if (col === 'payments') state.payments = arr;
      else if (col === 'debts') state.debts = arr;
      else if (col === 'codes') state.codes = arr;
      else if (col === 'elevatorFund') state.elevatorFund = arr;
      else if (col === 'generalFund') state.generalFund = arr;
      else if (col === 'emergencies') state.emergencies = arr;
      else if (col === 'expenses') state.expenses = arr;
      else if (col === 'otherIncomes') state.otherIncomes = arr;
      else if (col === 'auditLog') state.auditLog = arr.slice(0, 500);
    }
    const cfg = await db.collection('settings').doc('config').get();
    if (cfg.exists) { state.settings = { ...state.settings, ...cfg.data() }; hasData = true; }
    state.units.forEach(u => {
      if (!u.feeHistory || u.feeHistory.length === 0) u.feeHistory = [{ from: '2026-01', fee: u.amount || calcFee(u, state.settings) }];
      if (!u.stateHistory || u.stateHistory.length === 0) u.stateHistory = [{ from: '2026-01', status: u.status, type: u.type, elevator: u.elevator, resident: u.resident, fee: u.amount || calcFee(u, state.settings) }];
    });
    return hasData;
  } catch(e) { return false; }
}

async function logAudit(action, description) {
  const log = { action, description, timestamp: Date.now() };
  state.auditLog.unshift(log);
  if (state.auditLog.length > 500) state.auditLog = state.auditLog.slice(0, 500);
  if (useFirebase) { try { await db.collection('auditLog').add(log); } catch(e) {} }
}

// ==================== Utilities ====================
function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 50);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
}
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function toggleDarkMode() { document.body.classList.toggle('dark'); localStorage.setItem('darkMode', document.body.classList.contains('dark')); }
function fmt(n) { return (n||0).toLocaleString('en-US'); }

function fillMonthSelects() {
  const monthHTML = MONTHS.map(m => `<option value="${m}">${m}</option>`).join('');
  ['receiptMonth','expMonth','oiMonth','bulkMonth','bulkMatrixFromMonth','bulkMatrixToMonth'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = monthHTML;
      el.value = state.currentMonth;
    }
  });
  const expMonthFilter = document.getElementById('expMonthFilter');
  if (expMonthFilter) {
    expMonthFilter.innerHTML = '<option value="all">كل الشهور</option>' + monthHTML;
  }
}

// ==================== Tabs ====================
function switchMainTab(tab) {
  state.currentMainTab = tab;
  document.querySelectorAll('.main-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.main-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + tab));
  if (tab === 'dashboard') renderDashboard();
  if (tab === 'units') renderUnits();
  if (tab === 'matrix') renderMatrix();
  if (tab === 'expenses') renderExpenses();
  if (tab === 'oi') renderOI();
  if (tab === 'emergency') renderEmergencyList();
  if (tab === 'funds') renderFunds();
  if (tab === 'debts') renderDebts();
  if (tab === 'heatmap') renderHeatmap();
  if (tab === 'elevator') renderCodes();
}

function switchSubTab(subtab) {
  state.currentSubTab = subtab;
  document.querySelectorAll('.sub-tab').forEach(b => b.classList.toggle('active', b.dataset.subtab === subtab));
  const titles = {
    'monthly': { amount: 'المبلغ (هذا الشهر)', statement: 'إيصال الصيانة الشهرية' },
    'elevator': { amount: 'اشتراك الأسانسير', statement: 'إيصال اشتراك الأسانسير' },
    'emergency-general': { amount: 'حصة الطوارئ', statement: 'إيصال صيانة طارئة عامة' },
    'emergency-elevator': { amount: 'حصة طوارئ الأسانسير', statement: 'إيصال صيانة طارئة - أسانسير' }
  };
  if (titles[subtab]) {
    document.getElementById('thAmount').textContent = titles[subtab].amount;
    document.getElementById('receiptStatement').value = titles[subtab].statement;
  }
  state.selectedIds.clear();
  updateSelectedCount();
  renderUnits();
}

function switchMatrixTab(m) {
  state.currentMatrixTab = m;
  document.querySelectorAll('[data-matrix]').forEach(b => b.classList.toggle('active', b.dataset.matrix === m));
  document.getElementById('matrixIncome').style.display = m === 'income' ? 'block' : 'none';
  document.getElementById('matrixExpenses').style.display = m === 'expenses' ? 'block' : 'none';
}

// ==================== Dashboard ====================
function statCard(icon, value, label, color='') {
  return `<div class="stat-card ${color}"><div class="stat-icon">${icon}</div><div><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div></div>`;
}

function renderMonthDashCards() {
  const container = document.getElementById('monthDashCards');
  if (!container) return;
  const monthIdx = MONTHS.indexOf(state.currentMonth);
  const year = state.currentYear;
  const monthPayments = state.payments.filter(p => p.month === state.currentMonth && p.year === year);
  const monthOI = state.otherIncomes.filter(o => o.month === state.currentMonth && o.year === year);
  const paidThisMonth = monthPayments.reduce((s,p) => s + (p.amount||0), 0);
  const oiThisMonth = monthOI.reduce((s,o) => s + (o.amount||0), 0);
  const totalIncome = paidThisMonth + oiThisMonth;
  const monthExp = state.expenses.filter(e => e.month === state.currentMonth && e.year === year).reduce((s,e) => s + (e.amount||0), 0);
  let carry = state.settings.carryOver || 0;
  if (monthIdx > 0) {
    for (let i = 0; i < monthIdx; i++) {
      const m = MONTHS[i];
      const inc = state.payments.filter(p => p.month === m && p.year === year).reduce((s,p) => s + (p.amount||0), 0) + state.otherIncomes.filter(o => o.month === m && o.year === year).reduce((s,o) => s + (o.amount||0), 0);
      const exp = state.expenses.filter(e => e.month === m && e.year === year).reduce((s,e) => s + (e.amount||0), 0);
      carry += inc - exp;
    }
  }
  const available = carry + totalIncome - monthExp;
  const activeDebts = state.debts.filter(d => d.status !== 'paid').reduce((s,d) => s + ((d.amount||0) - (d.paid||0)), 0);
  let unitRemainingThisMonth = 0;
  state.units.forEach(u => {
    if (u.status !== 'ساكنة') return;
    const req = getFeeForMonth(u, state.currentMonth, year);
    const p = state.payments.filter(x => x.unitId === u.id && x.month === state.currentMonth && x.year === year).reduce((s,x) => s + x.amount, 0);
    unitRemainingThisMonth += Math.max(0, req - p);
  });
  container.innerHTML = `
    <div class="dash-card success"><h3>⬇️ إيرادات ${state.currentMonth} ${year}</h3><div class="value">${fmt(totalIncome)}</div><div class="sub"><span>محصل: ${fmt(paidThisMonth)}</span><span>OI: ${fmt(oiThisMonth)}</span></div></div>
    <div class="dash-card info"><h3>📦 المتاح ${state.currentMonth}</h3><div class="value">${fmt(available)}</div><div class="sub"><span>مرحل: ${fmt(carry)}</span></div></div>
    <div class="dash-card danger"><h3>⬆️ مصروفات ${state.currentMonth}</h3><div class="value">${fmt(monthExp)}</div><div class="sub"><span>عدد: ${state.expenses.filter(e => e.month === state.currentMonth && e.year === year).length}</span></div></div>
    <div class="dash-card warning"><h3>💳 مديونيات ${state.currentMonth}</h3><div class="value">${fmt(unitRemainingThisMonth)}</div><div class="sub"><span>إجمالي: ${fmt(activeDebts)}</span></div></div>`;
}

function renderDashboard() {
  renderMonthDashCards();
  const units = state.units;
  const living = units.filter(u => u.status === 'ساكنة');
  const closed = units.filter(u => u.status === 'مغلقة');
  const owners = units.filter(u => u.type === 'مالك');
  const tenants = units.filter(u => u.type === 'مستأجر');
  const elevatorUsers = units.filter(u => u.elevator === 'yes');
  let paidTotal=0, requiredTotal=0, unpaidCount=0, partialCount=0, paidCount=0;
  units.forEach(u => {
    if (u.status !== 'ساكنة') return;
    const req = getFeeForMonth(u, state.currentMonth, state.currentYear);
    requiredTotal += req;
    const p = state.payments.filter(x => x.unitId === u.id && x.month === state.currentMonth && x.year === state.currentYear).reduce((s,x) => s + (x.amount||0), 0);
    paidTotal += p;
    if (p === 0 && req > 0) unpaidCount++;
    else if (p < req) partialCount++;
    else paidCount++;
  });
  const totalDebts = state.debts.filter(d => d.status !== 'paid').reduce((s,d) => s + ((d.amount||0)-(d.paid||0)), 0);
  const elevBal = calcFundBalance(state.elevatorFund);
  const genBal = calcFundBalance(state.generalFund);
  const totalEm = state.emergencies.reduce((s,e) => s + (e.total||0), 0);
  const totalOI = state.otherIncomes.reduce((s,o) => s + (o.amount||0), 0);
  document.getElementById('dashboardStats').innerHTML = 
    statCard('🏠', units.length, 'إجمالي الوحدات') + statCard('👥', living.length, 'ساكنة', 'green') +
    statCard('🔒', closed.length, 'مغلقة', 'red') + statCard('👑', owners.length, 'ملاك', 'blue') +
    statCard('👤', tenants.length, 'مستأجرين') + statCard('🛗', elevatorUsers.length, 'أسانسير', 'blue') +
    statCard('✅', paidCount, 'سددوا', 'green') + statCard('⚠️', unpaidCount + partialCount, 'لم يسددوا', 'red') +
    statCard('💰', paidTotal.toLocaleString(), 'المحصل', 'green') + statCard('📊', requiredTotal.toLocaleString(), 'المطلوب') +
    statCard('💳', totalDebts.toLocaleString(), 'المديونيات', 'red') + statCard('💵', totalOI.toLocaleString(), 'إيرادات خارجية', 'green') +
    statCard('🏦', genBal.toLocaleString(), 'الصندوق العام', 'green') + statCard('🛗', elevBal.toLocaleString(), 'صندوق الأسانسير', 'blue') +
    statCard('🚨', totalEm.toLocaleString(), 'الطوارئ', 'red');
  document.getElementById('dashMonth').textContent = state.currentMonth + ' ' + state.currentYear;
  const alertBox = document.getElementById('smartAlert');
  const totalUnpaid = unpaidCount + partialCount;
  if (totalUnpaid > 0) { alertBox.innerHTML = `<div class="alert danger">🔴 <strong>${totalUnpaid} وحدة</strong> لم تسدد لشهر ${state.currentMonth} ${state.currentYear}<button onclick="switchMainTab('units')" style="margin-right:auto;background:var(--danger);color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-family:inherit;float:left;">عرض</button></div>`; }
  else if (units.length > 0) { alertBox.innerHTML = `<div class="alert success">✅ جميع الوحدات سددت هذا الشهر</div>`; }
  else { alertBox.innerHTML = ''; }
  const unpaidUnits = units.filter(u => {
    if (u.status !== 'ساكنة') return false;
    const req = getFeeForMonth(u, state.currentMonth, state.currentYear);
    const p = state.payments.filter(x => x.unitId === u.id && x.month === state.currentMonth && x.year === state.currentYear).reduce((s,x) => s + (x.amount||0), 0);
    return p < req;
  });
  document.getElementById('unpaidCount').textContent = unpaidUnits.length;
  document.getElementById('unpaidTableBody').innerHTML = unpaidUnits.length ? unpaidUnits.map((u,i) => {
    const req = getFeeForMonth(u, state.currentMonth, state.currentYear);
    const p = state.payments.filter(x => x.unitId === u.id && x.month === state.currentMonth && x.year === state.currentYear).reduce((s,x) => s + (x.amount||0), 0);
    const rem = req - p;
    const st = p === 0 ? 'لم يدفع' : 'جزئي';
    const cls = p === 0 ? 'status-red' : 'status-yellow';
    return `<tr><td>${i+1}</td><td><strong>${u.number}</strong></td><td>${u.resident}</td><td>${req}</td><td>${p}</td><td style="color:#c62828;font-weight:700;">${rem}</td><td><span class="badge ${cls}">${st}</span></td><td><button class="icon-btn" onclick="openPaymentModal('${u.id}')" title="دفع">💵</button><button class="icon-btn" onclick="addDebtToUnit('${u.id}')" title="إضافة مديونية">📋</button></td></tr>`;
  }).join('') : '<tr><td colspan="8" style="text-align:center;padding:20px;color:#888;">لا توجد وحدات متأخرة 🎉</td></tr>';
  const recent = state.payments.slice(0, 8);
  document.getElementById('recentTransactions').innerHTML = recent.length
    ? recent.map(p => `<div style="display:flex;align-items:center;gap:12px;padding:10px;border-bottom:1px solid var(--border);"><span style="font-size:20px;">💵</span><div style="flex:1;"><strong>${p.unitNumber||'-'} - ${p.resident||'-'}</strong><br><small style="color:var(--text-light);font-size:11px;">${p.month} ${p.year} - ${p.method||''}</small></div><span style="color:var(--success);font-weight:700;">+${p.amount} ج</span></div>`).join('')
    : '<p style="color:#888;text-align:center;padding:20px;">لا توجد معاملات</p>';
  document.getElementById('paymentSummary').innerHTML = `
    <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);"><span>🟢 مدفوع بالكامل</span><strong>${paidCount} وحدة</strong></div>
    <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);"><span>🟡 مدفوع جزئياً</span><strong>${partialCount} وحدة</strong></div>
    <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);"><span>🔴 لم يدفع</span><strong>${unpaidCount} وحدة</strong></div>
    <div style="display:flex;justify-content:space-between;padding:12px;background:var(--success-light);border-radius:6px;margin-top:8px;"><span>💰 إجمالي المحصل</span><strong>${paidTotal.toLocaleString()} ج</strong></div>`;
  const genInc = state.generalFund.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
  const genExp = state.generalFund.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
  document.getElementById('generalFundSummary').innerHTML = `
    <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);"><span>💰 الإيرادات</span><strong style="color:var(--success);">${genInc.toLocaleString()} ج</strong></div>
    <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);"><span>💸 المصروفات</span><strong style="color:var(--danger);">${genExp.toLocaleString()} ج</strong></div>
    <div style="display:flex;justify-content:space-between;padding:12px;background:var(--primary);color:#fff;border-radius:6px;margin-top:8px;"><span>🏦 الرصيد</span><strong>${(genInc-genExp).toLocaleString()} ج</strong></div>`;
  const elInc = state.elevatorFund.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
  const elExp = state.elevatorFund.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
  document.getElementById('elevatorFundSummary').innerHTML = `
    <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);"><span>💰 الإيرادات</span><strong style="color:var(--success);">${elInc.toLocaleString()} ج</strong></div>
    <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);"><span>💸 المصروفات</span><strong style="color:var(--danger);">${elExp.toLocaleString()} ج</strong></div>
    <div style="display:flex;justify-content:space-between;padding:12px;background:#1565c0;color:#fff;border-radius:6px;margin-top:8px;"><span>🛗 الرصيد</span><strong>${(elInc-elExp).toLocaleString()} ج</strong></div>`;
}

// ==================== Units ====================
function getRequiredForUnit(unit, subtab) {
  if (subtab === 'emergency-general' || subtab === 'emergency-elevator') return unit._emergencyShare || 0;
  return getFeeForMonth(unit, state.currentMonth, state.currentYear);
}
function getPaymentForUnit(unitId, month, year) {
  return state.payments.filter(p => p.unitId === unitId && p.month === month && p.year === year).reduce((s,p) => s + (p.amount||0), 0);
}

function renderUnits() {
  const tbody = document.getElementById('unitsTableBody');
  if (!tbody) return;
  const subtab = state.currentSubTab;
  const month = state.currentMonth, year = state.currentYear;
  const search = document.getElementById('searchInput')?.value.toLowerCase() || '';
  const filter = document.getElementById('filterSelect')?.value || 'all';
  let filtered = [...state.units];
  if (subtab === 'elevator' || subtab === 'emergency-elevator') filtered = filtered.filter(u => u.elevator === 'yes');
  if (search) filtered = filtered.filter(u => (u.resident||'').toLowerCase().includes(search) || (u.number||'').includes(search) || (u.floor||'').includes(search));
  switch(filter) {
    case 'living': filtered = filtered.filter(u => u.status === 'ساكنة'); break;
    case 'closed': filtered = filtered.filter(u => u.status === 'مغلقة'); break;
    case 'owner': filtered = filtered.filter(u => u.type === 'مالك'); break;
    case 'tenant': filtered = filtered.filter(u => u.type === 'مستأجر'); break;
    case 'elevator_yes': filtered = filtered.filter(u => u.elevator === 'yes'); break;
    case 'elevator_no': filtered = filtered.filter(u => u.elevator === 'no'); break;
    case 'unpaid': filtered = filtered.filter(u => getPaymentForUnit(u.id, month, year) < getFeeForMonth(u, month, year)); break;
  }
  document.getElementById('filterCount').textContent = filtered.length + ' وحدة';
  let totalReq = 0, totalPaid = 0;
  tbody.innerHTML = filtered.map((u, i) => {
    const required = getRequiredForUnit(u, subtab);
    const paid = getPaymentForUnit(u.id, month, year);
    const remaining = Math.max(0, required - paid);
    const unitDebts = state.debts.filter(d => d.unitId === u.id && d.status !== 'paid').reduce((s,d) => s + ((d.amount||0)-(d.paid||0)), 0);
    const unitPaymentsCount = state.payments.filter(p => p.unitId === u.id && p.month === month && p.year === year).length;
    totalReq += required;
    totalPaid += paid;
    let st, cls;
    if (paid === 0 && required > 0) { st = 'لم يدفع'; cls = 'status-red'; }
    else if (paid < required) { st = 'جزئي'; cls = 'status-yellow'; }
    else if (required === 0) { st = '—'; cls = 'status-blue'; }
    else { st = 'مدفوع'; cls = 'status-green'; }
    const checked = state.selectedIds.has(u.id) ? 'checked' : '';
    const statusCls = u.status === 'ساكنة' ? 'status-green' : 'status-red';
    const typeColor = u.type === 'مالك' ? '#1a73e8' : (u.type === 'مستأجر' ? '#0d652d' : '#c62828');
    return `<tr>
      <td><input type="checkbox" ${checked} onchange="toggleUnitSelect('${u.id}', this)"></td>
      <td>${i+1}</td><td>${u.floor}</td><td><strong>${u.number}</strong></td>
      <td style="font-weight:600;">${u.resident || '-'}</td>
      <td><span class="badge ${statusCls}">${u.status}</span></td>
      <td style="color:${typeColor};font-weight:700;">${u.type}</td>
      <td>${u.elevator === 'yes' ? '✅' : '❌'}</td>
      <td style="font-weight:700;color:var(--primary);">${required}</td>
      <td><span class="badge ${cls}">${st}</span></td>
      <td>${unitDebts > 0 ? `<span style="color:#c62828;font-weight:700;">${unitDebts}</span>` : '-'}</td>
      <td><button class="icon-btn" onclick="showUnitPayments('${u.id}', '${month}', ${year})" title="عرض الدفعات" style="background:rgba(46,125,50,.1);border-radius:6px;padding:4px 10px;font-size:12px;">📋 ${unitPaymentsCount > 0 ? unitPaymentsCount : '0'}</button></td>
      <td>
        <button class="icon-btn" onclick="openUnitModal('${u.id}')" title="تعديل">✏️</button>
        <button class="icon-btn" onclick="openPaymentModal('${u.id}')" title="دفع">💵</button>
        <button class="icon-btn" onclick="addDebtToUnit('${u.id}')" title="إضافة مديونية">📋</button>
        <button class="icon-btn" onclick="printSingle('${u.id}')" title="طباعة">🖨️</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="13" style="text-align:center;padding:40px;color:#888;">لا توجد وحدات</td></tr>';
  document.getElementById('totalsBar').innerHTML = `
    <span>📊 المطلوب: <strong class="required">${totalReq.toLocaleString()}</strong></span>
    <span>💰 المحصل: <strong class="paid">${totalPaid.toLocaleString()}</strong></span>
    <span>⏳ المتبقي: <strong class="remaining">${(totalReq - totalPaid).toLocaleString()}</strong></span>
    <span>🏠 عدد الوحدات: <strong>${filtered.length}</strong></span>`;
  updateBulkCounts();
}

function updateBulkCounts() {
  const month = state.currentMonth, year = state.currentYear;
  document.getElementById('cntClosed').textContent = state.units.filter(u => u.status === 'مغلقة').length;
  document.getElementById('cntOwners').textContent = state.units.filter(u => u.type === 'مالك').length;
  document.getElementById('cntTenants').textContent = state.units.filter(u => u.type === 'مستأجر').length;
  document.getElementById('cntLiving').textContent = state.units.filter(u => u.status === 'ساكنة').length;
  document.getElementById('cntElev').textContent = state.units.filter(u => u.elevator === 'yes').length;
  document.getElementById('cntUnpaid').textContent = state.units.filter(u => {
    if (u.status !== 'ساكنة') return false;
    return getPaymentForUnit(u.id, month, year) < getFeeForMonth(u, month, year);
  }).length;
  updateSelectedCount();
}

function updateSelectedCount() {
  const el = document.getElementById('selectedCount');
  if (el) el.textContent = state.selectedIds.size;
}

function selectByCategory(cat) {
  state.selectedIds.clear();
  const month = state.currentMonth, year = state.currentYear;
  state.units.forEach(u => {
    let match = false;
    if (cat === 'closed' && u.status === 'مغلقة') match = true;
    else if (cat === 'owners' && u.type === 'مالك') match = true;
    else if (cat === 'tenants' && u.type === 'مستأجر') match = true;
    else if (cat === 'living' && u.status === 'ساكنة') match = true;
    else if (cat === 'elevator' && u.elevator === 'yes') match = true;
    else if (cat === 'unpaid' && u.status === 'ساكنة' && getPaymentForUnit(u.id, month, year) < getFeeForMonth(u, month, year)) match = true;
    if (match) state.selectedIds.add(u.id);
  });
  renderUnits();
  showToast(`✅ تم تحديد ${state.selectedIds.size} وحدة`, 'success');
}

function toggleUnitSelect(id, el) { if (el.checked) state.selectedIds.add(id); else state.selectedIds.delete(id); updateSelectedCount(); }
function selectAll() { document.querySelectorAll('#unitsTableBody input[type="checkbox"]').forEach(el => { el.checked = true; const id = el.closest('tr').querySelector('button[onclick*="openUnitModal"]')?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1]; if (id) state.selectedIds.add(id); }); updateSelectedCount(); }
function deselectAll() { state.selectedIds.clear(); document.querySelectorAll('#unitsTableBody input[type="checkbox"]').forEach(el => el.checked = false); updateSelectedCount(); }
function applyPrintFilter() { state.filterActive = true; renderUnits(); }

// ==================== Bulk Actions ====================
function bulkPaymentModal() {
  if (state.selectedIds.size === 0) { showToast('⚠️ اختر وحدات أولاً', 'warning'); return; }
  const selected = state.units.filter(u => state.selectedIds.has(u.id));
  const month = state.currentMonth, year = state.currentYear;
  let totalReq = 0;
  selected.forEach(u => { totalReq += getFeeForMonth(u, month, year); });
  document.getElementById('bulkCount').value = selected.length;
  document.getElementById('bulkRequired').value = totalReq;
  document.getElementById('bulkInfo').innerHTML = `سيتم تسجيل دفعة لـ <strong>${selected.length}</strong> وحدة، إجمالي المطلوب: <strong>${fmt(totalReq)}</strong> ج (${month} ${year})`;
  document.getElementById('bulkMonth').value = month;
  document.getElementById('bulkYear').value = year;
  const avgReq = Math.round(totalReq / selected.length) || 0;
  document.getElementById('bulkAmountPerUnit').value = avgReq;
  updateBulkSummary();
  openModal('bulkPaymentModal');
}

function updateBulkSummary() {
  const count = +document.getElementById('bulkCount').value || 0;
  const perUnit = +document.getElementById('bulkAmountPerUnit').value || 0;
  const total = count * perUnit;
  document.getElementById('bulkSummaryBox').innerHTML = `<div class="alert success">سيتم تسجيل <strong>${total}</strong> ج إجمالاً (${perUnit} ج × ${count} وحدة)</div>`;
}

async function submitBulkPayment() {
  const perUnit = +document.getElementById('bulkAmountPerUnit').value || 0;
  const method = document.getElementById('bulkMethod').value;
  const month = document.getElementById('bulkMonth').value;
  const year = +document.getElementById('bulkYear').value;
  if (!perUnit) { showToast('⚠️ أدخل المبلغ', 'warning'); return; }
  const selected = state.units.filter(u => state.selectedIds.has(u.id));
  let count = 0;
  for (const u of selected) {
    const required = getFeeForMonth(u, month, year);
    const alreadyPaid = getPaymentForUnit(u.id, month, year);
    const remaining = Math.max(0, required - (alreadyPaid + perUnit));
    const p = await fbAdd('payments', { unitId: u.id, unitNumber: u.number, resident: u.resident, amount: perUnit, required, remaining, month, year, method, notes: 'سداد جماعي', subtab: state.currentSubTab, timestamp: Date.now() });
    state.payments.unshift(p);
    if (remaining > 0) {
      const d = await fbAdd('debts', { unitId: u.id, unitNumber: u.number, resident: u.resident, amount: remaining, paid: 0, status: 'active', description: `فرق صيانة ${month} ${year}`, type: u.elevator === 'yes' ? 'elevator' : 'general', notes: 'ترحيل من سداد جماعي', auto: true, createdAt: Date.now() });
      state.debts.unshift(d);
    }
    if (perUnit > 0) {
      if (u.elevator === 'yes') {
        const ep = Math.round(perUnit * 0.4);
        const gp = perUnit - ep;
        if (ep > 0) { const e = await fbAdd('elevatorFund', { type: 'income', amount: ep, description: `اشتراك - ${u.number}`, category: 'اشتراك', unitId: u.id, timestamp: Date.now() }); state.elevatorFund.unshift(e); }
        if (gp > 0) { const g = await fbAdd('generalFund', { type: 'income', amount: gp, description: `اشتراك - ${u.number}`, category: 'اشتراك', unitId: u.id, timestamp: Date.now() }); state.generalFund.unshift(g); }
      } else {
        const g = await fbAdd('generalFund', { type: 'income', amount: perUnit, description: `اشتراك - ${u.number}`, category: 'اشتراك', unitId: u.id, timestamp: Date.now() });
        state.generalFund.unshift(g);
      }
    }
    count++;
  }
  await logAudit('bulk_payment', `سداد جماعي ${count} وحدة × ${perUnit} ج`);
  saveLocal();
  closeModal('bulkPaymentModal');
  state.selectedIds.clear();
  renderUnits();
  showToast(`✅ تم تسجيل ${count} دفعة`, 'success');
}

function bulkDebtModal() {
  if (state.selectedIds.size === 0) { showToast('⚠️ اختر وحدات أولاً', 'warning'); return; }
  document.getElementById('bulkDebtCount').value = state.selectedIds.size;
  document.getElementById('bulkDebtInfo').innerHTML = `سيتم إضافة مديونية لـ <strong>${state.selectedIds.size}</strong> وحدة`;
  document.getElementById('bulkDebtAmount').value = '';
  document.getElementById('bulkDebtDescription').value = '';
  openModal('bulkDebtModal');
}

async function submitBulkDebt() {
  const amount = +document.getElementById('bulkDebtAmount').value || 0;
  const description = document.getElementById('bulkDebtDescription').value || 'مديونية جماعية';
  if (!amount) { showToast('⚠️ أدخل المبلغ', 'warning'); return; }
  const selected = state.units.filter(u => state.selectedIds.has(u.id));
  let count = 0;
  for (const u of selected) {
    const d = await fbAdd('debts', { unitId: u.id, unitNumber: u.number, resident: u.resident, amount, paid: 0, status: 'active', description, type: u.elevator === 'yes' ? 'elevator' : 'general', notes: 'مديونية جماعية', createdAt: Date.now() });
    state.debts.unshift(d);
    count++;
  }
  await logAudit('bulk_debt', `${count} وحدة × ${amount} ج - ${description}`);
  saveLocal();
  closeModal('bulkDebtModal');
  state.selectedIds.clear();
  renderUnits();
  showToast(`✅ تمت إضافة ${count} مديونية`, 'success');
}

// ==================== Show Unit Payments ====================
function showUnitPayments(unitId, month, year) {
  const unit = state.units.find(u => u.id === unitId);
  if (!unit) return;
  const payments = state.payments.filter(p => p.unitId === unitId && p.month === month && p.year === year);
  const required = getFeeForMonth(unit, month, year);
  let html = `<div class="modal-overlay open" id="paymentsListModal">
    <div class="modal wide">
      <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">✕</button>
      <h2>💵 دفعات الوحدة ${unit.number} - ${month} ${year}</h2>
      <div class="info-grid">
        <div><label>الوحدة</label><strong>${unit.number} - ${unit.floor}</strong></div>
        <div><label>الساكن</label><strong>${unit.resident || '-'}</strong></div>
        <div><label>المطلوب لهذا الشهر</label><strong style="color:var(--primary);">${required} ج</strong></div>
        <div><label>المدفوع</label><strong style="color:var(--success);">${payments.reduce((s,p) => s + (p.amount||0), 0)} ج</strong></div>
      </div>`;
  if (payments.length === 0) {
    html += `<div class="alert warning">لا توجد دفعات مسجلة لهذا الشهر</div>`;
  } else {
    html += `<table class="report-table">
      <thead><tr><th>#</th><th>المبلغ</th><th>المطلوب</th><th>المتبقي</th><th>طريقة الدفع</th><th>ملاحظات</th><th>التاريخ</th><th>إجراءات</th></tr></thead>
      <tbody>`;
    payments.forEach((p, i) => {
      html += `<tr>
        <td>${i+1}</td>
        <td style="color:#2e7d32;font-weight:700;">${p.amount} ج</td>
        <td>${p.required || 0} ج</td>
        <td style="color:${(p.remaining||0) > 0 ? '#c62828' : '#2e7d32'};font-weight:700;">${p.remaining || 0} ج</td>
        <td>${p.method || '-'}</td>
        <td>${p.notes || '-'}</td>
        <td>${p.timestamp ? new Date(p.timestamp).toLocaleString('ar-EG') : '-'}</td>
        <td><button class="btn-red" style="padding:6px 12px;font-size:12px;" onclick="deletePayment('${p.id}');this.closest('.modal-overlay').remove()">🗑️ حذف</button></td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }
  html += `<div class="btn-row"><button class="cancel" onclick="this.closest('.modal-overlay').remove()">إغلاق</button></div>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

async function deletePayment(paymentId) {
  const payment = state.payments.find(p => p.id === paymentId);
  if (!payment) return;
  if (!confirm(`هل تريد حذف دفعة ${payment.amount} ج للوحدة ${payment.unitNumber} لشهر ${payment.month} ${payment.year}؟`)) return;
  await fbDelete('payments', paymentId);
  state.payments = state.payments.filter(p => p.id !== paymentId);
  const linkedDebt = state.debts.find(d => d.unitId === payment.unitId && d.description && d.description.includes(payment.month) && d.description.includes(String(payment.year)) && d.status === 'active' && d.amount === payment.remaining);
  if (linkedDebt) {
    await fbDelete('debts', linkedDebt.id);
    state.debts = state.debts.filter(d => d.id !== linkedDebt.id);
  }
  saveLocal();
  renderUnits();
  renderDashboard();
  showToast('✅ تم حذف الدفعة', 'success');
}

// ==================== Add Debt ====================
function addDebtToUnit(unitId) {
  const u = state.units.find(x => x.id === unitId);
  if (!u) return;
  const amount = prompt(`إضافة مديونية على ${u.number} - ${u.resident}\nأدخل المبلغ:`);
  if (!amount || +amount <= 0) return;
  const description = prompt('الوصف:', 'مديونية يدوية') || 'مديونية يدوية';
  (async () => {
    const d = await fbAdd('debts', { unitId, unitNumber: u.number, resident: u.resident, amount: +amount, paid: 0, status: 'active', description, type: u.elevator === 'yes' ? 'elevator' : 'general', notes: '', createdAt: Date.now() });
    state.debts.unshift(d);
    saveLocal();
    renderUnits();
    showToast(`✅ مديونية ${amount} ج على ${u.number}`, 'success');
  })();
}

// ==================== Matrix ====================
function renderMatrix() {
  const year = +document.getElementById('matrixYear')?.value || state.currentYear;
  renderMatrixIncome(year);
  renderMatrixExpenses(year);
}

function renderMatrixIncome(year) {
  const container = document.getElementById('matrixIncome');
  if (!container) return;
  let html = '<table class="matrix-table"><thead><tr>';
  html += '<th class="sticky-col" style="min-width:180px;">الوحدة</th>';
  MONTHS.forEach(m => {
    const cur = (m === state.currentMonth && year === state.currentYear) ? ' current-month' : '';
    html += `<th class="${cur}">${m}</th>`;
  });
  html += '<th style="background:#2e7d32;">المجموع</th><th style="background:#e65100;">رصيد سابق</th><th style="background:#1565c0;">رصيد السنة</th></tr></thead><tbody>';
  let monthlyTotals = new Array(12).fill(0);
  let grandTotal = 0, totalOpBalance = 0, totalFinalBalance = 0;
  state.units.forEach(u => {
    let unitTotal = 0;
    const unitDebts = state.debts.filter(d => d.unitId === u.id && d.status !== 'paid').reduce((s,d) => s + ((d.amount||0)-(d.paid||0)), 0);
    const opBalance = u.openingBalance || 0;
    html += `<tr><td class="sticky-col"><span class="unit-name">${u.number} - ${u.resident || 'الساكن'}</span><span class="unit-floor">${u.floor}</span></td>`;
    MONTHS.forEach(m => {
      const paid = state.payments.filter(p => p.unitId === u.id && p.month === m && p.year === year).reduce((s,p) => s + p.amount, 0);
      const fee = getFeeForMonth(u, m, year);
      const cur = (m === state.currentMonth && year === state.currentYear) ? ' current-month' : '';
      let cls = 'cell-empty', text = '-';
      if (paid > 0) {
        text = fmt(paid);
        if (fee > 0 && paid >= fee) cls = 'cell-paid';
        else if (fee > 0) cls = 'cell-partial';
        else cls = 'cell-paid';
      } else if (fee > 0) {
        const monthIdx = MONTHS.indexOf(m);
        const curMonthIdx = MONTHS.indexOf(state.currentMonth);
        if (year < state.currentYear || (year === state.currentYear && monthIdx < curMonthIdx)) {
          text = 'م'; cls = 'cell-unpaid';
        }
      }
      html += `<td class="${cls}${cur}"><span class="editable-cell" onclick="openMatrixEdit('${u.id}', '${m}', ${year})" title="انقر لتسجيل دفعة - المطلوب: ${fee} ج">${text}</span><span class="fee-note">${fee > 0 ? fee + ' ج' : '—'}</span></td>`;
      unitTotal += paid;
      monthlyTotals[MONTHS.indexOf(m)] += paid;
    });
    const finalBalance = unitTotal - unitDebts + opBalance;
    html += `<td class="row-total">${fmt(unitTotal)}</td><td class="row-op-balance" style="color:${opBalance < 0 ? 'var(--danger)' : (opBalance > 0 ? 'var(--success)' : '#888')};">${fmt(opBalance)}</td><td class="row-final-balance" style="color:${finalBalance < 0 ? 'var(--danger)' : (finalBalance > 0 ? 'var(--success)' : '#888')};">${fmt(finalBalance)}</td></tr>`;
    grandTotal += unitTotal;
    totalOpBalance += opBalance;
    totalFinalBalance += finalBalance;
  });
  html += '</tbody><tfoot><tr><td class="sticky-col" style="background:var(--primary);color:#fff;">إجمالي الإيرادات</td>';
  monthlyTotals.forEach(t => html += `<td>${t > 0 ? fmt(t) : '0'}</td>`);
  html += `<td>${fmt(grandTotal)}</td><td>${fmt(totalOpBalance)}</td><td>${fmt(totalFinalBalance)}</td></tr></tfoot></table>`;
  container.innerHTML = html;
}

function renderMatrixExpenses(year) {
  const container = document.getElementById('matrixExpenses');
  if (!container) return;
  const selectedCats = state.settings.selectedCategories || ALL_EXPENSE_CATEGORIES;
  let html = '<table class="matrix-table"><thead><tr>';
  html += '<th class="sticky-col" style="min-width:180px;">البند</th>';
  MONTHS.forEach(m => {
    const cur = (m === state.currentMonth && year === state.currentYear) ? ' current-month' : '';
    html += `<th class="${cur}">${m}</th>`;
  });
  html += '<th style="background:#2e7d32;">المجموع</th></tr></thead><tbody>';
  let monthlyTotals = new Array(12).fill(0);
  let grandTotal = 0;
  selectedCats.forEach(cat => {
    let catTotal = 0;
    html += `<tr><td class="sticky-col"><span class="unit-name">${cat}</span></td>`;
    MONTHS.forEach((m, idx) => {
      const amt = state.expenses.filter(e => e.category === cat && e.month === m && e.year === year).reduce((s,e) => s + (e.amount||0), 0);
      const cur = (m === state.currentMonth && year === state.currentYear) ? ' current-month' : '';
      html += `<td class="${amt > 0 ? 'cell-unpaid' : 'cell-empty'}${cur}">${amt > 0 ? '-' + fmt(amt) : '-'}</td>`;
      catTotal += amt;
      monthlyTotals[idx] += amt;
    });
    html += `<td class="exp-row-total">-${fmt(catTotal)}</td></tr>`;
    grandTotal += catTotal;
  });
  html += '</tbody><tfoot><tr><td class="sticky-col" style="background:var(--danger);color:#fff;">إجمالي المصروفات</td>';
  monthlyTotals.forEach(t => html += `<td>${t > 0 ? '-' + fmt(t) : '0'}</td>`);
  html += `<td>-${fmt(grandTotal)}</td></tr></tfoot></table>`;
  container.innerHTML = html;
}

function openMatrixEdit(unitId, month, year) {
  const u = state.units.find(x => x.id === unitId);
  if (!u) return;
  const required = getFeeForMonth(u, month, year);
  const paid = getPaymentForUnit(unitId, month, year);
  const remaining = Math.max(0, required - paid);
  state.matrixEdit = { unitId, month, year, required, paid };
  document.getElementById('matrixEditInfo').innerHTML = `
    <div><label>الوحدة</label><strong>${u.number} - ${u.resident || '-'}</strong></div>
    <div><label>الشهر</label><strong>${month} ${year}</strong></div>
    <div><label>الحالة في هذا الشهر</label><strong>${getStateLabel(`${year}-${String(MONTHS.indexOf(month)+1).padStart(2,'0')}`, u) || u.status}</strong></div>
    <div><label>أسانسير</label><strong>${u.elevator === 'yes' ? 'نعم' : 'لا'}</strong></div>
  `;
  document.getElementById('matrixEditRequired').value = required;
  document.getElementById('matrixEditPaid').value = paid;
  document.getElementById('matrixEditNewAmount').value = remaining || required;
  document.getElementById('matrixEditSummary').innerHTML = remaining > 0 ? `<div class="alert warning">متبقي: <strong>${remaining}</strong> ج</div>` : `<div class="alert success">مدفوع بالكامل</div>`;
  openModal('matrixEditModal');
}

async function submitMatrixEdit() {
  if (!state.matrixEdit) return;
  const { unitId, month, year, required, paid } = state.matrixEdit;
  const amount = +document.getElementById('matrixEditNewAmount').value || 0;
  const method = document.getElementById('matrixEditMethod').value;
  if (amount <= 0) { showToast('⚠️ أدخل مبلغاً صحيحاً', 'warning'); return; }
  const u = state.units.find(x => x.id === unitId);
  if (!u) return;
  const remaining = Math.max(0, required - (paid + amount));
  const p = await fbAdd('payments', { unitId, unitNumber: u.number, resident: u.resident, amount, required, remaining, month, year, method, notes: 'تسجيل من المصفوفة السنوية', subtab: 'monthly', timestamp: Date.now() });
  state.payments.unshift(p);
  if (remaining > 0) {
    const d = await fbAdd('debts', { unitId, unitNumber: u.number, resident: u.resident, amount: remaining, paid: 0, status: 'active', description: `فرق ${month} ${year}`, type: u.elevator === 'yes' ? 'elevator' : 'general', notes: 'من المصفوفة', auto: true, createdAt: Date.now() });
    state.debts.unshift(d);
  }
  if (amount > 0) {
    if (u.elevator === 'yes') {
      const ep = Math.round(amount * 0.4);
      const gp = amount - ep;
      if (ep > 0) { const e = await fbAdd('elevatorFund', { type: 'income', amount: ep, description: `اشتراك - ${u.number} - ${month}`, category: 'اشتراك', unitId, timestamp: Date.now() }); state.elevatorFund.unshift(e); }
      if (gp > 0) { const g = await fbAdd('generalFund', { type: 'income', amount: gp, description: `اشتراك - ${u.number} - ${month}`, category: 'اشتراك', unitId, timestamp: Date.now() }); state.generalFund.unshift(g); }
    } else {
      const g = await fbAdd('generalFund', { type: 'income', amount, description: `اشتراك - ${u.number} - ${month}`, category: 'اشتراك', unitId, timestamp: Date.now() });
      state.generalFund.unshift(g);
    }
  }
  await logAudit('matrix_payment', `${amount} ج - ${u.number} - ${month} ${year}`);
  saveLocal();
  closeModal('matrixEditModal');
  state.matrixEdit = null;
  renderMatrix();
  showToast(`✅ تم تسجيل ${amount} ج لشهر ${month}`, 'success');
}

function openBulkMatrixPayment() {
  if (state.selectedIds.size === 0) { showToast('⚠️ اختر وحدات أولاً من صفحة الوحدات', 'warning'); return; }
  document.getElementById('bulkMatrixFromMonth').value = 'يناير';
  document.getElementById('bulkMatrixToMonth').value = state.currentMonth;
  document.getElementById('bulkMatrixYear').value = state.currentYear;
  document.getElementById('bulkMatrixAmount').value = '';
  openModal('bulkMatrixPaymentModal');
}

async function submitBulkMatrixPayment() {
  const fromMonth = document.getElementById('bulkMatrixFromMonth').value;
  const toMonth = document.getElementById('bulkMatrixToMonth').value;
  const year = +document.getElementById('bulkMatrixYear').value;
  const customAmount = document.getElementById('bulkMatrixAmount').value ? +document.getElementById('bulkMatrixAmount').value : null;
  const fromIdx = MONTHS.indexOf(fromMonth);
  const toIdx = MONTHS.indexOf(toMonth);
  if (fromIdx > toIdx) { showToast('⚠️ "من" يجب أن يكون قبل "إلى"', 'warning'); return; }
  const selected = state.units.filter(u => state.selectedIds.has(u.id));
  let count = 0, totalAmount = 0;
  for (const u of selected) {
    for (let i = fromIdx; i <= toIdx; i++) {
      const month = MONTHS[i];
      const required = getFeeForMonth(u, month, year);
      const alreadyPaid = getPaymentForUnit(u.id, month, year);
      const amountToPay = customAmount !== null ? customAmount : Math.max(0, required - alreadyPaid);
      if (amountToPay <= 0) continue;
      const remaining = Math.max(0, required - (alreadyPaid + amountToPay));
      const p = await fbAdd('payments', { unitId: u.id, unitNumber: u.number, resident: u.resident, amount: amountToPay, required, remaining, month, year, method: 'Chash', notes: 'سداد جماعي من المصفوفة', subtab: 'monthly', timestamp: Date.now() });
      state.payments.unshift(p);
      if (remaining > 0) {
        const d = await fbAdd('debts', { unitId: u.id, unitNumber: u.number, resident: u.resident, amount: remaining, paid: 0, status: 'active', description: `فرق ${month} ${year}`, type: u.elevator === 'yes' ? 'elevator' : 'general', notes: 'من المصفوفة', auto: true, createdAt: Date.now() });
        state.debts.unshift(d);
      }
      if (amountToPay > 0) {
        if (u.elevator === 'yes') {
          const ep = Math.round(amountToPay * 0.4);
          const gp = amountToPay - ep;
          if (ep > 0) { const e = await fbAdd('elevatorFund', { type: 'income', amount: ep, description: `اشتراك - ${u.number} - ${month}`, category: 'اشتراك', unitId: u.id, timestamp: Date.now() }); state.elevatorFund.unshift(e); }
          if (gp > 0) { const g = await fbAdd('generalFund', { type: 'income', amount: gp, description: `اشتراك - ${u.number} - ${month}`, category: 'اشتراك', unitId: u.id, timestamp: Date.now() }); state.generalFund.unshift(g); }
        } else {
          const g = await fbAdd('generalFund', { type: 'income', amount: amountToPay, description: `اشتراك - ${u.number} - ${month}`, category: 'اشتراك', unitId: u.id, timestamp: Date.now() });
          state.generalFund.unshift(g);
        }
      }
      totalAmount += amountToPay;
      count++;
    }
  }
  await logAudit('bulk_matrix_payment', `${count} دفعة - ${totalAmount} ج`);
  saveLocal();
  closeModal('bulkMatrixPaymentModal');
  renderMatrix();
  showToast(`✅ تم تسجيل ${count} دفعة بإجمالي ${fmt(totalAmount)} ج`, 'success');
}

function printMatrix(type) {
  const year = +document.getElementById('matrixYear').value || state.currentYear;
  const container = type === 'income' ? document.getElementById('matrixIncome') : document.getElementById('matrixExpenses');
  const title = type === 'income' ? 'مصفوفة الإيرادات' : 'مصفوفة المصروفات';
  const html = `<div style="padding:20px;"><h2 style="text-align:center;color:#1a3a5c;margin-bottom:12px;">${title} - ${year}</h2>${container.innerHTML}</div>`;
  const w = window.open('', '_blank');
  w.document.write(`<html dir="rtl"><head><meta charset="UTF-8"><title>${title}</title><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet"><style>body{font-family:Cairo,sans-serif;padding:10px;direction:rtl;}table{width:100%;border-collapse:collapse;font-size:10px;}th,td{padding:4px;border:1px solid #999;text-align:center;}th{background:#1a3a5c;color:#fff;}.sticky-col{text-align:right;background:#f5f5f5;font-weight:600;}.cell-paid{color:#2e7d32;font-weight:700;}.cell-unpaid{color:#c62828;font-weight:700;}.cell-partial{color:#e65100;font-weight:700;}.current-month{background:#fff3e0;}tfoot td{background:#1a3a5c;color:#fff;font-weight:700;}@page{size:A4 landscape;margin:5mm;}</style></head><body>${html}</body></html>`);
  w.document.close();
  w.onload = () => setTimeout(() => { w.focus(); w.print(); }, 500);
}

function exportMatrixExcel(type) {
  const year = +document.getElementById('matrixYear').value || state.currentYear;
  let data = [];
  if (type === 'income') {
    state.units.forEach(u => {
      const row = { 'الوحدة': u.number + ' - ' + (u.resident||''), 'الدور': u.floor };
      MONTHS.forEach(m => { row[m] = state.payments.filter(p => p.unitId === u.id && p.month === m && p.year === year).reduce((s,p) => s + p.amount, 0); });
      row['المجموع'] = MONTHS.reduce((s,m) => s + row[m], 0);
      row['رصيد سابق'] = u.openingBalance || 0;
      data.push(row);
    });
  } else {
    const cats = state.settings.selectedCategories || ALL_EXPENSE_CATEGORIES;
    cats.forEach(cat => {
      const row = { 'البند': cat };
      MONTHS.forEach(m => { row[m] = state.expenses.filter(e => e.category === cat && e.month === m && e.year === year).reduce((s,e) => s + (e.amount||0), 0); });
      data.push(row);
    });
  }
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, type === 'income' ? 'Income' : 'Expenses');
  XLSX.writeFile(wb, `matrix_${type}_${year}.xlsx`);
}
// ==================== Expenses ====================
function openExpenseModal() {
  document.getElementById('expAmount').value = '';
  document.getElementById('expDescription').value = '';
  document.getElementById('expDate').value = new Date().toISOString().split('T')[0];
  openModal('expenseModal');
}

async function saveExpense() {
  const data = {
    category: document.getElementById('expCategory').value,
    amount: +document.getElementById('expAmount').value || 0,
    month: document.getElementById('expMonth').value,
    year: +document.getElementById('expYear').value || 2026,
    fund: document.getElementById('expFund').value,
    description: document.getElementById('expDescription').value,
    date: document.getElementById('expDate').value || new Date().toISOString().split('T')[0],
    timestamp: Date.now()
  };
  if (!data.amount) { showToast('⚠️ أدخل المبلغ', 'warning'); return; }
  const added = await fbAdd('expenses', data);
  state.expenses.unshift(added);
  const fundCol = data.fund === 'elevator' ? 'elevatorFund' : 'generalFund';
  const tx = await fbAdd(fundCol, { type: 'expense', amount: data.amount, description: data.description || data.category, category: data.category, timestamp: Date.now() });
  if (data.fund === 'elevator') state.elevatorFund.unshift(tx); else state.generalFund.unshift(tx);
  await logAudit('add_expense', `${data.category} - ${data.amount} ج`);
  saveLocal();
  closeModal('expenseModal');
  renderExpenses();
  showToast('✅ تم الحفظ', 'success');
}

function renderExpenses() {
  const tbody = document.getElementById('expensesTableBody');
  if (!tbody) return;
  const search = document.getElementById('expSearch')?.value.toLowerCase() || '';
  const monthFilter = document.getElementById('expMonthFilter')?.value || 'all';
  let filtered = [...state.expenses];
  if (search) filtered = filtered.filter(e => (e.category||'').toLowerCase().includes(search) || (e.description||'').toLowerCase().includes(search));
  if (monthFilter !== 'all') filtered = filtered.filter(e => e.month === monthFilter);
  const total = filtered.reduce((s,e) => s + (e.amount||0), 0);
  const general = filtered.filter(e => e.fund === 'general').reduce((s,e) => s + e.amount, 0);
  const elevator = filtered.filter(e => e.fund === 'elevator').reduce((s,e) => s + e.amount, 0);
  document.getElementById('expensesStats').innerHTML = statCard('💸', total.toLocaleString(), 'إجمالي', 'red') + statCard('🏦', general.toLocaleString(), 'الصندوق العام', 'blue') + statCard('🛗', elevator.toLocaleString(), 'الأسانسير', 'orange') + statCard('📊', filtered.length, 'عدد البنود');
  tbody.innerHTML = filtered.map((e,i) => `<tr><td>${i+1}</td><td>${e.date || '-'}</td><td>${e.month} ${e.year}</td><td><strong>${e.category}</strong></td><td>${e.description || '-'}</td><td style="color:#c62828;font-weight:700;">-${e.amount} ج</td><td><span class="badge ${e.fund === 'elevator' ? 'status-blue' : 'status-orange'}">${e.fund === 'elevator' ? 'أسانسير' : 'عام'}</span></td><td><button class="icon-btn" onclick="deleteExpense('${e.id}')">🗑️</button></td></tr>`).join('') || '<tr><td colspan="8" style="text-align:center;padding:30px;color:#888;">لا توجد مصروفات</td></tr>';
}

async function deleteExpense(id) {
  if (!confirm('حذف؟')) return;
  await fbDelete('expenses', id);
  state.expenses = state.expenses.filter(e => e.id !== id);
  saveLocal();
  renderExpenses();
  showToast('✅ تم الحذف', 'success');
}

function exportExpensesExcel() {
  const data = state.expenses.map(e => ({ 'التاريخ': e.date || '', 'الشهر': e.month, 'السنة': e.year, 'البند': e.category, 'الوصف': e.description, 'المبلغ': e.amount, 'الصندوق': e.fund === 'elevator' ? 'أسانسير' : 'عام' }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Expenses');
  XLSX.writeFile(wb, 'expenses.xlsx');
}

// ==================== Category Picker ====================
function openCategoryPicker() {
  const container = document.getElementById('categoryPickerList');
  const selected = state.settings.selectedCategories || ALL_EXPENSE_CATEGORIES;
  container.innerHTML = ALL_EXPENSE_CATEGORIES.map(cat => {
    const checked = selected.includes(cat) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--bg);border-radius:6px;cursor:pointer;"><input type="checkbox" class="cat-picker-cb" value="${cat}" ${checked} style="width:18px;height:18px;accent-color:var(--primary);"><span style="font-weight:600;">${cat}</span></label>`;
  }).join('');
  openModal('categoryPickerModal');
}

function saveCategoryPicker() {
  const selected = [];
  document.querySelectorAll('.cat-picker-cb:checked').forEach(cb => selected.push(cb.value));
  state.settings.selectedCategories = selected;
  if (useFirebase) { try { db.collection('settings').doc('config').set({ selectedCategories: selected }, { merge: true }); } catch(e) {} }
  saveLocal();
  closeModal('categoryPickerModal');
  renderMatrix();
  showToast('✅ تم الحفظ', 'success');
}

// ==================== Other Incomes (OI) ====================
function openOIModal() {
  document.getElementById('oiAmount').value = '';
  document.getElementById('oiPayer').value = '';
  document.getElementById('oiNotes').value = '';
  document.getElementById('oiDate').value = new Date().toISOString().split('T')[0];
  openModal('oiModal');
}

async function saveOI() {
  const data = { source: document.getElementById('oiSource').value, payer: document.getElementById('oiPayer').value, amount: +document.getElementById('oiAmount').value || 0, month: document.getElementById('oiMonth').value, year: +document.getElementById('oiYear').value || 2026, date: document.getElementById('oiDate').value || new Date().toISOString().split('T')[0], notes: document.getElementById('oiNotes').value, timestamp: Date.now() };
  if (!data.amount) { showToast('⚠️ أدخل المبلغ', 'warning'); return; }
  const added = await fbAdd('otherIncomes', data);
  state.otherIncomes.unshift(added);
  const tx = await fbAdd('generalFund', { type: 'income', amount: data.amount, description: `${data.source} - ${data.payer}`, category: 'إيراد خارجي', timestamp: Date.now() });
  state.generalFund.unshift(tx);
  await logAudit('add_oi', `${data.source} - ${data.amount} ج`);
  saveLocal();
  closeModal('oiModal');
  renderOI();
  showToast('✅ تم الحفظ', 'success');
}

function renderOI() {
  const tbody = document.getElementById('oiTableBody');
  if (!tbody) return;
  let total = 0;
  tbody.innerHTML = state.otherIncomes.map((o,i) => {
    total += o.amount || 0;
    return `<tr><td>${i+1}</td><td>${o.date || '-'}</td><td>${o.month} ${o.year}</td><td><strong>${o.source}</strong></td><td>${o.payer || '-'}</td><td style="color:#2e7d32;font-weight:700;">+${o.amount} ج</td><td>${o.notes || '-'}</td><td><button class="icon-btn" onclick="deleteOI('${o.id}')">🗑️</button></td></tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;padding:30px;color:#888;">لا توجد إيرادات خارجية</td></tr>';
  document.getElementById('oiStats').innerHTML = statCard('💵', total.toLocaleString(), 'إجمالي الإيرادات الخارجية', 'green') + statCard('📊', state.otherIncomes.length, 'عدد المعاملات') + statCard('📅', state.otherIncomes.filter(o => o.month === state.currentMonth && o.year === state.currentYear).reduce((s,o) => s + o.amount, 0).toLocaleString(), 'إيرادات الشهر الحالي', 'blue');
}

async function deleteOI(id) {
  if (!confirm('حذف؟')) return;
  await fbDelete('otherIncomes', id);
  state.otherIncomes = state.otherIncomes.filter(o => o.id !== id);
  saveLocal();
  renderOI();
  showToast('✅ تم الحذف', 'success');
}

function exportOIExcel() {
  const data = state.otherIncomes.map(o => ({ 'التاريخ': o.date || '', 'الشهر': o.month, 'السنة': o.year, 'المصدر': o.source, 'الجهة': o.payer, 'المبلغ': o.amount, 'ملاحظات': o.notes }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'OtherIncomes');
  XLSX.writeFile(wb, 'other_incomes.xlsx');
}

// ==================== Emergency ====================
function calcEmergencySplit() {
  const total = +document.getElementById('emTotal').value || 0;
  const type = document.getElementById('emType').value;
  const preview = document.getElementById('emSplitPreview');
  if (total <= 0) { preview.classList.remove('active'); return; }
  let targets = type === 'general' ? state.units.filter(u => u.status === 'ساكنة') : state.units.filter(u => u.elevator === 'yes');
  if (targets.length === 0) { preview.innerHTML = '<p style="color:#c62828;font-weight:700;">⚠️ لا توجد وحدات</p>'; preview.classList.add('active'); return; }
  const perUnit = Math.ceil(total / targets.length);
  const actual = perUnit * targets.length;
  preview.innerHTML = `<h4>📊 معاينة التوزيع</h4><div class="split-detail"><div class="split-item"><label>الإجمالي</label><strong>${total} ج</strong></div><div class="split-item"><label>عدد الوحدات</label><strong>${targets.length} وحدة</strong></div><div class="split-item"><label>حصة الوحدة</label><strong>${perUnit} ج</strong></div><div class="split-item"><label>الإجمالي الفعلي</label><strong>${actual} ج</strong></div></div>`;
  preview.classList.add('active');
}

async function createEmergency() {
  const type = document.getElementById('emType').value;
  const category = document.getElementById('emCategory').value;
  const total = +document.getElementById('emTotal').value || 0;
  const description = document.getElementById('emDescription').value;
  const date = document.getElementById('emDate').value || new Date().toISOString().split('T')[0];
  if (!total || !description) { showToast('⚠️ أدخل الإجمالي والوصف', 'warning'); return; }
  const targets = type === 'general' ? state.units.filter(u => u.status === 'ساكنة') : state.units.filter(u => u.elevator === 'yes');
  if (targets.length === 0) { showToast('⚠️ لا توجد وحدات', 'warning'); return; }
  const perUnit = Math.ceil(total / targets.length);
  const added = await fbAdd('emergencies', { type, category, total, description, date, perUnit, targetCount: targets.length, targetUnitIds: targets.map(u => u.id), month: state.currentMonth, year: state.currentYear, timestamp: Date.now() });
  state.emergencies.unshift(added);
  for (const u of targets) { const idx = state.units.findIndex(x => x.id === u.id); if (idx >= 0) { state.units[idx]._emergencyShare = perUnit; await fbUpdate('units', u.id, { _emergencyShare: perUnit }); } }
  await logAudit('create_emergency', `${description} - ${total} ج`);
  saveLocal();
  clearEmergencyForm();
  renderEmergencyList();
  showToast(`✅ تم إنشاء الصيانة - ${perUnit} ج/وحدة`, 'success');
}

function clearEmergencyForm() {
  document.getElementById('emTotal').value = '';
  document.getElementById('emDescription').value = '';
  document.getElementById('emDate').value = '';
  document.getElementById('emSplitPreview').classList.remove('active');
}

function renderEmergencyList() {
  const tbody = document.getElementById('emergencyListBody');
  if (!tbody) return;
  tbody.innerHTML = state.emergencies.map((e, i) => {
    const tl = e.type === 'elevator' ? '🛗 أسانسير' : '🚨 عام';
    const tc = e.type === 'elevator' ? 'elevator' : 'general';
    return `<tr><td>${i+1}</td><td><span class="emergency-badge ${tc}">${tl}</span></td><td>${e.category}</td><td>${e.description}</td><td><strong style="color:var(--danger);">${e.total.toLocaleString()}</strong></td><td>${e.targetCount}</td><td><strong style="color:var(--primary);">${e.perUnit}</strong></td><td>${new Date(e.date).toLocaleDateString('ar-EG')}</td><td><button class="icon-btn" onclick="printEmergency('${e.id}')">🖨️</button><button class="icon-btn" onclick="deleteEmergency('${e.id}')">🗑️</button></td></tr>`;
  }).join('') || '<tr><td colspan="9" style="text-align:center;padding:30px;color:#888;">لا توجد صيانات طارئة</td></tr>';
}

async function deleteEmergency(id) {
  if (!confirm('حذف؟')) return;
  await fbDelete('emergencies', id);
  state.emergencies = state.emergencies.filter(e => e.id !== id);
  saveLocal();
  renderEmergencyList();
  showToast('✅ تم الحذف', 'success');
}

function printEmergency(id) {
  const e = state.emergencies.find(x => x.id === id);
  if (!e) return;
  const units = state.units.filter(u => e.targetUnitIds.includes(u.id));
  const options = getPrintOptions();
  options.statement = e.type === 'elevator' ? 'إيصال صيانة طارئة - أسانسير' : 'إيصال صيانة طارئة';
  options.note = `المبلغ الإجمالي: ${e.total} ج - ${e.description}`;
  options.overrideAmount = e.perUnit;
  options.overrideItems = [e.description, `الإجمالي: ${e.total} ج ÷ ${e.targetCount} وحدة = ${e.perUnit} ج`];
  showPreviewWithOptions(units, options);
  setTimeout(() => window.print(), 600);
}

// ==================== Funds ====================
function calcFundBalance(txs) { return txs.reduce((s,t) => s + (t.type === 'income' ? t.amount : -t.amount), 0); }

function renderFunds() {
  const isElev = state.currentFundTab === 'elevator';
  const txs = isElev ? state.elevatorFund : state.generalFund;
  document.getElementById('fundTitle').textContent = `معاملات ${isElev ? 'صندوق الأسانسير' : 'صندوق الصيانة العامة'}`;
  const inc = txs.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
  const exp = txs.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
  document.getElementById('fundsStats').innerHTML = statCard('💰', inc.toLocaleString(), 'الإيرادات', 'green') + statCard('💸', exp.toLocaleString(), 'المصروفات', 'red') + statCard('🏦', (inc-exp).toLocaleString(), 'الرصيد', inc-exp >= 0 ? 'green' : 'red');
  document.getElementById('fundTransactionsTable').innerHTML = txs.map((t,i) => `<tr><td>${i+1}</td><td>${t.timestamp ? new Date(t.timestamp).toLocaleDateString('ar-EG') : '-'}</td><td><span class="badge ${t.type === 'income' ? 'status-green' : 'status-red'}">${t.type === 'income' ? 'إيراد' : 'مصروف'}</span></td><td>${t.description}</td><td>${t.category || '-'}</td><td style="color:${t.type === 'income' ? '#2e7d32' : '#c62828'};font-weight:700;">${t.type === 'income' ? '+' : '-'}${t.amount} ج</td><td><button class="icon-btn" onclick="deleteFundTransaction('${t.id}', '${isElev ? 'elevator' : 'general'}')">🗑️</button></td></tr>`).join('') || '<tr><td colspan="7" style="text-align:center;padding:30px;color:#888;">لا توجد معاملات</td></tr>';
}

function switchFundTab(fund) {
  state.currentFundTab = fund;
  document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.fund === fund));
  renderFunds();
}

function openFundModal(type) {
  document.getElementById('fundType').value = state.currentFundTab;
  document.getElementById('fundTxType').value = type;
  document.getElementById('fundModalTitle').textContent = type === 'income' ? '💰 إضافة إيراد' : '💸 إضافة مصروف';
  document.getElementById('fundDescription').value = '';
  document.getElementById('fundAmount').value = '';
  openModal('fundModal');
}

async function saveFundTransaction() {
  const fundType = document.getElementById('fundType').value;
  const txType = document.getElementById('fundTxType').value;
  const description = document.getElementById('fundDescription').value;
  const amount = +document.getElementById('fundAmount').value || 0;
  const category = document.getElementById('fundCategory').value;
  if (!description || !amount) { showToast('⚠️ أدخل الوصف والمبلغ', 'warning'); return; }
  const tx = await fbAdd(fundType === 'elevator' ? 'elevatorFund' : 'generalFund', { type: txType, amount, description, category, timestamp: Date.now() });
  if (fundType === 'elevator') state.elevatorFund.unshift(tx); else state.generalFund.unshift(tx);
  saveLocal();
  closeModal('fundModal');
  renderFunds();
  showToast('✅ تمت الإضافة', 'success');
}

async function deleteFundTransaction(id, fundType) {
  if (!confirm('حذف؟')) return;
  await fbDelete(fundType === 'elevator' ? 'elevatorFund' : 'generalFund', id);
  if (fundType === 'elevator') state.elevatorFund = state.elevatorFund.filter(t => t.id !== id);
  else state.generalFund = state.generalFund.filter(t => t.id !== id);
  saveLocal();
  renderFunds();
  showToast('✅ تم الحذف', 'success');
}

function exportFundExcel() {
  const txs = state.currentFundTab === 'elevator' ? state.elevatorFund : state.generalFund;
  const data = txs.map(t => ({ 'التاريخ': t.timestamp ? new Date(t.timestamp).toLocaleDateString('ar-EG') : '', 'النوع': t.type === 'income' ? 'إيراد' : 'مصروف', 'الوصف': t.description, 'التصنيف': t.category, 'المبلغ': t.amount }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Fund');
  XLSX.writeFile(wb, `fund_${state.currentFundTab}.xlsx`);
}

// ==================== Debts ====================
// ==================== Debts ====================
function renderDebts() {
  const tbody = document.getElementById('debtsTableBody');
  if (!tbody) return;
  
  const filterUnit = document.getElementById('debtFilterUnit')?.value || 'all';
  
  let debts = state.debts.filter(d => d.status !== 'paid');
  if (filterUnit !== 'all') {
    debts = debts.filter(d => d.unitId === filterUnit);
  }
  
  // حساب الإحصائيات بناءً على الفلتر
  let total=0, totalPaid=0;
  debts.forEach(d => { total += d.amount||0; totalPaid += d.paid||0; });
  
  let statsHTML = statCard('📋', debts.length, 'عدد المديونيات') + 
                  statCard('💰', total.toLocaleString(), 'إجمالي', 'red') + 
                  statCard('✅', totalPaid.toLocaleString(), 'المسدد', 'green') + 
                  statCard('⚠️', (total-totalPaid).toLocaleString(), 'المتبقي', 'red');
                  
  document.getElementById('debtsStats').innerHTML = statsHTML;

  tbody.innerHTML = debts.map((d,i) => {
    const rem = (d.amount||0) - (d.paid||0);
    const monthStr = d.month ? `${d.month} ${d.year}` : (d.createdAt ? new Date(d.createdAt).toLocaleDateString('ar-EG') : '-');
    return `<tr>
      <td>${i+1}</td>
      <td><strong>${d.unitNumber||'-'}</strong></td>
      <td>${d.resident||'-'}</td>
      <td>${d.description||'-'}</td>
      <td><span class="badge ${d.type === 'elevator' ? 'status-blue' : 'status-yellow'}">${d.type === 'elevator' ? 'أسانسير' : d.type === 'other' ? 'أخرى' : 'عام'}</span></td>
      <td style="color:var(--text-light); font-size:12px;">${monthStr}</td>
      <td>${d.amount}</td>
      <td>${d.paid||0}</td>
      <td style="color:#c62828;font-weight:700;">${rem}</td>
      <td>
        <button class="icon-btn" onclick="payDebt('${d.id}')" title="سداد">💰</button>
        <button class="icon-btn" onclick="deleteDebtById('${d.id}')" title="حذف">🗑️</button>
        <button class="icon-btn" onclick="openEditDebtModal('${d.id}')" title="تعديل">✏️</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="10" style="text-align:center;padding:40px;color:#888;">لا توجد مديونيات مطابقة</td></tr>';
}

function updateDebtFilterOptions() {
  const filter = document.getElementById('debtFilterUnit');
  if (!filter) return;
  const unitsWithDebts = state.units.filter(u => 
    state.debts.some(d => d.unitId === u.id && d.status !== 'paid')
  );
  
  filter.innerHTML = '<option value="all">كل الوحدات المدينة</option>' + 
    unitsWithDebts.map(u => `<option value="${u.id}">${u.number} - ${u.resident}</option>`).join('');
}

function openDebtModal() {
  // تعبئة قائمة الوحدات
  const select = document.getElementById('debtUnitId');
  select.innerHTML = '<option value="">-- اختر --</option>' + state.units.map(u => `<option value="${u.id}">${u.number} - ${u.resident||u.type}</option>`).join('');
  
  // تعبئة الشهور
  const monthSel = document.getElementById('debtMonthSelect');
  monthSel.innerHTML = MONTHS.map(m => `<option value="${m}" ${m === state.currentMonth ? 'selected' : ''}>${m}</option>`).join('');
  document.getElementById('debtYearInput').value = state.currentYear;
  
  // تفريغ السطور وإضافة سطر واحد افتراضي
  document.getElementById('debtRowsContainer').innerHTML = '';
  addDebtRowToModal();
  
  openModal('debtModal');
}

function addDebtRowToModal() {
  const container = document.getElementById('debtRowsContainer');
  const rowId = 'debtrow_' + Date.now();
  
  const rowHTML = `
    <div id="${rowId}" style="display:grid; grid-template-columns: 1fr 1fr 2fr 2fr 40px; gap:10px; background:var(--bg); padding:10px; border-radius:8px; border:1px solid var(--border); align-items:center;">
      <div class="field" style="margin:0;">
        <label style="font-size:11px;">المبلغ</label>
        <input type="number" class="debt-row-amount" placeholder="المبلغ">
      </div>
      <div class="field" style="margin:0;">
        <label style="font-size:11px;">النوع</label>
        <select class="debt-row-type">
          <option value="general">عام</option>
          <option value="elevator">أسانسير</option>
          <option value="other">أخرى</option>
        </select>
      </div>
      <div class="field" style="margin:0;">
        <label style="font-size:11px;">الوصف</label>
        <input type="text" class="debt-row-desc" placeholder="وصف المديونية">
      </div>
      <div class="field" style="margin:0;">
        <label style="font-size:11px;">ملاحظات</label>
        <input type="text" class="debt-row-notes" placeholder="ملاحظات اختيارية">
      </div>
      <button class="icon-btn" onclick="document.getElementById('${rowId}').remove()" style="color:var(--danger); font-size:20px;" title="حذف السطر">🗑️</button>
    </div>
  `;
  container.insertAdjacentHTML('beforeend', rowHTML);
}

async function saveMultipleDebts() {
  const unitId = document.getElementById('debtUnitId').value;
  const u = state.units.find(x => x.id === unitId);
  if (!unitId || !u) { showToast('⚠️ يرجى اختيار الوحدة أولاً', 'warning'); return; }
  
  const month = document.getElementById('debtMonthSelect').value;
  const year = +document.getElementById('debtYearInput').value;
  
  const rows = document.querySelectorAll('#debtRowsContainer > div');
  if (rows.length === 0) { showToast('⚠️ أضف سطر مديونية واحد على الأقل', 'warning'); return; }
  
  let addedCount = 0;
  for (const row of rows) {
    const amount = +row.querySelector('.debt-row-amount').value;
    if (!amount) continue; // تخطي السطور الفارغة
    
    const type = row.querySelector('.debt-row-type').value;
    const description = row.querySelector('.debt-row-desc').value || 'مديونية';
    const notes = row.querySelector('.debt-row-notes').value;
    
    const d = await fbAdd('debts', { 
      unitId, unitNumber: u.number, resident: u.resident, 
      amount, paid: 0, status: 'active', 
      description, type, notes, 
      month, year, // إضافة تاريخ الاستحقاق
      createdAt: Date.now() 
    });
    state.debts.unshift(d);
    addedCount++;
  }
  
  if (addedCount > 0) {
    saveLocal();
    closeModal('debtModal');
    updateDebtFilterOptions();
    renderDebts();
    showToast(`✅ تمت إضافة ${addedCount} مديونية بنجاح`, 'success');
  } else {
    showToast('⚠️ لم يتم إدخال مبالغ صحيحة', 'warning');
  }
}

// إضافة سريعة من جدول الوحدات
function addDebtToUnit(unitId) {
  const u = state.units.find(x => x.id === unitId);
  if (!u) return;
  
  document.getElementById('quickDebtInfo').innerHTML = `
    <div><label>الوحدة</label><strong>${u.number} - ${u.floor}</strong></div>
    <div><label>الساكن</label><strong>${u.resident || '-'}</strong></div>
  `;
  
  const monthSel = document.getElementById('quickDebtMonth');
  monthSel.innerHTML = MONTHS.map(m => `<option value="${m}" ${m === state.currentMonth ? 'selected' : ''}>${m}</option>`).join('');
  document.getElementById('quickDebtYear').value = state.currentYear;
  
  document.getElementById('quickDebtAmount').value = '';
  document.getElementById('quickDebtType').value = u.elevator === 'yes' ? 'elevator' : 'general';
  document.getElementById('quickDebtDescription').value = '';
  document.getElementById('quickDebtNotes').value = '';
  
  // تخزين الآي دي مؤقتاً في المودال
  document.getElementById('quickDebtModal').dataset.unitId = unitId;
  
  openModal('quickDebtModal');
}

async function saveQuickDebt() {
  const unitId = document.getElementById('quickDebtModal').dataset.unitId;
  const u = state.units.find(x => x.id === unitId);
  if (!u) return;
  
  const amount = +document.getElementById('quickDebtAmount').value || 0;
  if (!amount) { showToast('⚠️ أدخل المبلغ', 'warning'); return; }
  
  const month = document.getElementById('quickDebtMonth').value;
  const year = +document.getElementById('quickDebtYear').value;
  const type = document.getElementById('quickDebtType').value;
  const description = document.getElementById('quickDebtDescription').value || 'مديونية';
  const notes = document.getElementById('quickDebtNotes').value;
  
  const d = await fbAdd('debts', { 
    unitId, unitNumber: u.number, resident: u.resident, 
    amount, paid: 0, status: 'active', 
    description, type, notes, 
    month, year, 
    createdAt: Date.now() 
  });
  state.debts.unshift(d);
  
  saveLocal();
  closeModal('quickDebtModal');
  updateDebtFilterOptions();
  renderDebts();
  showToast(`✅ تمت إضافة مديونية ${amount} ج على ${u.number}`, 'success');
}

async function payDebt(id) {
  const d = state.debts.find(x => x.id === id);
  if (!d) return;
  const amount = prompt('المبلغ المسدد:', (d.amount - (d.paid||0)));
  if (!amount) return;
  const paid = +(d.paid||0) + +amount;
  const status = paid >= d.amount ? 'paid' : 'active';
  d.paid = paid; d.status = status;
  await fbUpdate('debts', id, { paid, status });
  const col = d.type === 'elevator' ? 'elevatorFund' : 'generalFund';
  const tx = await fbAdd(col, { type: 'income', amount: +amount, description: `سداد مديونية - ${d.unitNumber}`, category: 'سداد', timestamp: Date.now() });
  if (d.type === 'elevator') state.elevatorFund.unshift(tx); else state.generalFund.unshift(tx);
  saveLocal();
  updateDebtFilterOptions();
  renderDebts();
  showToast('✅ تم السداد', 'success');
}

async function deleteDebtById(id) {
  if (!confirm('حذف هذه المديونية؟')) return;
  await fbDelete('debts', id);
  state.debts = state.debts.filter(d => d.id !== id);
  saveLocal();
  updateDebtFilterOptions();
  renderDebts();
  showToast('✅ تم الحذف', 'success');
}
// ==================== Edit Debt (NEW) ====================
function openEditDebtModal(id) {
  const d = state.debts.find(x => x.id === id);
  if (!d) return;
  
  const u = state.units.find(x => x.id === d.unitId);
  
  document.getElementById('editDebtId').value = d.id;
  document.getElementById('editDebtInfo').innerHTML = `
    <div><label>الوحدة</label><strong>${d.unitNumber} - ${u ? u.floor : ''}</strong></div>
    <div><label>الساكن</label><strong>${d.resident || '-'}</strong></div>
  `;
  
  document.getElementById('editDebtAmount').value = d.amount || 0;
  document.getElementById('editDebtPaid').value = d.paid || 0;
  document.getElementById('editDebtType').value = d.type || 'general';
  document.getElementById('editDebtStatus').value = d.status === 'paid' ? 'paid' : 'active';
  document.getElementById('editDebtDescription').value = d.description || '';
  document.getElementById('editDebtNotes').value = d.notes || '';
  
  // تعبئة الشهور
  const monthSel = document.getElementById('editDebtMonth');
  monthSel.innerHTML = MONTHS.map(m => `<option value="${m}">${m}</option>`).join('');
  monthSel.value = d.month || state.currentMonth;
  document.getElementById('editDebtYear').value = d.year || state.currentYear;
  
  openModal('editDebtModal');
}

async function submitEditDebt() {
  const id = document.getElementById('editDebtId').value;
  const d = state.debts.find(x => x.id === id);
  if (!d) return;
  
  const newAmount = +document.getElementById('editDebtAmount').value || 0;
  const newPaid = +document.getElementById('editDebtPaid').value || 0;
  const newType = document.getElementById('editDebtType').value;
  const newStatus = document.getElementById('editDebtStatus').value;
  const newDesc = document.getElementById('editDebtDescription').value;
  const newNotes = document.getElementById('editDebtNotes').value;
  const newMonth = document.getElementById('editDebtMonth').value;
  const newYear = +document.getElementById('editDebtYear').value;
  
  if (!newAmount) { showToast('⚠️ أدخل المبلغ', 'warning'); return; }
  
  // تحديث البيانات محلياً
  d.amount = newAmount;
  d.paid = newPaid;
  d.type = newType;
  d.status = newStatus;
  d.description = newDesc;
  d.notes = newNotes;
  d.month = newMonth;
  d.year = newYear;
  
  // الحفظ في Firebase
  await fbUpdate('debts', id, { 
    amount: newAmount, 
    paid: newPaid, 
    type: newType, 
    status: newStatus,
    description: newDesc,
    notes: newNotes,
    month: newMonth,
    year: newYear
  });
  
  saveLocal();
  closeModal('editDebtModal');
  updateDebtFilterOptions();
  renderDebts();
  showToast('✅ تم تعديل المديونية بنجاح', 'success');
}
function exportDebtsExcel() {
  const data = state.debts.filter(d => d.status !== 'paid').map(d => ({ 
    'الشقة': d.unitNumber, 
    'الاسم': d.resident, 
    'الوصف': d.description, 
    'النوع': d.type === 'elevator' ? 'أسانسير' : 'عام', 
    'شهر الاستحقاق': d.month || '-',
    'السنة': d.year || '-',
    'المبلغ': d.amount, 
    'المدفوع': d.paid||0, 
    'المتبقي': d.amount-(d.paid||0) 
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Debts');
  XLSX.writeFile(wb, 'debts.xlsx');
}
// ==================== Elevator Codes ====================
function renderCodes() {
  const tbody = document.getElementById('codesTableBody');
  if (!tbody) return;
  tbody.innerHTML = state.codes.map((c,i) => {
    const u = state.units.find(x => x.id === c.unitId);
    const statusLabel = c.status === 'active' ? 'نشطة' : (c.status === 'suspended' ? 'موقوفة' : 'مفقودة');
    const statusCls = c.status === 'active' ? 'status-green' : 'status-red';
    return `<tr><td>${i+1}</td><td>${u ? u.number : c.unitNumber||'-'}</td><td>${u ? u.resident : c.resident||'-'}</td><td><strong style="color:var(--primary);font-family:monospace;font-size:16px;">${c.code}</strong></td><td>${c.createdAt ? new Date(c.createdAt).toLocaleDateString('ar-EG') : '-'}</td><td><span class="badge ${statusCls}">${statusLabel}</span></td><td>${c.notes || '-'}</td><td><button class="icon-btn" onclick="openCodeModalById('${c.id}')">✏️</button><button class="icon-btn" onclick="toggleCodeStatus('${c.id}')">${c.status === 'active' ? '⛔' : '▶️'}</button><button class="icon-btn" onclick="deleteCode('${c.id}')">🗑️</button></td></tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;padding:40px;color:#888;">لا توجد شفرات</td></tr>';
}

function openCodeModalById(id) {
  openModal('codeModal');
  setTimeout(() => {
    const select = document.getElementById('codeUnitId');
    select.innerHTML = state.units.map(u => `<option value="${u.id}">${u.number} - ${u.resident||u.type}</option>`).join('');
    const c = state.codes.find(x => x.id === id);
    if (!c) return;
    document.getElementById('codeModalTitle').textContent = 'تعديل شفرة';
    document.getElementById('codeId').value = id;
    document.getElementById('codeUnitId').value = c.unitId;
    document.getElementById('codeValue').value = c.code;
    document.getElementById('codeStatus').value = c.status;
    document.getElementById('codeNotes').value = c.notes || '';
  }, 100);
}

function openCodeModalNew() {
  openModal('codeModal');
  setTimeout(() => {
    const select = document.getElementById('codeUnitId');
    select.innerHTML = state.units.map(u => `<option value="${u.id}">${u.number} - ${u.resident||u.type}</option>`).join('');
    document.getElementById('codeModalTitle').textContent = 'إضافة شفرة';
    document.getElementById('codeId').value = '';
    document.getElementById('codeValue').value = '';
    document.getElementById('codeStatus').value = 'active';
    document.getElementById('codeNotes').value = '';
  }, 100);
}

async function saveCode() {
  const id = document.getElementById('codeId').value;
  const unitId = document.getElementById('codeUnitId').value;
  const u = state.units.find(x => x.id === unitId);
  const data = { unitId, unitNumber: u?.number, resident: u?.resident, code: document.getElementById('codeValue').value, status: document.getElementById('codeStatus').value, notes: document.getElementById('codeNotes').value };
  if (!data.code) { showToast('⚠️ أدخل رقم الشفرة', 'warning'); return; }
  if (id) { const idx = state.codes.findIndex(x => x.id === id); if (idx >= 0) state.codes[idx] = { ...state.codes[idx], ...data }; await fbUpdate('codes', id, data); }
  else { data.createdAt = Date.now(); const c = await fbAdd('codes', data); state.codes.unshift(c); }
  saveLocal();
  closeModal('codeModal');
  renderCodes();
  showToast('✅ تم الحفظ', 'success');
}

async function toggleCodeStatus(id) {
  const c = state.codes.find(x => x.id === id);
  if (!c) return;
  const ns = c.status === 'active' ? 'suspended' : 'active';
  c.status = ns;
  await fbUpdate('codes', id, { status: ns });
  saveLocal();
  renderCodes();
}

async function deleteCode(id) {
  if (!confirm('حذف الشفرة؟')) return;
  await fbDelete('codes', id);
  state.codes = state.codes.filter(c => c.id !== id);
  saveLocal();
  renderCodes();
  showToast('✅ تم الحذف', 'success');
}

function filterCodes() {
  const s = document.getElementById('codeSearch').value.toLowerCase();
  document.querySelectorAll('#codesTableBody tr').forEach(r => { r.style.display = r.textContent.toLowerCase().includes(s) ? '' : 'none'; });
}

function exportCodesExcel() {
  const data = state.codes.map(c => { const u = state.units.find(x => x.id === c.unitId); return { 'الوحدة': u?.number || '', 'الساكن': u?.resident || '', 'الشفرة': c.code, 'الحالة': c.status === 'active' ? 'نشطة' : 'موقوفة', 'ملاحظات': c.notes }; });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Codes');
  XLSX.writeFile(wb, 'elevator_codes.xlsx');
}

// ==================== Heatmap ====================
function renderHeatmap() {
  const container = document.getElementById('heatmapContainer');
  if (!container) return;
  const floors = ['البدروم','الأول','الثانى','الثالث','الرابع','الخامس','السادس','السابع','الثامن','التاسع','العاشر','الحادى عشر','الثانى عشر','الثالث عشر'];
  const monthPayments = state.payments.filter(p => p.month === state.currentMonth && p.year === state.currentYear);
  let html = '';
  floors.forEach(floor => {
    const units = state.units.filter(u => u.floor === floor);
    if (units.length === 0) return;
    html += `<div style="background:var(--bg);padding:12px;border-radius:8px;border:2px solid var(--border);margin-bottom:8px;"><h5 style="text-align:center;color:var(--primary);margin-bottom:8px;font-size:13px;">${floor}</h5><div style="display:flex;gap:6px;justify-content:center;">`;
    units.forEach(u => {
      const fee = getFeeForMonth(u, state.currentMonth, state.currentYear);
      const paid = monthPayments.filter(p => p.unitId === u.id).reduce((s,p) => s + p.amount, 0);
      let bg = 'linear-gradient(135deg,#757575,#424242)';
      if (u.status === 'ساكنة') { bg = u.type === 'مستأجر' ? 'linear-gradient(135deg,#1565c0,#0d47a1)' : 'linear-gradient(135deg,#2e7d32,#1b5e20)'; if (paid < fee && fee > 0) bg = 'linear-gradient(135deg,#c62828,#b71c1c)'; }
      html += `<div onclick="openUnitModal('${u.id}')" title="${u.resident || '-'} - ${u.type} - ${u.status} - ${fee} ج" style="width:50px;height:50px;border-radius:8px;background:${bg};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;color:#fff;cursor:pointer;transition:.2s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">${u.number}</div>`;
    });
    html += '</div></div>';
  });
  container.innerHTML = `<div style="max-width:500px;margin:0 auto;">${html}</div>`;
}

// ==================== Unit Modal & Save ====================
function openUnitModal(id) {
  document.getElementById('unitModal').classList.add('open');
  if (id) {
    const u = state.units.find(x => x.id === id);
    if (!u) return;
    document.getElementById('unitModalTitle').textContent = 'تعديل وحدة - ' + u.number;
    document.getElementById('unitId').value = u.id;
    document.getElementById('unitFloor').value = u.floor || '';
    document.getElementById('unitNumber').value = u.number || '';
    document.getElementById('unitLocation').value = u.location || '';
    document.getElementById('unitResident').value = u.resident || '';
    document.getElementById('unitStatus').value = u.status || 'ساكنة';
    document.getElementById('unitType').value = u.type || 'مالك';
    document.getElementById('unitElevator').value = u.elevator || 'no';
    document.getElementById('unitPhone1').value = (u.phones||[])[0] || '';
    document.getElementById('unitPhone2').value = (u.phones||[])[1] || '';
    document.getElementById('unitPaymentMethod').value = u.paymentMethod || '';
    document.getElementById('unitOpeningBalance').value = u.openingBalance || 0;
    document.getElementById('unitNotes').value = u.notes || '';
    document.getElementById('deleteUnitBtn').style.display = 'inline-block';
    renderFeeHistoryTimeline(u);
  } else {
    document.getElementById('unitModalTitle').textContent = 'إضافة وحدة';
    document.getElementById('unitId').value = '';
    ['unitFloor','unitNumber','unitLocation','unitResident','unitPhone1','unitPhone2','unitNotes'].forEach(x => document.getElementById(x).value = '');
    document.getElementById('unitStatus').value = 'ساكنة';
    document.getElementById('unitType').value = 'مالك';
    document.getElementById('unitElevator').value = 'no';
    document.getElementById('unitPaymentMethod').value = '';
    document.getElementById('unitOpeningBalance').value = 0;
    document.getElementById('deleteUnitBtn').style.display = 'none';
    document.getElementById('feeHistoryTimeline').innerHTML = '<p style="color:var(--text-light);font-size:12px;">سيُسجَّل أول تغيير عند حفظ الوحدة</p>';
  }
  updateUnitAmount();
}

function updateUnitAmount() {
  const data = { status: document.getElementById('unitStatus').value, type: document.getElementById('unitType').value, elevator: document.getElementById('unitElevator').value };
  document.getElementById('unitAmount').value = calcFee(data, state.settings);
}

function renderFeeHistoryTimeline(u) {
  const container = document.getElementById('feeHistoryTimeline');
  if (!container) return;
  if (!u.feeHistory || u.feeHistory.length === 0) {
    container.innerHTML = '<p style="color:var(--text-light);font-size:12px;">لا توجد سجلات</p>';
    return;
  }
  const sorted = [...u.feeHistory].sort((a, b) => b.from.localeCompare(a.from));
  container.innerHTML = sorted.map(e => {
    const [year, month] = e.from.split('-');
    const monthName = MONTHS[parseInt(month) - 1];
    return `<div class="fee-history-item">
      <span class="from-month">📅 من ${monthName} ${year}</span>
      <span class="fee-value">${e.fee} ج</span>
      <span class="state-label">${getStateLabel(e.from, u)}</span>
      <button class="delete-btn" onclick="deleteFeeHistory('${u.id}', '${e.from}')">🗑️</button>
    </div>`;
  }).join('');
}

async function deleteFeeHistory(unitId, fromKey) {
  if (!confirm('حذف هذا السجل؟')) return;
  const u = state.units.find(x => x.id === unitId);
  if (!u) return;
  if (u.feeHistory.length <= 1) { showToast('⚠️ لا يمكن حذف السجل الأخير', 'warning'); return; }
  u.feeHistory = u.feeHistory.filter(e => e.from !== fromKey);
  if (u.stateHistory) u.stateHistory = u.stateHistory.filter(e => e.from !== fromKey);
  await fbUpdate('units', unitId, { feeHistory: u.feeHistory, stateHistory: u.stateHistory });
  saveLocal();
  renderFeeHistoryTimeline(u);
  renderUnits();
  showToast('✅ تم الحذف', 'success');
}

async function saveUnit() {
  const id = document.getElementById('unitId').value;
  const phones = [document.getElementById('unitPhone1').value, document.getElementById('unitPhone2').value].filter(Boolean);
  const newState = {
    floor: document.getElementById('unitFloor').value,
    number: document.getElementById('unitNumber').value,
    location: document.getElementById('unitLocation').value,
    resident: document.getElementById('unitResident').value,
    status: document.getElementById('unitStatus').value,
    type: document.getElementById('unitType').value,
    elevator: document.getElementById('unitElevator').value,
    phones,
    paymentMethod: document.getElementById('unitPaymentMethod').value,
    openingBalance: +document.getElementById('unitOpeningBalance').value || 0,
    notes: document.getElementById('unitNotes').value
  };
  
  if (id) {
    const idx = state.units.findIndex(x => x.id === id);
    const oldUnit = state.units[idx];
    const stateChanged = 
      oldUnit.status !== newState.status ||
      oldUnit.type !== newState.type ||
      oldUnit.elevator !== newState.elevator ||
      oldUnit.resident !== newState.resident;
    
    if (stateChanged) {
      if (!oldUnit.feeHistory) oldUnit.feeHistory = [{ from: '2026-01', fee: oldUnit.amount || 0 }];
      if (!oldUnit.stateHistory) oldUnit.stateHistory = [{ from: '2026-01', status: oldUnit.status, type: oldUnit.type, elevator: oldUnit.elevator, resident: oldUnit.resident, fee: oldUnit.amount || 0 }];
      recordFeeChange(oldUnit, state.currentMonth, state.currentYear, newState);
      showToast(`✅ سيُطبَّق التغيير من ${state.currentMonth} ${state.currentYear} (بدون أثر رجعي)`, 'info');
    }
    
    const merged = { ...oldUnit, ...newState };
    merged.feeHistory = oldUnit.feeHistory;
    merged.stateHistory = oldUnit.stateHistory;
    merged.amount = getFeeForMonth(merged, state.currentMonth, state.currentYear);
    
    state.units[idx] = merged;
    await fbUpdate('units', id, { ...newState, feeHistory: merged.feeHistory, stateHistory: merged.stateHistory, amount: merged.amount });
    await logAudit('update_unit', `تعديل ${newState.number}${stateChanged ? ' - تغيير حالة' : ''}`);
    showToast('✅ تم التحديث', 'success');
  } else {
    newState.sortOrder = state.units.length + 1;
    newState.feeHistory = [{ from: `2026-01`, fee: calcFee(newState, state.settings) }];
    newState.stateHistory = [{ from: `2026-01`, status: newState.status, type: newState.type, elevator: newState.elevator, resident: newState.resident, fee: calcFee(newState, state.settings) }];
    newState.amount = calcFee(newState, state.settings);
    const added = await fbAdd('units', newState);
    state.units.push(added);
    await logAudit('add_unit', `إضافة ${newState.number}`);
    showToast('✅ تمت الإضافة', 'success');
  }
  saveLocal();
  closeModal('unitModal');
  renderUnits();
}

async function deleteUnitFromModal() {
  const id = document.getElementById('unitId').value;
  if (!id || !confirm('حذف الوحدة؟')) return;
  await fbDelete('units', id);
  state.units = state.units.filter(u => u.id !== id);
  state.selectedIds.delete(id);
  saveLocal();
  closeModal('unitModal');
  renderUnits();
  showToast('✅ تم الحذف', 'success');
}

async function generateUnits() {
  if (!confirm('سيتم توليد الوحدات؟')) return;
  const floors = ['الأول','الثانى','الثالث','الرابع','الخامس','السادس','السابع','الثامن','التاسع','العاشر','الحادى عشر','الثانى عشر','الثالث عشر'];
  const newUnits = [];
  let sortOrder = 1;
  if (state.settings.hasBasement) newUnits.push({ sortOrder: sortOrder++, floor: 'البدروم', number: '0', location: '', resident: '', status: 'مغلقة', type: 'مغلق', elevator: 'no', phones: [], notes: '' });
  for (let f = 0; f < state.settings.floorsCount; f++) {
    for (let u = 1; u <= state.settings.unitsPerFloor; u++) {
      newUnits.push({ sortOrder: sortOrder++, floor: floors[f] || `الدور ${f+1}`, number: `${f+1}0${u}`, location: u === 1 ? 'يمين السلم' : 'يسار السلم', resident: '', status: 'مغلقة', type: 'مغلق', elevator: 'no', phones: [], notes: '' });
    }
  }
  for (const u of newUnits) {
    u.feeHistory = [{ from: '2026-01', fee: calcFee(u, state.settings) }];
    u.stateHistory = [{ from: '2026-01', status: u.status, type: u.type, elevator: u.elevator, resident: u.resident, fee: calcFee(u, state.settings) }];
    u.amount = calcFee(u, state.settings);
    const added = await fbAdd('units', u);
    state.units.push(added);
  }
  saveLocal();
  renderUnits();
  showToast(`✅ تم توليد ${newUnits.length} وحدة`, 'success');
}

async function deleteAllUnits() {
  if (!confirm('⚠️ حذف جميع الوحدات؟')) return;
  if (!confirm('⚠️ تأكيد أخير!')) return;
  for (const u of state.units) await fbDelete('units', u.id);
  state.units = [];
  saveLocal();
  renderUnits();
  showToast('✅ تم الحذف', 'success');
}

// ==================== Payment ====================
function openPaymentModal(unitId) {
  const u = state.units.find(x => x.id === unitId);
  if (!u) return;
  const paid = getPaymentForUnit(unitId, state.currentMonth, state.currentYear);
  const required = getFeeForMonth(u, state.currentMonth, state.currentYear);
  const remaining = Math.max(0, required - paid);
  document.getElementById('payUnitId').value = unitId;
  document.getElementById('payRequired').value = required;
  document.getElementById('payAmount').value = remaining || required;
  document.getElementById('payMethod').value = u.paymentMethod || 'Chash';
  document.getElementById('payNotes').value = '';
  document.getElementById('paymentInfo').innerHTML = `
    <div><label>الوحدة</label><strong>${u.number} - ${u.floor}</strong></div>
    <div><label>الاسم</label><strong>${u.resident || '-'}</strong></div>
    <div><label>الحالة الحالية</label><strong>${u.status} / ${u.type}</strong></div>
    <div><label>أسانسير</label><strong>${u.elevator === 'yes' ? 'نعم' : 'لا'}</strong></div>
    <div><label>المطلوب لشهر ${state.currentMonth}</label><strong style="color:var(--primary);">${required}</strong></div>
    <div><label>مدفوع سابق</label><strong style="color:var(--success);">${paid}</strong></div>`;
  updatePaySummary();
  openModal('paymentModal');
}

function updatePaySummary() {
  const req = +document.getElementById('payRequired').value || 0;
  const paying = +document.getElementById('payAmount').value || 0;
  const rem = Math.max(0, req - paying);
  const box = document.getElementById('paymentSummaryBox');
  if (rem > 0 && paying > 0) box.innerHTML = `<div class="alert warning">⚠️ دفع جزئي - سيتم ترحيل <strong>${rem}</strong> ج كمديونية</div>`;
  else if (paying >= req && req > 0) box.innerHTML = `<div class="alert success">✅ دفع كامل</div>`;
  else box.innerHTML = '';
}

async function submitPayment() {
  const unitId = document.getElementById('payUnitId').value;
  const u = state.units.find(x => x.id === unitId);
  if (!u) return;
  const amount = +document.getElementById('payAmount').value || 0;
  const required = +document.getElementById('payRequired').value || 0;
  const method = document.getElementById('payMethod').value;
  const notes = document.getElementById('payNotes').value;
  const remaining = Math.max(0, required - amount);
  
  const p = await fbAdd('payments', {
    unitId, unitNumber: u.number, resident: u.resident,
    amount, required, remaining,
    month: state.currentMonth, year: state.currentYear,
    method, notes, subtab: state.currentSubTab, timestamp: Date.now()
  });
  state.payments.unshift(p);
  
  if (remaining > 0) {
    const d = await fbAdd('debts', {
      unitId, unitNumber: u.number, resident: u.resident,
      amount: remaining, paid: 0, status: 'active',
      description: `فرق صيانة ${state.currentMonth} ${state.currentYear}`,
      type: u.elevator === 'yes' ? 'elevator' : 'general',
      notes: 'ترحيل تلقائي', auto: true, createdAt: Date.now()
    });
    state.debts.unshift(d);
  }
  
  if (amount > 0) {
    if (u.elevator === 'yes') {
      const ep = Math.round(amount * 0.4);
      const gp = amount - ep;
      if (ep > 0) { const e = await fbAdd('elevatorFund', { type: 'income', amount: ep, description: `اشتراك - ${u.number}`, category: 'اشتراك', unitId, timestamp: Date.now() }); state.elevatorFund.unshift(e); }
      if (gp > 0) { const g = await fbAdd('generalFund', { type: 'income', amount: gp, description: `اشتراك - ${u.number}`, category: 'اشتراك', unitId, timestamp: Date.now() }); state.generalFund.unshift(g); }
    } else {
      const g = await fbAdd('generalFund', { type: 'income', amount, description: `اشتراك - ${u.number}`, category: 'اشتراك', unitId, timestamp: Date.now() });
      state.generalFund.unshift(g);
    }
  }
  
  await logAudit('add_payment', `دفعة ${amount} ج - ${u.number}`);
  saveLocal();
  closeModal('paymentModal');
  renderUnits();
  showToast('✅ تم تسجيل الدفعة', 'success');
}

// ==================== Settings ====================
function openSettings() {
  const s = state.settings;
  document.getElementById('setBuildingName').value = s.buildingName || '';
  document.getElementById('setBuildingAddress').value = s.buildingAddress || '';
  document.getElementById('setFloorsCount').value = s.floorsCount || 13;
  document.getElementById('setUnitsPerFloor').value = s.unitsPerFloor || 2;
  document.getElementById('setFeeOwnerElevator').value = s.feeOwnerElevator || 170;
  document.getElementById('setFeeOwnerNoElevator').value = s.feeOwnerNoElevator || 150;
  document.getElementById('setFeeTenant').value = s.feeTenant || 220;
  document.getElementById('setFeeClosed').value = s.feeClosed || 75;
  document.getElementById('setCarryOver').value = s.carryOver || 0;
  openModal('settingsModal');
}

async function saveSettings() {
  const ns = {
    buildingName: document.getElementById('setBuildingName').value,
    buildingAddress: document.getElementById('setBuildingAddress').value,
    floorsCount: +document.getElementById('setFloorsCount').value || 13,
    unitsPerFloor: +document.getElementById('setUnitsPerFloor').value || 2,
    feeOwnerElevator: +document.getElementById('setFeeOwnerElevator').value || 170,
    feeOwnerNoElevator: +document.getElementById('setFeeOwnerNoElevator').value || 150,
    feeTenant: +document.getElementById('setFeeTenant').value || 220,
    feeClosed: +document.getElementById('setFeeClosed').value || 75,
    carryOver: +document.getElementById('setCarryOver').value || 0
  };
  state.settings = { ...state.settings, ...ns };
  document.getElementById('feeOwnerElevator').value = ns.feeOwnerElevator;
  document.getElementById('feeOwnerNoElevator').value = ns.feeOwnerNoElevator;
  document.getElementById('feeTenant').value = ns.feeTenant;
  document.getElementById('feeClosed').value = ns.feeClosed;
  if (useFirebase) { try { await db.collection('settings').doc('config').set(ns, { merge: true }); } catch(e) {} }
  saveLocal();
  updateBrandUI();
  closeModal('settingsModal');
  renderDashboard();
  showToast('✅ تم حفظ الإعدادات', 'success');
}

function saveFees() {
  const f = {
    feeOwnerElevator: +document.getElementById('feeOwnerElevator').value || 170,
    feeOwnerNoElevator: +document.getElementById('feeOwnerNoElevator').value || 150,
    feeTenant: +document.getElementById('feeTenant').value || 220,
    feeClosed: +document.getElementById('feeClosed').value || 75
  };
  state.settings = { ...state.settings, ...f };
  saveLocal();
  renderUnits();
}

function updateBrandUI() {
  document.getElementById('brandName').textContent = `🏢 ${state.settings.buildingName}`;
  document.getElementById('brandAddress').textContent = state.settings.buildingAddress;
}

// ==================== Print Receipts ====================
function buildReceiptHTML(unit, options) {
  const s = state.settings;
  const month = options.month || state.currentMonth;
  const year = options.year || state.currentYear;
  const statement = options.statement || 'إيصال الصيانة الشهرية';
  const note = options.note || '';
  const today = new Date().toLocaleDateString('ar-EG');
  const amount = options.overrideAmount || getFeeForMonth(unit, month, year);
  let items = options.overrideItems || (document.getElementById('receiptItems')?.value || '').split('\n').filter(l => l.trim() !== '');
  if (unit.elevator === 'no' && !options.overrideItems) items = items.filter(it => !it.includes('اسانسير') && !it.includes('أسانسير') && !it.includes('المصعد'));
  if (items.length === 0) items = ['قيمة الخدمة المطلوبة'];
  let itemsHtml = '<div class="r-statement-items">';
  items.forEach(it => itemsHtml += `<span class="item">${it.trim()}</span>`);
  if (note.trim() !== '') itemsHtml += `<span class="note">${note.trim()}</span>`;
  itemsHtml += '</div>';
  const monthIdx = MONTHS.indexOf(month) + 1;
  const stateLabel = getStateLabel(`${year}-${String(monthIdx).padStart(2,'0')}`, unit) || `${unit.status} / ${unit.type}`;
  return `
    <div class="receipt-print">
      <div class="r-header">
        <div class="r-building">🏢 ${s.buildingName}</div>
        <div class="r-address">${s.buildingAddress}</div>
        <div class="r-receipt-type">${statement}</div>
      </div>
      <div class="r-body">
        <div class="r-row"><span class="r-label">📅 شهر:</span><span class="r-value">${month}</span><span class="r-label">🗓️ عام:</span><span class="r-value">${year} م</span></div>
        <div class="r-row"><span class="r-label">🏠 الدور:</span><span class="r-value" style="font-size:13px;font-weight:600;">${unit.floor}</span><span class="r-label">📌 الشقة:</span><span class="r-value" style="font-size:13px;font-weight:600;">${unit.number}</span></div>
        <div class="r-row"><span class="r-label">👤 وصلني من السيد:</span><span class="r-value" style="font-size:14px;font-weight:700;color:#1a3a5c;">${unit.resident || '-'}</span></div>
        <div class="r-row"><span class="r-label">🏷️ الحالة في هذا الشهر:</span><span class="r-value" style="font-size:12px;font-weight:600;">${stateLabel}</span></div>
        <div class="r-row"><span class="r-label">💳 طريقة الدفع:</span><span class="r-value" style="font-size:12px;font-weight:600;">${unit.paymentMethod || '—'}</span></div>
        <div class="r-amount">💰 ${amount} جنيهاً لا غير</div>
        <div class="r-statement">📋 ${statement}</div>
        ${itemsHtml}
        ${unit.notes ? `<div style="font-size:10px;color:#555;margin-top:3px;border-top:1px dashed #ddd;padding-top:3px;">📝 ${unit.notes}</div>` : ''}
        <div class="r-row" style="border:none;margin-top:4px;"><span class="r-label">📆 تحريراً في:</span><span class="r-value">${today}</span></div>
      </div>
      <div class="r-footer"><span class="r-owner">🏢 ${s.buildingName}</span></div>
      <div class="r-id">#${unit.id} - ${unit.number}</div>
    </div>`;
}

function getPrintOptions() {
  return {
    statement: document.getElementById('receiptStatement')?.value || 'إيصال الصيانة الشهرية',
    note: document.getElementById('receiptNote')?.value || '',
    month: state.currentMonth,
    year: state.currentYear
  };
}

function getSelectedUnits() {
  let result = state.selectedIds.size > 0 ? state.units.filter(u => state.selectedIds.has(u.id)) : state.units.filter(u => u.status === 'ساكنة');
  const f = document.getElementById('printFilterSelect')?.value || 'all';
  if (f === 'living') result = result.filter(u => u.status === 'ساكنة');
  else if (f === 'closed') result = result.filter(u => u.status === 'مغلقة');
  else if (f === 'owners') result = result.filter(u => u.type === 'مالك');
  else if (f === 'tenants') result = result.filter(u => u.type === 'مستأجر');
  else if (f === 'elevator_yes') result = result.filter(u => u.elevator === 'yes');
  else if (f === 'elevator_no') result = result.filter(u => u.elevator === 'no');
  else if (f === 'unpaid') result = result.filter(u => getPaymentForUnit(u.id, state.currentMonth, state.currentYear) < getFeeForMonth(u, state.currentMonth, state.currentYear));
  return result;
}

function showPreview(units, options) {
  const cols = +document.getElementById('colsPerPage').value || 3;
  const opts = options || getPrintOptions();
  let html = `<div class="receipt-grid cols-${cols}">`;
  units.forEach(u => html += buildReceiptHTML(u, opts));
  html += '</div>';
  document.getElementById('previewContent').innerHTML = html;
  document.getElementById('printPreviewOverlay').classList.add('open');
}

function showPreviewWithOptions(units, options) {
  const cols = +document.getElementById('colsPerPage').value || 3;
  let html = `<div class="receipt-grid cols-${cols}">`;
  units.forEach(u => html += buildReceiptHTML(u, options));
  html += '</div>';
  document.getElementById('previewContent').innerHTML = html;
  document.getElementById('printPreviewOverlay').classList.add('open');
}

function previewSelected() {
  const units = getSelectedUnits();
  if (units.length === 0) { showToast('⚠️ لا توجد وحدات', 'warning'); return; }
  showPreview(units, getPrintOptions());
}

function printSelected() {
  const units = getSelectedUnits();
  if (units.length === 0) { showToast('⚠️ لا توجد وحدات', 'warning'); return; }
  showPreview(units, getPrintOptions());
  setTimeout(() => window.print(), 600);
}

function printSingle(id) {
  const u = state.units.find(x => x.id === id);
  if (!u) return;
  showPreview([u], getPrintOptions());
  setTimeout(() => window.print(), 600);
}

function closePreview() { document.getElementById('printPreviewOverlay').classList.remove('open'); }
function printPreview() { window.print(); }

function exportUnitsExcel() {
  const data = state.units.map((u,i) => ({
    'م': i+1, 'الدور': u.floor, 'الشقة': u.number, 'المكان': u.location,
    'الساكن': u.resident, 'الحالة': u.status, 'النوع': u.type,
    'أسانسير': u.elevator === 'yes' ? 'نعم' : 'لا', 'المبلغ الحالي': getFeeForMonth(u, state.currentMonth, state.currentYear),
    'الهاتف': (u.phones||[]).join(' - '), 'ملاحظات': u.notes
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Units');
  XLSX.writeFile(wb, 'units.xlsx');
}

// ==================== Reports ====================
function showReport(type) {
  const out = document.getElementById('reportOutput');
  let html = '';
  if (type === 'monthly') html = genMonthlyReport();
  else if (type === 'yearly') html = genYearlyReport();
  else if (type === 'yoy') html = genYoYReport();
  else if (type === 'debts') html = genDebtsReport();
  else if (type === 'generalFund') html = genFundReport('general');
  else if (type === 'elevatorFund') html = genFundReport('elevator');
  else if (type === 'emergency') html = genEmergencyReport();
  else if (type === 'expenses') html = genExpensesReport();
  out.innerHTML = `<div class="report-header"><h3>📊 التقرير</h3><div>
    <button class="btn-green" onclick="printReportContent()">🖨️ طباعة</button>
    <button class="btn-primary" onclick="exportReportExcel()">📊 Excel</button>
  </div></div>${html}`;
  if (type === 'yoy') setTimeout(drawYoYChart, 200);
}

function genMonthlyReport() {
  const units = state.units.filter(u => u.status === 'ساكنة');
  const payments = state.payments.filter(p => p.month === state.currentMonth && p.year === state.currentYear);
  let html = '<table class="report-table"><thead><tr><th>#</th><th>الشقة</th><th>الاسم</th><th>المطلوب</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>';
  let tr=0, tp=0;
  units.forEach((u,i) => {
    const paid = payments.filter(p => p.unitId === u.id).reduce((s,p) => s + p.amount, 0);
    const req = getFeeForMonth(u, state.currentMonth, state.currentYear);
    tr += req; tp += paid;
    const st = paid === 0 ? 'لم يدفع' : (paid < req ? 'جزئي' : 'مدفوع');
    const cls = paid === 0 ? 'status-red' : (paid < req ? 'status-yellow' : 'status-green');
    html += `<tr><td>${i+1}</td><td>${u.number}</td><td>${u.resident}</td><td>${req}</td><td>${paid}</td><td>${Math.max(0, req-paid)}</td><td><span class="badge ${cls}">${st}</span></td></tr>`;
  });
  html += `</tbody></table><div class="report-totals"><span>المطلوب: <strong>${tr}</strong></span><span>المحصل: <strong style="color:#2e7d32;">${tp}</strong></span><span>المتبقي: <strong style="color:#c62828;">${tr-tp}</strong></span></div>`;
  return html;
}

function genYearlyReport() {
  let html = '<table class="report-table" style="font-size:11px;"><thead><tr><th>الشقة</th><th>الاسم</th>' + MONTHS.map(m => `<th>${m}</th>`).join('') + '<th>الإجمالي</th></tr></thead><tbody>';
  state.units.filter(u => u.status === 'ساكنة').forEach(u => {
    let total = 0;
    const cells = MONTHS.map(m => {
      const p = state.payments.filter(x => x.unitId === u.id && x.month === m && x.year === state.currentYear).reduce((s,x) => s + x.amount, 0);
      total += p;
      return `<td>${p || '-'}</td>`;
    }).join('');
    html += `<tr><td>${u.number}</td><td>${u.resident}</td>${cells}<td><strong>${total}</strong></td></tr>`;
  });
  return html + '</tbody></table>';
}

function genYoYReport() {
  const years = new Set();
  state.payments.forEach(p => p.year && years.add(p.year));
  state.expenses.forEach(e => e.year && years.add(e.year));
  state.otherIncomes.forEach(o => o.year && years.add(o.year));
  years.add(state.currentYear);
  const sortedYears = [...years].sort();
  let html = '<div class="chart-container"><canvas id="yoyChartCanvas"></canvas></div>';
  html += '<table class="report-table"><thead><tr><th>السنة</th><th>الإيرادات</th><th>المصروفات</th><th>المتبقي</th></tr></thead><tbody>';
  let totalInc = 0, totalExp = 0;
  const chartData = { years: [], inc: [], exp: [] };
  sortedYears.forEach(y => {
    const inc = state.payments.filter(p => p.year === y).reduce((s,p) => s + p.amount, 0) + state.otherIncomes.filter(o => o.year === y).reduce((s,o) => s + o.amount, 0);
    const exp = state.expenses.filter(e => e.year === y).reduce((s,e) => s + e.amount, 0);
    const diff = inc - exp;
    totalInc += inc; totalExp += exp;
    chartData.years.push(y); chartData.inc.push(inc); chartData.exp.push(exp);
    html += `<tr><td><strong>${y}</strong></td><td style="color:#2e7d32;font-weight:700;">${fmt(inc)}</td><td style="color:#c62828;font-weight:700;">${fmt(exp)}</td><td style="font-weight:700;color:${diff >= 0 ? '#2e7d32' : '#c62828'};">${fmt(diff)}</td></tr>`;
  });
  html += `</tbody></table><div class="report-totals"><span>إجمالي الإيرادات: <strong style="color:#2e7d32;">${fmt(totalInc)}</strong></span><span>إجمالي المصروفات: <strong style="color:#c62828;">${fmt(totalExp)}</strong></span><span>المتبقي: <strong>${fmt(totalInc-totalExp)}</strong></span></div>`;
  window._yoyData = chartData;
  return html;
}

function drawYoYChart() {
  const ctx = document.getElementById('yoyChartCanvas');
  if (!ctx || !window._yoyData) return;
  if (state.yoyChart) { state.yoyChart.destroy(); }
  const data = window._yoyData;
  state.yoyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.years,
      datasets: [
        { label: 'إيرادات', data: data.inc, backgroundColor: 'rgba(46,125,50,.8)', borderColor: 'green', borderWidth: 1 },
        { label: 'مصروفات', data: data.exp, backgroundColor: 'rgba(198,40,40,.8)', borderColor: 'red', borderWidth: 1 },
        { label: 'المتبقي', data: data.inc.map((v,i) => v - data.exp[i]), type: 'line', borderColor: '#1a3a5c', backgroundColor: 'rgba(26,58,92,.2)', borderWidth: 3, tension: .3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { font: { family: 'Cairo', size: 14 } } },
        title: { display: true, text: 'مقارنة عام إلى عام', font: { family: 'Cairo', size: 18 } }
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => v.toLocaleString('en-US'), font: { family: 'Cairo' } } }
      }
    }
  });
}

function genDebtsReport() {
  const debts = state.debts.filter(d => d.status !== 'paid').sort((a,b) => ((b.amount||0)-(b.paid||0)) - ((a.amount||0)-(a.paid||0)));
  let html = '<table class="report-table"><thead><tr><th>#</th><th>الشقة</th><th>الاسم</th><th>الوصف</th><th>النوع</th><th>المبلغ</th><th>المدفوع</th><th>المتبقي</th></tr></thead><tbody>';
  let t=0, tp=0;
  debts.forEach((d,i) => {
    t += d.amount||0; tp += d.paid||0;
    html += `<tr><td>${i+1}</td><td>${d.unitNumber}</td><td>${d.resident}</td><td>${d.description}</td><td>${d.type === 'elevator' ? 'أسانسير' : 'عام'}</td><td>${d.amount}</td><td>${d.paid||0}</td><td style="color:#c62828;font-weight:700;">${(d.amount||0)-(d.paid||0)}</td></tr>`;
  });
  html += `</tbody></table><div class="report-totals"><span>الإجمالي: <strong>${t}</strong></span><span>مسدد: <strong>${tp}</strong></span><span>متبقي: <strong style="color:#c62828;">${t-tp}</strong></span></div>`;
  return html;
}

function genFundReport(fundType) {
  const txs = fundType === 'elevator' ? state.elevatorFund : state.generalFund;
  const title = fundType === 'elevator' ? 'صندوق الأسانسير' : 'صندوق الصيانة العامة';
  let html = `<h3>${title}</h3><table class="report-table"><thead><tr><th>#</th><th>التاريخ</th><th>النوع</th><th>الوصف</th><th>التصنيف</th><th>المبلغ</th></tr></thead><tbody>`;
  let inc=0, exp=0;
  txs.forEach((t,i) => {
    if (t.type === 'income') inc += t.amount; else exp += t.amount;
    html += `<tr><td>${i+1}</td><td>${t.timestamp ? new Date(t.timestamp).toLocaleDateString('ar-EG') : '-'}</td><td><span class="badge ${t.type === 'income' ? 'status-green' : 'status-red'}">${t.type === 'income' ? 'إيراد' : 'مصروف'}</span></td><td>${t.description}</td><td>${t.category || '-'}</td><td style="color:${t.type === 'income' ? '#2e7d32' : '#c62828'};font-weight:700;">${t.amount}</td></tr>`;
  });
  const carry = fundType === 'general' ? (state.settings.carryOver || 0) : 0;
  html += `</tbody></table><div class="report-totals"><span>الإيرادات: <strong style="color:#2e7d32;">${inc}</strong></span><span>المصروفات: <strong style="color:#c62828;">${exp}</strong></span>${carry > 0 ? `<span>المرحل: <strong>${carry}</strong></span>` : ''}<span>الرصيد: <strong>${inc-exp+carry}</strong></span></div>`;
  return html;
}

function genEmergencyReport() {
  let html = '<table class="report-table"><thead><tr><th>#</th><th>النوع</th><th>التصنيف</th><th>الوصف</th><th>الإجمالي</th><th>الوحدات</th><th>حصة الوحدة</th><th>التاريخ</th></tr></thead><tbody>';
  let total = 0;
  state.emergencies.forEach((e,i) => {
    total += e.total;
    html += `<tr><td>${i+1}</td><td>${e.type === 'elevator' ? 'أسانسير' : 'عام'}</td><td>${e.category}</td><td>${e.description}</td><td>${e.total}</td><td>${e.targetCount}</td><td>${e.perUnit}</td><td>${new Date(e.date).toLocaleDateString('ar-EG')}</td></tr>`;
  });
  html += `</tbody></table><div class="report-totals"><span>إجمالي: <strong style="color:#c62828;">${total} ج</strong></span></div>`;
  return html;
}

function genExpensesReport() {
  let html = '<table class="report-table"><thead><tr><th>#</th><th>التاريخ</th><th>الشهر</th><th>البند</th><th>الوصف</th><th>المبلغ</th><th>الصندوق</th></tr></thead><tbody>';
  let total=0, gen=0, el=0;
  state.expenses.forEach((e,i) => {
    total += e.amount;
    if (e.fund === 'elevator') el += e.amount; else gen += e.amount;
    html += `<tr><td>${i+1}</td><td>${e.date || '-'}</td><td>${e.month} ${e.year}</td><td>${e.category}</td><td>${e.description || '-'}</td><td style="color:#c62828;font-weight:700;">-${e.amount}</td><td>${e.fund === 'elevator' ? 'أسانسير' : 'عام'}</td></tr>`;
  });
  html += `</tbody></table><div class="report-totals"><span>إجمالي: <strong style="color:#c62828;">${total}</strong></span><span>عام: <strong>${gen}</strong></span><span>أسانسير: <strong>${el}</strong></span></div>`;
  return html;
}

function showUnitReport() {
  const num = prompt('أدخل رقم الوحدة:');
  if (!num) return;
  const u = state.units.find(x => x.number === num);
  if (!u) { showToast('❌ الوحدة غير موجودة', 'error'); return; }
  const year = state.currentYear;
  const payments = state.payments.filter(p => p.unitId === u.id);
  const debts = state.debts.filter(d => d.unitId === u.id);
  const codes = state.codes.filter(c => c.unitId === u.id);
  let monthlyHtml = '<table class="report-table" style="font-size:12px;"><thead><tr><th>الشهر</th><th>المطلوب</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>';
  let yearTotal = 0;
  MONTHS.forEach(m => {
    const paid = payments.filter(p => p.month === m && p.year === year).reduce((s,p) => s + p.amount, 0);
    const req = getFeeForMonth(u, m, year);
    const rem = Math.max(0, req - paid);
    yearTotal += paid;
    let cls = 'status-blue', st = '—';
    if (paid >= req && req > 0) { cls = 'status-green'; st = 'مدفوع'; }
    else if (paid > 0) { cls = 'status-yellow'; st = 'جزئي'; }
    else if (req > 0) { cls = 'status-red'; st = 'لم يدفع'; }
    monthlyHtml += `<tr><td><strong>${m}</strong></td><td>${req}</td><td>${paid}</td><td>${rem}</td><td><span class="badge ${cls}">${st}</span></td></tr>`;
  });
  monthlyHtml += `</tbody></table>`;
  const unitDebts = debts.filter(d => d.status !== 'paid').reduce((s,d) => s + ((d.amount||0)-(d.paid||0)), 0);
  const finalBalance = yearTotal - unitDebts + (u.openingBalance || 0);
  const html = `
    <div class="unit-report-info">
      <div><label>الدور</label><strong>${u.floor}</strong></div>
      <div><label>الشقة</label><strong>${u.number}</strong></div>
      <div><label>الساكن</label><strong>${u.resident || '-'}</strong></div>
      <div><label>الحالة</label><strong>${u.status}</strong></div>
      <div><label>النوع</label><strong>${u.type}</strong></div>
      <div><label>أسانسير</label><strong>${u.elevator === 'yes' ? 'نعم' : 'لا'}</strong></div>
      <div><label>الرسوم الحالية</label><strong>${getFeeForMonth(u, state.currentMonth, state.currentYear)}</strong></div>
      <div><label>رصيد افتتاحي</label><strong>${u.openingBalance || 0}</strong></div>
      <div><label>مديونيات</label><strong style="color:#c62828;">${unitDebts}</strong></div>
      <div><label>الرصيد النهائي</label><strong style="color:${finalBalance < 0 ? '#c62828' : '#2e7d32'};">${finalBalance}</strong></div>
    </div>
    <h4>📅 المصفوفة السنوية ${year}</h4>${monthlyHtml}
    <h4>💵 سجل المدفوعات (${payments.length})</h4>
    <table class="report-table"><thead><tr><th>الشهر</th><th>السنة</th><th>المبلغ</th><th>طريقة الدفع</th></tr></thead><tbody>
    ${payments.map(p => `<tr><td>${p.month}</td><td>${p.year}</td><td style="color:#2e7d32;font-weight:700;">${p.amount}</td><td>${p.method || '-'}</td></tr>`).join('') || '<tr><td colspan="4" style="text-align:center;">لا توجد</td></tr>'}
    </tbody></table>
    <h4>📋 المديونيات (${debts.length})</h4>
    <table class="report-table"><thead><tr><th>الوصف</th><th>المبلغ</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>
    ${debts.map(d => `<tr><td>${d.description}</td><td>${d.amount}</td><td>${d.paid||0}</td><td>${(d.amount||0)-(d.paid||0)}</td><td>${d.status === 'active' ? 'نشطة' : 'مسددة'}</td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;">لا توجد</td></tr>'}
    </tbody></table>
    <h4>🔑 شفرات الأسانسير (${codes.length})</h4>
    <table class="report-table"><thead><tr><th>الشفرة</th><th>الحالة</th></tr></thead><tbody>
    ${codes.map(c => `<tr><td><strong style="font-family:monospace;">${c.code}</strong></td><td>${c.status === 'active' ? 'نشطة' : 'موقوفة'}</td></tr>`).join('') || '<tr><td colspan="2" style="text-align:center;">لا توجد</td></tr>'}
    </tbody></table>`;
  document.getElementById('reportOutput').innerHTML = `<div class="report-header"><h3>📋 تقرير وحدة ${u.number}</h3><button class="btn-green" onclick="printReportContent()">🖨️ طباعة</button></div>${html}`;
}

function showAuditReport() {
  let html = '<table class="report-table"><thead><tr><th>#</th><th>التاريخ</th><th>العملية</th><th>الوصف</th></tr></thead><tbody>';
  state.auditLog.slice(0, 200).forEach((a,i) => {
    html += `<tr><td>${i+1}</td><td>${a.timestamp ? new Date(a.timestamp).toLocaleString('ar-EG') : '-'}</td><td>${a.action}</td><td>${a.description}</td></tr>`;
  });
  html += '</tbody></table>';
  document.getElementById('reportOutput').innerHTML = `<div class="report-header"><h3>📜 سجل المعاملات</h3></div>${html}`;
}

function printReportContent() {
  const c = document.getElementById('reportOutput').innerHTML;
  const w = window.open('', '_blank');
  w.document.write(`<html dir="rtl"><head><meta charset="UTF-8"><title>تقرير</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">
    <style>body{font-family:Cairo,sans-serif;padding:20px;}table{width:100%;border-collapse:collapse;margin:10px 0;}
    th,td{padding:8px;border:1px solid #ddd;text-align:right;font-size:13px;}
    th{background:#1a3a5c;color:#fff;}.badge{padding:3px 10px;border-radius:10px;font-size:11px;}
    .status-green{background:#e8f5e9;color:#2e7d32;}.status-red{background:#ffebee;color:#c62828;}.status-yellow{background:#fff3e0;color:#e65100;}.status-blue{background:#e3f2fd;color:#1565c0;}
    .report-totals{display:flex;gap:20px;padding:15px;background:#f5f5f5;border-radius:8px;margin-top:10px;}
    .unit-report-info{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0;padding:10px;background:#f9f9f9;border-radius:8px;}
    .unit-report-info label{font-size:11px;color:#888;display:block;}
    </style></head><body>${c}</body></html>`);
  w.document.close();
  w.onload = () => setTimeout(() => { w.focus(); w.print(); }, 400);
}

function exportReportExcel() {
  const tables = document.querySelectorAll('#reportOutput table');
  if (tables.length === 0) { showToast('⚠️ لا يوجد تقرير', 'warning'); return; }
  const ws = XLSX.utils.table_to_sheet(tables[0]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, `report_${Date.now()}.xlsx`);
}

// ==================== Backup ====================
function exportBackup() {
  const data = {
    units: state.units, payments: state.payments, debts: state.debts,
    codes: state.codes, elevatorFund: state.elevatorFund, generalFund: state.generalFund,
    emergencies: state.emergencies, expenses: state.expenses, otherIncomes: state.otherIncomes,
    settings: state.settings, auditLog: state.auditLog,
    exportDate: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('✅ تم إنشاء النسخة', 'success');
}

async function restoreBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!confirm('⚠️ سيتم استبدال البيانات. متأكد؟')) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    state.units = data.units || [];
    state.payments = data.payments || [];
    state.debts = data.debts || [];
    state.codes = data.codes || [];
    state.elevatorFund = data.elevatorFund || [];
    state.generalFund = data.generalFund || [];
    state.emergencies = data.emergencies || [];
    state.expenses = data.expenses || [];
    state.otherIncomes = data.otherIncomes || [];
    state.auditLog = data.auditLog || [];
    if (data.settings) state.settings = { ...state.settings, ...data.settings };
    if (useFirebase) {
      for (const col of ['units','payments','debts','codes','elevatorFund','generalFund','emergencies','expenses','otherIncomes']) {
        const snap = await db.collection(col).get();
        const batch = db.batch();
        snap.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      for (const u of state.units) await db.collection('units').add(u);
      for (const p of state.payments) await db.collection('payments').add(p);
      for (const d of state.debts) await db.collection('debts').add(d);
      for (const c of state.codes) await db.collection('codes').add(c);
      for (const e of state.elevatorFund) await db.collection('elevatorFund').add(e);
      for (const g of state.generalFund) await db.collection('generalFund').add(g);
      for (const em of state.emergencies) await db.collection('emergencies').add(em);
      for (const ex of state.expenses) await db.collection('expenses').add(ex);
      for (const oi of state.otherIncomes) await db.collection('otherIncomes').add(oi);
      await db.collection('settings').doc('config').set(state.settings);
    }
    saveLocal();
    updateBrandUI();
    renderDashboard();
    showToast('✅ تم الاستيراد', 'success');
  } catch(e) { showToast('❌ خطأ: ' + e.message, 'error'); }
}

async function resetSystem() {
  if (!confirm('⚠️ حذف جميع البيانات؟')) return;
  if (!confirm('⚠️ تأكيد أخير!')) return;
  state.units = []; state.payments = []; state.debts = []; state.codes = [];
  state.elevatorFund = []; state.generalFund = []; state.emergencies = [];
  state.expenses = []; state.otherIncomes = []; state.auditLog = [];
  state.selectedIds.clear();
  if (useFirebase) {
    for (const col of ['units','payments','debts','codes','elevatorFund','generalFund','emergencies','expenses','otherIncomes']) {
      const snap = await db.collection(col).get();
      const batch = db.batch();
      snap.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  }
  localStorage.removeItem('homeAppState_v4');
  localStorage.removeItem('homeAppState_v3');
  localStorage.removeItem('homeAppState_v2');
  localStorage.removeItem('homeAppState');
  showToast('✅ تم إعادة الضبط', 'success');
  setTimeout(() => location.reload(), 1000);
}

// ==================== Initial Data ====================
const INITIAL_RESIDENTS = [
  { sortOrder:1, floor:'البدروم', number:'0', location:'', resident:'أ - فرج ميخائيل', status:'مغلقة', type:'مغلق', elevator:'no', phones:[], amount:0 },
  { sortOrder:2, floor:'الأول', number:'101', location:'يمين السلم', resident:'أ - عبد المجيد سلطان', status:'مغلقة', type:'مالك', elevator:'no', phones:['01000973455'], amount:0, notes:'لا يستعمل اسانسير', openingBalance: -150 },
  { sortOrder:3, floor:'الأول', number:'102', location:'يسار السلم', resident:'أ - رضا وهيب', status:'ساكنة', type:'مالك', elevator:'no', phones:['01287503521'], amount:150, notes:'لا يستعمل اسانسير', paymentMethod:'On-line' },
  { sortOrder:4, floor:'الثانى', number:'201', location:'يمين السلم', resident:'أ - ماجد محمد سامي', status:'ساكنة', type:'مالك', elevator:'no', phones:['01110928842'], amount:150, notes:'لا يستعمل اسانسير', paymentMethod:'On-line' },
  { sortOrder:5, floor:'الثانى', number:'202', location:'يسار السلم', resident:'احمد شعبان فتحي', status:'ساكنة', type:'مستأجر', elevator:'no', phones:['01555184055'], amount:220, notes:'لا يستعمل اسانسير', paymentMethod:'Chash' },
  { sortOrder:6, floor:'الثالث', number:'301', location:'يمين السلم', resident:'أ- سيدة علي', status:'ساكنة', type:'مالك', elevator:'yes', phones:['01099583394'], amount:170, paymentMethod:'Chash' },
  { sortOrder:7, floor:'الثالث', number:'302', location:'يسار السلم', resident:'أ - مرتضي', status:'ساكنة', type:'مستأجر', elevator:'yes', phones:['01229537206','01064439136'], amount:220, paymentMethod:'Chash' },
  { sortOrder:8, floor:'الرابع', number:'401', location:'يمين السلم', resident:'أ - فادي سمير', status:'ساكنة', type:'مستأجر', elevator:'yes', phones:['01200133743'], amount:220, paymentMethod:'On-line' },
  { sortOrder:9, floor:'الرابع', number:'402', location:'يسار السلم', resident:'أ - منتصر احمد علي', status:'ساكنة', type:'مستأجر', elevator:'yes', phones:['01124006249'], amount:220, paymentMethod:'On-line' },
  { sortOrder:10, floor:'الخامس', number:'501', location:'يمين السلم', resident:'أ - عاطف رزق', status:'مغلقة', type:'مالك', elevator:'no', phones:['01274931868'], amount:0 },
  { sortOrder:11, floor:'الخامس', number:'502', location:'يسار السلم', resident:'الحاج محمد عبد المنعم', status:'ساكنة', type:'مالك', elevator:'yes', phones:['01126382207'], amount:170, paymentMethod:'Chash' },
  { sortOrder:12, floor:'السادس', number:'601', location:'يمين السلم', resident:'أ - فادي راشد', status:'ساكنة', type:'مالك', elevator:'yes', phones:['01121224662'], amount:170, paymentMethod:'Chash' },
  { sortOrder:13, floor:'السادس', number:'602', location:'يسار السلم', resident:'أ - محمد يوسف', status:'ساكنة', type:'مالك', elevator:'yes', phones:['01110065870'], amount:170, paymentMethod:'Chash' },
  { sortOrder:14, floor:'السابع', number:'701', location:'يمين السلم', resident:'أ - محمد محسن', status:'ساكنة', type:'مستأجر', elevator:'yes', phones:['01095467811'], amount:220, paymentMethod:'Chash' },
  { sortOrder:15, floor:'السابع', number:'702', location:'يسار السلم', resident:'أ - خالد جمال', status:'مغلقة', type:'مالك', elevator:'no', phones:['01006105465'], amount:0 },
  { sortOrder:16, floor:'الثامن', number:'801', location:'يمين السلم', resident:'أ - محمد السيد', status:'ساكنة', type:'مستأجر', elevator:'yes', phones:['01123009403'], amount:220, paymentMethod:'Chash' },
  { sortOrder:17, floor:'الثامن', number:'802', location:'يسار السلم', resident:'أ - عبد المعطى', status:'مغلقة', type:'مالك', elevator:'no', phones:['01116067661'], amount:0 },
  { sortOrder:18, floor:'التاسع', number:'901', location:'يمين السلم', resident:'أ - جمعة فراج', status:'مغلقة', type:'مالك', elevator:'no', phones:['01007460526'], amount:0 },
  { sortOrder:19, floor:'التاسع', number:'902', location:'يسار السلم', resident:'أ - سلامة ماضي', status:'ساكنة', type:'مستأجر', elevator:'yes', phones:['01005766489'], amount:220, paymentMethod:'Chash' },
  { sortOrder:20, floor:'العاشر', number:'1001', location:'يمين السلم', resident:'أ - احمد سعيد', status:'ساكنة', type:'مالك', elevator:'yes', phones:['01004442035'], amount:170, paymentMethod:'On-line' },
  { sortOrder:21, floor:'العاشر', number:'1002', location:'يسار السلم', resident:'أ - عاطف عبد العزيز', status:'مغلقة', type:'مستأجر', elevator:'no', phones:['01005838305'], amount:0 },
  { sortOrder:22, floor:'الحادى عشر', number:'1101', location:'يمين السلم', resident:'م . ماجدة حبيب', status:'مغلقة', type:'مالك', elevator:'no', phones:['13621386'], amount:0 },
  { sortOrder:23, floor:'الحادى عشر', number:'1102', location:'يسار السلم', resident:'م . رانيا رمزي', status:'ساكنة', type:'مستأجر', elevator:'yes', phones:['01155410992'], amount:220, paymentMethod:'Chash' },
  { sortOrder:24, floor:'الثانى عشر', number:'1201', location:'يمين السلم', resident:'أ - مشيل انطونيوس', status:'ساكنة', type:'مالك', elevator:'yes', phones:['01223879899'], amount:170, paymentMethod:'On-line' },
  { sortOrder:25, floor:'الثانى عشر', number:'1202', location:'يسار السلم', resident:'أ - محمد جمال احمد', status:'ساكنة', type:'مالك', elevator:'yes', phones:[], amount:170, paymentMethod:'On-line' },
  { sortOrder:26, floor:'الثالث عشر', number:'1301', location:'يمين السلم', resident:'م . جورجيت حبيب', status:'ساكنة', type:'مالك', elevator:'yes', phones:['01288251410'], amount:170, paymentMethod:'Chash' },
  { sortOrder:27, floor:'الثالث عشر', number:'1302', location:'يسار السلم', resident:'د. سامي عادل', status:'ساكنة', type:'مالك', elevator:'yes', phones:['01115468887'], amount:170, paymentMethod:'Chash' }
];

const INITIAL_EXPENSES = [
  { category: 'كهرباء', amount: 1235, month: 'مايو', year: 2026, fund: 'general', description: 'فاتورة كهرباء', date: '2026-05-01' },
  { category: 'المصعد صيانة دورية', amount: 300, month: 'مايو', year: 2026, fund: 'elevator', description: 'صيانة دورية', date: '2026-05-05' },
  { category: 'أدوات نظافة', amount: 60, month: 'مايو', year: 2026, fund: 'general', description: 'أدوات نظافة', date: '2026-05-10' },
  { category: 'مفتاح باب الأسانسير', amount: 150, month: 'مايو', year: 2026, fund: 'elevator', description: 'مفتاح', date: '2026-05-15' },
  { category: 'تصوير', amount: 20, month: 'مايو', year: 2026, fund: 'general', description: 'تصوير', date: '2026-05-20' },
  { category: 'مصاريف كاش', amount: 30, month: 'مايو', year: 2026, fund: 'general', description: 'كاش', date: '2026-05-25' }
];

// ==================== Init ====================
async function init() {
  console.log('🚀 تشغيل النظام...');
  if (localStorage.getItem('darkMode') === 'true') document.body.classList.add('dark');
  loadLocal();
  if (useFirebase) {
    const hasData = await fbLoadAll();
    console.log(hasData ? '✅ بيانات Firebase محملة' : '📭 لا توجد بيانات في Firebase');
  }
  
  if (state.units.length === 0) {
    console.log('📝 تحميل البيانات الأولية...');
    for (const u of INITIAL_RESIDENTS) {
      u.feeHistory = [{ from: '2026-01', fee: calcFee(u, state.settings) }];
      u.stateHistory = [{ from: '2026-01', status: u.status, type: u.type, elevator: u.elevator, resident: u.resident, fee: calcFee(u, state.settings) }];
      u.amount = calcFee(u, state.settings);
      const added = await fbAdd('units', u);
      state.units.push(added);
    }
    for (const e of INITIAL_EXPENSES) {
      const added = await fbAdd('expenses', e);
      state.expenses.push(added);
    }
    for (const e of INITIAL_EXPENSES) {
      const tx = await fbAdd(e.fund === 'elevator' ? 'elevatorFund' : 'generalFund', {
        type: 'expense', amount: e.amount, description: e.description || e.category,
        category: e.category, timestamp: new Date(e.date).getTime()
      });
      if (e.fund === 'elevator') state.elevatorFund.push(tx);
      else state.generalFund.push(tx);
    }
    saveLocal();
  } else {
    state.units.forEach(u => { if (!u.amount) u.amount = calcFee(u, state.settings); });
  }
  
  updateBrandUI();
  fillMonthSelects();
  fillGlobalMonthSelect();
  
  document.getElementById('loadingOverlay').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  
  document.getElementById('searchInput')?.addEventListener('input', () => renderUnits());
  document.getElementById('filterSelect')?.addEventListener('change', () => renderUnits());
  document.getElementById('payAmount')?.addEventListener('input', updatePaySummary);
  document.getElementById('unitStatus')?.addEventListener('change', updateUnitAmount);
  document.getElementById('unitType')?.addEventListener('change', updateUnitAmount);
  document.getElementById('unitElevator')?.addEventListener('change', updateUnitAmount);
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
  });
  
  // زر إضافة شفرة الأسانسير الجديد
  const codeBtn = document.querySelector('button[onclick*="openModal(\'codeModal\')"]');
  if (codeBtn) { codeBtn.setAttribute('onclick', 'openCodeModalNew()'); }
  
  renderDashboard();
  updateDebtFilterOptions(); // لتعبئة الفلتر بالوحدات التي عليها ديون فقط
  renderUnits();
  console.log('✅ النظام جاهز');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}