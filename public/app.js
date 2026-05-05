const TRANSACTION_TYPES = [
  { value: 'BELI', label: 'Beli saham', help: 'Masukkan harga per lembar dan jumlah lot.' },
  { value: 'JUAL', label: 'Jual saham', help: 'Dipakai saat Anda menjual saham yang dimiliki.' },
  { value: 'TOP UP', label: 'Top up dana', help: 'Menambah uang ke rekening portofolio.' },
  { value: 'WITHDRAW', label: 'Tarik uang', help: 'Mengambil uang keluar dari rekening portofolio.' },
  { value: 'DIVIDEN', label: 'Dividen', help: 'Pemasukan dividen tunai.' },
  { value: 'BEA METERAI', label: 'Bea meterai', help: 'Biasanya otomatis jika transaksi besar.' }
];
const SESSION_PIN_KEY = 'portoku_app_pin';
const TRACKER_CUTOFF_DATE = new Date(2025, 10, 28);
const ANALYTICS_RANGE_PRESETS = [
  { key: '1w', label: '1W' },
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: 'ytd', label: 'YTD' },
  { key: '1y', label: '1Y' },
  { key: 'all', label: 'All Time' }
];

const appState = {
  currentScreen: 'login',
  configured: false,
  loggedIn: false,
  selectedType: 'BELI',
  selectedJurnalMonth: 'semua',
  riwayatData: [],
  jurnalData: [],
  editingJurnalIndex: null,
  pinVerified: false,
  analyticsTrackerHelperRows: [],
  analyticsRangePreset: 'all',
  analyticsCustomStart: '',
  analyticsCustomEnd: '',
  performanceTableView: 'daily',
  performanceShowAllGainers: false,
  performanceShowAllLosers: false,
  performanceShowAllRows: false,
  loginPinBuffer: '',
  transactionPinBuffer: '',
  transactionPinResolver: null,
  keypadContext: null,
  portfolioData: []
};
let analyticsChart = null;

function parseAngka(str) {
  if (str === null || str === undefined || str === '') return 0;
  if (typeof str === 'number') return str;
  const cleaned = String(str)
    .replace(/[▲▼▬%\s]/g, '')
    .replace(/Rp/gi, '')
    .replace(/\./g, '')
    .replace(/,/g, '.')
    .trim();
  return parseFloat(cleaned) || 0;
}

function extractDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function formatInputThousands(value) {
  const digits = extractDigits(value);
  if (!digits) return '';
  return new Intl.NumberFormat('id-ID').format(Number(digits));
}

function setNumericInputValue(input, rawValue) {
  if (!input) return;
  const raw = extractDigits(rawValue);
  input.dataset.raw = raw;
  input.value = raw ? formatInputThousands(raw) : '';
}

function getNumericInputValue(inputOrId) {
  const input = typeof inputOrId === 'string'
    ? document.getElementById(inputOrId)
    : inputOrId;

  if (!input) return 0;
  if (input.dataset.raw !== undefined) {
    return Number(input.dataset.raw || 0);
  }
  return Number(extractDigits(input.value)) || 0;
}

function bindFormattedNumericInputs(ids) {
  ids.forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;

    if (!input.dataset.numericBound) {
      input.addEventListener('input', () => {
        const caretFromEnd = input.value.length - input.selectionStart;
        setNumericInputValue(input, input.value);

        const nextPosition = Math.max(0, input.value.length - caretFromEnd);
        window.requestAnimationFrame(() => {
          try {
            input.setSelectionRange(nextPosition, nextPosition);
          } catch (error) {
            // Some mobile browsers do not allow selection changes for all input states.
          }
        });
      });
      input.dataset.numericBound = 'true';
    }

    setNumericInputValue(input, input.dataset.raw ?? input.value);
  });
}

function parseSigned(str) {
  const num = parseAngka(str);
  if (typeof str === 'string') {
    const raw = str.trim();
    if (
      raw.includes('▼') ||
      raw.includes('▾') ||
      raw.includes('▿') ||
      raw.includes('-') ||
      raw.includes('−') ||
      /^\(.+\)$/.test(raw)
    ) {
      return -Math.abs(num);
    }
  }
  return num;
}

function formatRp(value) {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(num);
}

function formatPct(value) {
  const num = Number(value) || 0;
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
}

function formatReturnPct(value) {
  const num = (Number(value) || 0) * 100;
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
}

function formatTanggal(value) {
  const date = parseDate(value);
  if (!date) return value || '-';
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateForInput(value) {
  const date = parseDate(value);
  if (!date) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function formatDateForSheet(value) {
  const date = parseDate(value);
  if (!date) return value || '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function formatShortDate(value, includeYear = true) {
  const date = parseDate(value);
  if (!date) return '';
  const parts = [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0')
  ];
  if (includeYear) {
    parts.push(String(date.getFullYear()).slice(-2));
  }
  return parts.join('/');
}

function shouldIncludeYearForChart(series) {
  const years = new Set((series || []).map((row) => parseDate(row?.date)?.getFullYear()).filter(Boolean));
  return years.size > 1;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  if (typeof value === 'number' && value > 1000) {
    const excelEpoch = new Date(1899, 11, 30);
    excelEpoch.setDate(excelEpoch.getDate() + value);
    return new Date(excelEpoch.getFullYear(), excelEpoch.getMonth(), excelEpoch.getDate());
  }

  const stringValue = String(value).trim();

  const isoMatch = stringValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]) - 1;
    const day = Number(isoMatch[3]);
    const parsed = new Date(year, month, day);
    return (
      parsed.getFullYear() === year &&
      parsed.getMonth() === month &&
      parsed.getDate() === day
    ) ? parsed : null;
  }

  if (stringValue.includes('/')) {
    const parts = stringValue.split('/');
    if (parts.length !== 3) return null;
    const day = Number(parts[0]);
    const month = Number(parts[1]) - 1;
    let year = Number(parts[2]);
    if (year < 100) year += 2000;
    if (!day || month < 0 || !year) return null;
    const parsed = new Date(year, month, day);
    return (
      parsed.getFullYear() === year &&
      parsed.getMonth() === month &&
      parsed.getDate() === day
    ) ? parsed : null;
  }

  const excelNumber = Number(stringValue);
  if (!Number.isNaN(excelNumber) && excelNumber > 1000) {
    const excelEpoch = new Date(1899, 11, 30);
    excelEpoch.setDate(excelEpoch.getDate() + excelNumber);
    return new Date(excelEpoch.getFullYear(), excelEpoch.getMonth(), excelEpoch.getDate());
  }

  const months = {
    jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, jun: 5,
    jul: 6, agu: 7, sep: 8, okt: 9, nov: 10, des: 11,
    dec: 11
  };
  if (stringValue.includes(' ')) {
    const parts = stringValue.split(/\s+/);
    if (parts.length !== 3) return null;
    const day = Number(parts[0]);
    const month = months[parts[1].toLowerCase()];
    let year = Number(parts[2]);
    if (year < 100) year += 2000;
    if (!day || month === undefined || !year) return null;
    const parsed = new Date(year, month, day);
    return (
      parsed.getFullYear() === year &&
      parsed.getMonth() === month &&
      parsed.getDate() === day
    ) ? parsed : null;
  }

  return null;
}

function getMonthKey(value) {
  const date = parseDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getDateKey(value) {
  const date = parseDate(value);
  if (!date) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function normalizeDateOnly(value) {
  const date = parseDate(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatMonthKeyLabel(value, options = { month: 'short', year: 'numeric' }) {
  const date = parseDate(`${value}-01`);
  return date ? date.toLocaleDateString('id-ID', options) : value;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date, amount) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount);
  return next;
}

function addYears(date, amount) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + amount);
  return next;
}

function diffDays(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = normalizeDateOnly(startDate);
  const end = normalizeDateOnly(endDate);
  if (!start || !end) return 0;
  return Math.round((end - start) / (1000 * 60 * 60 * 24));
}

function parseDecimalCumulative(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const normalized = String(value)
    .trim()
    .replace(/\s/g, '')
    .replace('%', '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function calculateTradeNominal(harga, lot) {
  const parsedHarga = parseAngka(harga);
  const parsedLot = parseAngka(lot);
  return parsedHarga * parsedLot * 100;
}

function isKenaMaterai(totalHarian) {
  return totalHarian >= 10000000;
}

function logMateraiEvaluation(source, state, nilaiTransaksi) {
  const totalSebelum = Number(state?.existingTradeNominal) || 0;
  const totalSesudah = Number(state?.totalAfterCurrent) || 0;
  console.log('[BEA METERAI]', {
    source,
    totalHarianSebelumTransaksi: totalSebelum,
    nilaiTransaksi: Number(nilaiTransaksi) || 0,
    totalHarianSetelahTransaksi: totalSesudah,
    kenaMaterai: isKenaMaterai(totalSesudah),
    beaMeteraiSudahAda: Boolean(state?.beaMeteraiExists)
  });
}

function getDailyMeteraiState(tanggal, extraNominal = 0) {
  const targetKey = getDateKey(tanggal);
  if (!targetKey) {
    return {
      existingTradeNominal: 0,
      totalAfterCurrent: extraNominal,
      beaMeteraiExists: false
    };
  }

  let existingTradeNominal = 0;
  let beaMeteraiExists = false;

  (appState.jurnalData || []).forEach((row) => {
    if (getDateKey(row[0]) !== targetKey) return;
    const jenis = String(row[1] || '').trim().toUpperCase();

    if (jenis === 'BEA METERAI') {
      beaMeteraiExists = true;
      return;
    }

    if (jenis === 'BELI' || jenis === 'JUAL') {
      existingTradeNominal += calculateTradeNominal(row[3], row[4]);
    }
  });

  return {
    existingTradeNominal,
    totalAfterCurrent: existingTradeNominal + extraNominal,
    beaMeteraiExists
  };
}

function getDailyMeteraiStateForEdit(indexToIgnore, tanggal, extraNominal = 0) {
  const targetKey = getDateKey(tanggal);
  if (!targetKey) {
    return {
      existingTradeNominal: 0,
      totalAfterCurrent: extraNominal,
      beaMeteraiExists: false
    };
  }

  let existingTradeNominal = 0;
  let beaMeteraiExists = false;

  (appState.jurnalData || []).forEach((row, index) => {
    if (index === indexToIgnore) return;
    if (getDateKey(row[0]) !== targetKey) return;

    const jenis = String(row[1] || '').trim().toUpperCase();
    if (jenis === 'BEA METERAI') {
      beaMeteraiExists = true;
      return;
    }

    if (jenis === 'BELI' || jenis === 'JUAL') {
      existingTradeNominal += calculateTradeNominal(row[3], row[4]);
    }
  });

  return {
    existingTradeNominal,
    totalAfterCurrent: existingTradeNominal + extraNominal,
    beaMeteraiExists
  };
}

function getAttentionDates(indexToIgnore = null) {
  const byDate = {};

  (appState.jurnalData || []).forEach((row, index) => {
    if (index === indexToIgnore) return;
    const key = getDateKey(row[0]);
    if (!key) return;

    if (!byDate[key]) {
      byDate[key] = {
        tradeTotal: 0,
        beaMeteraiExists: false
      };
    }

    const jenis = String(row[1] || '').trim().toUpperCase();
    if (jenis === 'BEA METERAI') {
      byDate[key].beaMeteraiExists = true;
      return;
    }

    if (jenis === 'BELI' || jenis === 'JUAL') {
      byDate[key].tradeTotal += calculateTradeNominal(row[3], row[4]);
    }
  });

  const attentionDates = new Set();
  Object.entries(byDate).forEach(([key, value]) => {
    if (isKenaMaterai(value.tradeTotal) && !value.beaMeteraiExists) {
      attentionDates.add(key);
    }
  });
  return attentionDates;
}

function apiPath(path) {
  return path;
}

function getStoredPin() {
  return sessionStorage.getItem(SESSION_PIN_KEY) || '';
}

function storePin(pin) {
  sessionStorage.setItem(SESSION_PIN_KEY, pin);
}

function clearStoredPin() {
  sessionStorage.removeItem(SESSION_PIN_KEY);
  appState.pinVerified = false;
}

function getSharedKeypadShell() {
  return document.getElementById('shared-keypad-shell');
}

function getLoginKeypadSlot() {
  return document.getElementById('login-keypad-slot');
}

function placeSharedKeypadForContext() {
  const shell = getSharedKeypadShell();
  if (!shell) return;

  if (appState.keypadContext?.type === 'login') {
    const loginSlot = getLoginKeypadSlot();
    if (loginSlot && shell.parentElement !== loginSlot) {
      loginSlot.appendChild(shell);
    }
    return;
  }

  if (shell.parentElement !== document.body) {
    document.body.appendChild(shell);
  }
}

function renderPinIndicator(targetId, digitCount) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const safeDigits = Math.min(6, Math.max(0, digitCount));
  const filled = Array.from({ length: safeDigits }, () => '●');
  const empty = Array.from({ length: 6 - safeDigits }, () => '○');
  target.textContent = [...filled, ...empty].join(' ');
}

function updateLoginPinView() {
  renderPinIndicator('pin-display', appState.loginPinBuffer.length);
}

function updateTransactionPinView(message = '') {
  renderPinIndicator('transaction-pin-display', appState.transactionPinBuffer.length);
  const status = document.getElementById('transaction-pin-status');
  if (status) {
    status.textContent = message || 'Masukkan PIN untuk melanjutkan.';
  }
}

function updateSharedKeypadState() {
  const shell = getSharedKeypadShell();
  const submitButton = document.getElementById('pin-submit-btn');
  const transactionPanel = document.getElementById('transaction-pin-panel');
  if (!shell || !submitButton) return;
  placeSharedKeypadForContext();

  if (!appState.keypadContext) {
    shell.style.display = 'none';
    shell.classList.remove('keypad-login-mode');
    document.body.classList.remove('keypad-visible', 'transaction-pin-active');
    if (transactionPanel) transactionPanel.style.display = 'none';
    return;
  }

  shell.style.display = 'block';
  shell.classList.toggle('keypad-login-mode', appState.keypadContext.type === 'login');
  document.body.classList.add('keypad-visible');
  document.body.classList.toggle('transaction-pin-active', appState.keypadContext.type === 'transactionPin');
  if (transactionPanel) {
    transactionPanel.style.display = appState.keypadContext.type === 'transactionPin' ? 'grid' : 'none';
  }

  if (appState.keypadContext.type === 'login') {
    submitButton.disabled = appState.loginPinBuffer.length < 6;
    return;
  }

  if (appState.keypadContext.type === 'transactionPin') {
    submitButton.disabled = appState.transactionPinBuffer.length < 6;
    return;
  }
}

function showLoginKeypad() {
  appState.keypadContext = { type: 'login' };
  updateSharedKeypadState();
}

function closeTransactionPin(result) {
  if (typeof appState.transactionPinResolver === 'function') {
    appState.transactionPinResolver(result);
  }
  appState.transactionPinResolver = null;
  appState.transactionPinBuffer = '';
  updateTransactionPinView();
  appState.keypadContext = null;
  updateSharedKeypadState();
}

function showTransactionPinKeypad() {
  appState.transactionPinBuffer = '';
  appState.keypadContext = { type: 'transactionPin' };
  updateTransactionPinView();
  updateSharedKeypadState();
}

function bindSharedKeypad() {
  const keypadButtons = document.querySelectorAll('[data-pin-key]');
  const actionButtons = document.querySelectorAll('[data-pin-action]');
  const transactionCancel = document.getElementById('transaction-pin-cancel');

  keypadButtons.forEach((key) => {
    if (key.dataset.bound) return;
    key.addEventListener('click', () => {
      if (!appState.keypadContext) return;
      key.classList.add('is-pressed');
      window.setTimeout(() => key.classList.remove('is-pressed'), 120);

      if (appState.keypadContext.type === 'login') {
        if (appState.loginPinBuffer.length >= 6) return;
        appState.loginPinBuffer += key.dataset.pinKey;
        updateLoginPinView();
        updateSharedKeypadState();
        return;
      }

      if (appState.keypadContext.type === 'transactionPin') {
        if (appState.transactionPinBuffer.length >= 6) return;
        appState.transactionPinBuffer += key.dataset.pinKey;
        updateTransactionPinView();
        updateSharedKeypadState();
        return;
      }
    });
    key.dataset.bound = 'true';
  });

  actionButtons.forEach((actionButton) => {
    if (actionButton.dataset.bound) return;
    actionButton.addEventListener('click', () => {
      if (!appState.keypadContext) return;

      const action = actionButton.dataset.pinAction;
      if (action === 'backspace') {
        if (appState.keypadContext.type === 'login') {
          appState.loginPinBuffer = appState.loginPinBuffer.slice(0, -1);
          updateLoginPinView();
          updateSharedKeypadState();
          return;
        }

        if (appState.keypadContext.type === 'transactionPin') {
          appState.transactionPinBuffer = appState.transactionPinBuffer.slice(0, -1);
          updateTransactionPinView();
          updateSharedKeypadState();
          return;
        }
      }

      if (action === 'submit') {
        if (appState.keypadContext.type === 'login') {
          const submitHandler = document.getElementById('pin-submit-btn')?.onclick;
          if (typeof submitHandler === 'function') {
            submitHandler();
          }
          return;
        }
        if (appState.keypadContext.type === 'transactionPin') {
          if (appState.transactionPinBuffer.length < 6) return;
          closeTransactionPin(appState.transactionPinBuffer);
          return;
        }
      }
    });
    actionButton.dataset.bound = 'true';
  });

  if (transactionCancel && !transactionCancel.dataset.bound) {
    transactionCancel.addEventListener('click', () => closeTransactionPin(null));
    transactionCancel.dataset.bound = 'true';
  }
}

function buildRequestHeaders(options = {}) {
  const headers = new Headers(options.headers || {});
  const storedPin = getStoredPin();
  if (storedPin) {
    headers.set('x-app-pin', storedPin);
  }
  return headers;
}

async function verifyPin(pin) {
  console.log('[PIN VERIFY] Memulai verifikasi PIN', {
    hasPin: Boolean(pin),
    pinLength: String(pin || '').length
  });

const response = await fetch('/api/verify-pin', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-app-pin': pin
  }
});

  const data = await response.json();
  console.log('[PIN VERIFY] Hasil verifikasi PIN', {
    status: response.status,
    success: Boolean(data.success)
  });

  if (!response.ok) {
    throw new Error(data.error || 'PIN tidak valid.');
  }

  return data;
}

async function requireTransactionPin() {
  const storedPin = getStoredPin();
  if (!storedPin) {
    clearStoredPin();
    throw new Error('Sesi PIN tidak ditemukan. Silakan login ulang.');
  }

  const transactionPin = await new Promise((resolve) => {
    appState.transactionPinResolver = resolve;
    showTransactionPinKeypad();
  });

  if (transactionPin === null) {
    return false;
  }

  if (transactionPin !== storedPin) {
    console.log('[PIN TRANSAKSI] PIN transaksi tidak cocok dengan session PIN.');
    alert('PIN transaksi tidak sesuai.');
    return false;
  }

  console.log('[PIN TRANSAKSI] PIN transaksi valid.');
  return true;
}

async function fetchJson(path, options) {
  const requestOptions = { ...(options || {}) };
  requestOptions.headers = buildRequestHeaders(options);
  requestOptions.cache = 'no-store';

  console.log('[FETCH] Request API', {
    method: requestOptions.method || 'GET',
    path: apiPath(path)
  });

  const response = await fetch(apiPath(path), requestOptions);
  const data = await response.json();
  console.log('[FETCH] Response API', {
    method: requestOptions.method || 'GET',
    path: apiPath(path),
    status: response.status
  });

  if (response.status === 401) {
    clearStoredPin();
    showScreen('login');
  }

  if (!response.ok) {
    throw new Error(data.error || 'Terjadi kesalahan.');
  }
  return data;
}

function showScreen(name) {
  appState.currentScreen = name;
  document.querySelectorAll('.screen').forEach((screen) => {
    screen.classList.toggle('active', screen.id === `screen-${name}`);
  });
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.screen === name);
  });
  document.getElementById('bottom-nav').style.display = name === 'login' ? 'none' : 'grid';
  if (name !== 'login' && appState.keypadContext?.type === 'login') {
    appState.keypadContext = null;
    updateSharedKeypadState();
  }

  if (name === 'dashboard') loadDashboard();
  if (name === 'input') {
    initInputForm();
    loadJurnal();
  }
  if (name === 'riwayat') loadRiwayat();
  if (name === 'analytics') loadAnalytics();
}

function statusBanner(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;

  target.innerHTML = `
    <div class="status-banner banner-live">
      <strong>Google Sheets aktif</strong>
      <span>Aplikasi sedang membaca data asli dari spreadsheet Anda.</span>
    </div>
  `;
}

async function bootstrapApp() {
  buildTypeButtons();
  bindSharedKeypad();

  const storedPin = getStoredPin();
  if (!storedPin) {
    renderLoginState();
    showScreen('login');
    return;
  }

  try {
    await verifyPin(storedPin);
    appState.pinVerified = true;

    const data = await fetchJson('/api/bootstrap');
    appState.configured = data.configured;
    appState.loggedIn = true;
    showScreen('dashboard');
  } catch (error) {
    clearStoredPin();
    renderLoginState(error.message);
    showScreen('login');
  }
}

function renderLoginState(errorMessage = '') {
  const status = document.getElementById('login-status');
  const button = document.getElementById('pin-submit-btn');

  async function submitPin() {
    const pin = appState.loginPinBuffer;
    if (pin.length < 6) {
      status.textContent = 'PIN harus 6 digit.';
      return;
    }

    button.disabled = true;
    status.textContent = 'Memverifikasi...';

    try {
      await verifyPin(pin);
      storePin(pin);
      appState.pinVerified = true;

      const data = await fetchJson('/api/bootstrap');
      appState.configured = data.configured;
      appState.loggedIn = true;
      appState.loginPinBuffer = '';
      updateLoginPinView();
      updateSharedKeypadState();
      showScreen('dashboard');
    } catch (error) {
      clearStoredPin();
      appState.loginPinBuffer = '';
      updateLoginPinView();
      updateSharedKeypadState();
      status.textContent = error.message;
    } finally {
      button.disabled = appState.loginPinBuffer.length < 6;
    }
  }

  status.textContent = errorMessage || 'Masukkan PIN untuk melanjutkan.';
  updateLoginPinView();
  showLoginKeypad();
  button.onclick = submitPin;
}

function buildTypeButtons() {
  const typeClassMap = {
    'BELI': 'btn-beli',
    'JUAL': 'btn-jual',
    'TOP UP': 'btn-topup',
    'WITHDRAW': 'btn-tarik',
    'DIVIDEN': 'btn-dividen',
    'BEA METERAI': 'btn-bea'
  };

  const grid = document.getElementById('type-grid');
  grid.innerHTML = TRANSACTION_TYPES.map((type) => {
    const typeClass = typeClassMap[type.value] || '';
    const stateClass = type.value === appState.selectedType ? 'active' : 'inactive';
    return `
      <button
        type="button"
        class="btn-type ${typeClass} ${stateClass}"
        data-type="${type.value}"
      >
        <span>${type.label}</span>
      </button>
    `;
  }).join('');

  grid.querySelectorAll('.btn-type').forEach((button) => {
    button.addEventListener('click', () => {
      appState.selectedType = button.dataset.type;
      grid.querySelectorAll('.btn-type').forEach((item) => {
        item.classList.remove('active');
        item.classList.add('inactive');
      });
      button.classList.remove('inactive');
      button.classList.add('active');
      updateInputVisibility();
    });
  });
}

function initInputForm() {
  statusBanner('input-banner');
  const inputTanggal = document.getElementById('input-tanggal');
  if (!inputTanggal.value) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    inputTanggal.value = `${yyyy}-${mm}-${dd}`;
  }

  bindFormattedNumericInputs(['input-harga', 'input-lot', 'input-nilai']);
  ensureSellInputHelpers();
  ['input-harga', 'input-lot', 'input-nilai'].forEach((id) => {
    const element = document.getElementById(id);
    if (!element.dataset.bound) {
      element.addEventListener('input', updatePreview);
      element.dataset.bound = 'true';
    }
  });

  if (!inputTanggal.dataset.bound) {
    inputTanggal.addEventListener('input', updatePreview);
    inputTanggal.dataset.bound = 'true';
  }

  const inputKode = document.getElementById('input-kode');
  if (inputKode && !inputKode.dataset.boundSellHelpers) {
    inputKode.addEventListener('input', () => {
      inputKode.value = inputKode.value.toUpperCase();
      refreshSellAllButton();
    });
    inputKode.addEventListener('change', refreshSellAllButton);
    inputKode.dataset.boundSellHelpers = 'true';
  }

  updateInputVisibility();
}

function ensureSellInputHelpers() {
  const inputKode = document.getElementById('input-kode');

  // Inject custom dropdown (bukan datalist)
  if (inputKode && !document.getElementById('stock-dropdown')) {
    inputKode.insertAdjacentHTML('afterend', '<div id="stock-dropdown" class="custom-dropdown"></div>');

    // Atribut untuk disable native iOS suggestion
    inputKode.setAttribute('autocomplete', 'off');
    inputKode.setAttribute('autocorrect', 'off');
    inputKode.setAttribute('autocapitalize', 'characters');
    inputKode.setAttribute('spellcheck', 'false');
    // readonly diatur dinamis di refreshSellInputOptions() berdasarkan tipe transaksi

    // Toggle dropdown saat input diklik
    inputKode.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = document.getElementById('stock-dropdown');
      if (!dropdown) return;
      const isOpen = dropdown.classList.contains('open');
      dropdown.classList.toggle('open', !isOpen);
    });

    // Tutup dropdown saat klik di luar
    document.addEventListener('click', () => {
      const dropdown = document.getElementById('stock-dropdown');
      if (dropdown) dropdown.classList.remove('open');
    });

    // Klik di dalam dropdown tidak menutup
    document.getElementById('stock-dropdown')?.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  const lotInput = document.getElementById('input-lot');
  if (lotInput && !document.getElementById('sell-all-btn')) {
    lotInput.insertAdjacentHTML('afterend', `
      <button id="sell-all-btn" class="ghost-btn sell-all-btn" type="button" style="display:none">
        Jual semua
      </button>
    `);
    document.getElementById('sell-all-btn')?.addEventListener('click', () => {
      const selectedCode = (document.getElementById('input-kode')?.value || '').trim().toUpperCase();
      const position = (appState.portfolioData || []).find((item) => item.kode === selectedCode);
      if (!position) return;
      setNumericInputValue(document.getElementById('input-lot'), position.lot);
      updatePreview();
      refreshSellAllButton();
    });
  }
}

function refreshSellInputOptions() {
  const inputKode = document.getElementById('input-kode');
  const dropdown = document.getElementById('stock-dropdown');
  if (!inputKode || !dropdown) return;

  const isSell = appState.selectedType === 'JUAL';

  if (!isSell) {
    // Mode bukan JUAL: input bisa diketik bebas
    inputKode.removeAttribute('readonly');
    inputKode.removeAttribute('placeholder');
    inputKode.setAttribute('placeholder', 'contoh: BBCA');
    dropdown.innerHTML = '';
    dropdown.classList.remove('open');
    return;
  }

  if (!appState.portfolioData.length) {
    dropdown.innerHTML = '';
    dropdown.classList.remove('open');
    return;
  }

  // Mode JUAL: input readonly, pilih dari dropdown
  inputKode.setAttribute('readonly', '');
  inputKode.setAttribute('placeholder', 'ketuk untuk pilih saham...');

  dropdown.innerHTML = appState.portfolioData.map((item) => `
    <div class="dropdown-item" data-kode="${item.kode}">
      <span class="dropdown-item-code">${item.kode}</span>
      <span class="dropdown-item-lot">${item.lot.toLocaleString('id-ID')} lot</span>
    </div>
  `).join('');

  dropdown.querySelectorAll('.dropdown-item').forEach((el) => {
    el.addEventListener('click', () => {
      inputKode.value = el.dataset.kode;
      dropdown.classList.remove('open');
      refreshSellAllButton();
    });
  });
}

function refreshSellAllButton() {
  const sellAllButton = document.getElementById('sell-all-btn');
  const lotInput = document.getElementById('input-lot');
  const selectedCode = (document.getElementById('input-kode')?.value || '').trim().toUpperCase();

  if (!sellAllButton || !lotInput) return;

  const position = (appState.portfolioData || []).find((item) => item.kode === selectedCode);
  const canShow = appState.selectedType === 'JUAL' && Boolean(position && position.lot);

  sellAllButton.style.display = canShow ? 'inline-flex' : 'none';
  sellAllButton.textContent = canShow
    ? `Jual semua (${position.lot.toLocaleString('id-ID')} lot)`
    : 'Jual semua';
}

function updateInputVisibility() {
  const isStock = ['BELI', 'JUAL'].includes(appState.selectedType);
  const isNominalOnly = ['TOP UP', 'WITHDRAW', 'DIVIDEN'].includes(appState.selectedType);
  const type = TRANSACTION_TYPES.find((item) => item.value === appState.selectedType);

  document.getElementById('field-kode').style.display = isStock ? 'block' : 'none';
  document.getElementById('field-harga-lot').style.display = isStock ? 'grid' : 'none';
  document.getElementById('field-nilai').style.display = isNominalOnly ? 'block' : 'none';

  const preview = document.getElementById('preview-box');
  preview.style.display = 'block';
  preview.innerHTML = `
    <div class="preview-title">${type.label}</div>
    <div class="preview-help">${type.help}</div>
    <div id="preview-body"></div>
  `;
  refreshSellInputOptions();
  refreshSellAllButton();
  updatePreview();
}

function updatePreview() {
  const previewBody = document.getElementById('preview-body');
  if (!previewBody) return;
  const tanggal = document.getElementById('input-tanggal').value;

  if (['BELI', 'JUAL'].includes(appState.selectedType)) {
    const harga = getNumericInputValue('input-harga');
    const lot = getNumericInputValue('input-lot');
    const lembar = lot * 100;
    const gross = harga * lembar;
    const feeRate = appState.selectedType === 'JUAL' ? 0.0015 : 0.0015;
    const est = appState.selectedType === 'JUAL' ? gross * (1 - feeRate) : gross * (1 + feeRate);
    const meteraiState = getDailyMeteraiState(tanggal, gross);
    const kenaMaterai = isKenaMaterai(meteraiState.totalAfterCurrent);
    logMateraiEvaluation('preview transaksi', meteraiState, gross);
    let meteraiLabel = 'Belum kena';

    if (meteraiState.beaMeteraiExists) {
      meteraiLabel = 'Telah dikenakan bea meterai';
    } else if (kenaMaterai) {
      meteraiLabel = 'Transaksi ini akan memicu bea meterai';
    }

    previewBody.innerHTML = `
      <div class="preview-row"><span>Estimasi nilai transaksi</span><strong>${formatRp(est)}</strong></div>
      <div class="preview-row"><span>Akumulasi beli/jual hari ini</span><strong>${formatRp(meteraiState.totalAfterCurrent)}</strong></div>
      <div class="preview-row"><span>Bea meterai</span><strong>${meteraiLabel}</strong></div>
    `;
    return;
  }

  const nominal = getNumericInputValue('input-nilai');
  previewBody.innerHTML = `
    <div class="preview-row"><span>Nominal tercatat</span><strong>${formatRp(nominal)}</strong></div>
    <div class="preview-row"><span>Tujuan data</span><strong>Google Sheets asli</strong></div>
  `;
}

async function submitTransaksi() {
  const transactionAllowed = await requireTransactionPin();
  if (!transactionAllowed) return;

  const tanggal = document.getElementById('input-tanggal').value;
  if (!tanggal) {
    alert('Tanggal transaksi belum diisi.');
    return;
  }

  const payload = { jenis: appState.selectedType, tanggal, beaMeterai: false };
  if (['BELI', 'JUAL'].includes(appState.selectedType)) {
    const kode = document.getElementById('input-kode').value.toUpperCase().trim();
    const harga = getNumericInputValue('input-harga');
    const lot = getNumericInputValue('input-lot');
    if (!kode || !harga || !lot) {
      alert('Lengkapi kode saham, harga, dan lot terlebih dahulu.');
      return;
    }
    payload.kode = kode;
    payload.harga = harga;
    payload.lot = lot;
    const nilaiTransaksi = calculateTradeNominal(harga, lot);
    const meteraiState = getDailyMeteraiState(tanggal, nilaiTransaksi);
    logMateraiEvaluation('submit transaksi', meteraiState, nilaiTransaksi);
    payload.beaMeterai = !meteraiState.beaMeteraiExists && isKenaMaterai(meteraiState.totalAfterCurrent);
  } else if (appState.selectedType === 'BEA METERAI') {
    payload.kode = 'Bea Meterai';
    payload.harga = 10000;
  } else {
    const nominal = getNumericInputValue('input-nilai');
    if (!nominal) {
      alert('Nominal transaksi belum diisi.');
      return;
    }
    payload.kode = appState.selectedType;
    payload.harga = nominal;
  }

  const button = document.getElementById('submit-btn');
  button.disabled = true;
  button.textContent = 'Menyimpan...';
  try {
    await fetchJson('/api/transaksi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    alert('Transaksi berhasil disimpan ke JURNAL.');
    ['input-kode', 'input-harga', 'input-lot', 'input-nilai'].forEach((id) => {
      const element = document.getElementById(id);
      if (!element) return;
      if (['input-harga', 'input-lot', 'input-nilai'].includes(id)) {
        setNumericInputValue(element, '');
        return;
      }
      element.value = '';
    });
    updatePreview();
    loadDashboard(true);
    loadJurnal();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Simpan ke JURNAL';
  }
}

function parseDashboard(rows) {
  const get = (row, col) => (rows[row] && rows[row][col]) || 0;
  const pertumbuhanRaw = get(2, 6);
  const pertumbuhan = String(pertumbuhanRaw).includes('%')
    ? parseAngka(pertumbuhanRaw)
    : parseAngka(pertumbuhanRaw) * 100;

  return {
    totalKekayaan: parseAngka(get(2, 0)),
    modalDisetor: parseAngka(get(2, 3)),
    pertumbuhan,
    asetSaham: parseAngka(get(7, 0)),
    sisaKas: parseAngka(get(7, 3)),
    unrealized: parseSigned(get(10, 1)),
    realizedAll: parseSigned(get(16, 1)),
    movement: parseSigned(get(20, 1))
  };
}

function parsePortfolio(rows) {
  return (rows || []).slice(1).filter((row) => row[0]).map((row) => ({
    kode: row[0],
    lot: Number(row[1]) || 0,
    avgHarga: parseAngka(row[2]),
    hargaSekarang: parseAngka(row[3]),
    totalNilai: parseAngka(row[4]),
    unrealized: parseSigned(row[5]),
    pct: String(row[6]).includes('%') ? parseSigned(row[6]) : parseSigned(row[6]) * 100
  }));
}

function toneClass(value) {
  if (value > 0) return 'tone-good';
  if (value < 0) return 'tone-bad';
  return 'tone-neutral';
}

function displayToneClass(value) {
  const numericValue = typeof value === 'number' ? value : parseSigned(value);
  if (numericValue > 0) return 'performance-positive';
  if (numericValue < 0) return 'performance-negative';
  return 'performance-neutral';
}

async function loadDashboard(showToast = false) {
  statusBanner('status-banner');
  const target = document.getElementById('dashboard-content');
  target.innerHTML = '<div class="loading-card">Memuat data dashboard...</div>';

  try {
    const data = await fetchJson('/api/dashboard');
    const summary = parseDashboard(data.dashboard);
    const portfolio = parsePortfolio(data.portfolio);
    renderDashboard(summary, portfolio);
    if (showToast) console.info('Dashboard dimuat ulang.');
  } catch (error) {
    target.innerHTML = `<div class="empty-card">${error.message}</div>`;
  }
}

function renderDashboard(summary, portfolio) {
  appState.portfolioData = portfolio;
  if (appState.currentScreen === 'input') {
    refreshSellInputOptions();
    refreshSellAllButton();
  }
  const target = document.getElementById('dashboard-content');
  const sortedPortfolio = [...portfolio].sort((a, b) => b.pct - a.pct);
  const portfolioRows = sortedPortfolio.length ? sortedPortfolio.map((item) => `
    <div class="list-row">
      <div class="list-left">
        <div class="list-title">${item.kode}</div>
        <div class="portfolio-meta-grid">
          <div class="portfolio-meta-item">
            <span class="portfolio-meta-label">Lot</span>
            <strong>${item.lot.toLocaleString('id-ID')}</strong>
          </div>
          <div class="portfolio-meta-item">
            <span class="portfolio-meta-label">Avg</span>
            <strong>${formatRp(item.avgHarga)}</strong>
          </div>
          <div class="portfolio-meta-item">
            <span class="portfolio-meta-label">Harga sekarang</span>
            <strong>${formatRp(item.hargaSekarang)}</strong>
          </div>
        </div>
      </div>
      <div class="list-right">
        <div class="portfolio-pl-label">Potential Profit/Loss</div>
        <div class="list-title ${toneClass(item.unrealized)}">${formatRp(item.unrealized)}</div>
        <div class="pill ${toneClass(item.unrealized)}">${formatPct(item.pct)}</div>
      </div>
    </div>
  `).join('') : '<div class="empty-card">Belum ada saham aktif di portofolio.</div>';

  target.innerHTML = `
    <div class="dashboard-grid">
      <div class="dashboard-card dashboard-card-large dashboard-card-primary card-saldo-main">
        <div class="dashboard-card-head">
          <div class="panel-kicker">Ringkasan utama</div>
        <div class="dashboard-card-label">Total Kekayaan</div>
      </div>
      <div class="dashboard-card-value dashboard-card-value-xl">${formatRp(summary.totalKekayaan)}</div>
      <div class="dashboard-card-copy">
          <strong class="${toneClass(summary.pertumbuhan)}">${formatPct(summary.pertumbuhan)}</strong> dari modal
        </div>
        <div class="dashboard-card-copy">Modal disetor ${formatRp(summary.modalDisetor)}</div>
      </div>

      <div class="dashboard-stack">
        <div class="dashboard-card dashboard-card-small card-saldo-child">
          <div class="dashboard-card-label">Sisa Kas</div>
          <div class="dashboard-card-value">${formatRp(summary.sisaKas)}</div>
          <div class="dashboard-card-copy">Dana yang belum dibelikan saham</div>
        </div>
        <div class="dashboard-card dashboard-card-small card-saldo-child">
          <div class="dashboard-card-label">Aset Saham</div>
          <div class="dashboard-card-value">${formatRp(summary.asetSaham)}</div>
          ${(() => {
            const total = summary.asetSaham + summary.sisaKas;
            const pct = total > 0 ? (summary.asetSaham / total * 100).toFixed(1) : null;
            return pct !== null
              ? `<div class="dashboard-card-copy card-pct-label">${pct}% dari dana RDN diinvestasikan</div>`
              : '<div class="dashboard-card-copy">Nilai saham yang masih dipegang</div>';
          })()}
        </div>
      </div>

      <div class="dashboard-stack">
        <div class="dashboard-card dashboard-card-small card-perf-child">
          <div class="dashboard-card-label">Realized Profit/Loss</div>
          <div class="dashboard-card-value ${toneClass(summary.realizedAll)}">${formatRp(summary.realizedAll)}</div>
          <div class="dashboard-card-copy">Hasil yang sudah terkunci</div>
        </div>
        <div class="dashboard-card dashboard-card-small card-perf-child">
          <div class="dashboard-card-label">Unrealized Profit/Loss</div>
          <div class="dashboard-card-value ${toneClass(summary.unrealized)}">${formatRp(summary.unrealized)}</div>
          <div class="dashboard-card-copy">Untung rugi posisi yang masih aktif</div>
        </div>
      </div>

      <div class="dashboard-card dashboard-card-large dashboard-card-secondary card-perf-main">
        <div class="dashboard-card-head">
          <div class="panel-kicker">Performa utama</div>
          <div class="dashboard-card-label">Movement</div>
        </div>
        <div class="dashboard-card-value dashboard-card-value-xl ${toneClass(summary.movement)}">${formatRp(summary.movement)}</div>
        <div class="dashboard-card-copy">Gabungan realized dan unrealized saat ini</div>
        <div class="hero-pill ${toneClass(summary.movement)}">${summary.movement >= 0 ? 'Portofolio tumbuh' : 'Portofolio turun'}</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Portofolio aktif</div>
      ${portfolioRows}
    </div>
  `;
}

async function loadJurnal() {
  const target = document.getElementById('jurnal-list');
  target.innerHTML = '<div class="loading-card">Memuat transaksi...</div>';
  try {
    const data = await fetchJson('/api/jurnal');
    appState.jurnalData = (data.rows || []).slice().reverse();
    buildJurnalMonthFilter();
    renderJurnal();
    updatePreview();
  } catch (error) {
    target.innerHTML = `<div class="empty-card">${error.message}</div>`;
  }
}

function buildJurnalMonthFilter() {
  const target = document.getElementById('jurnal-filter');
  const keys = [...new Set(appState.jurnalData.map((row) => getMonthKey(row[0])).filter(Boolean))];
  const items = ['semua', ...keys];
  target.innerHTML = items.map((key) => {
    const label = key === 'semua'
      ? 'Semua'
      : formatMonthKeyLabel(key, { month: 'short', year: 'numeric' });
    return `
      <button type="button" class="filter-chip ${key === appState.selectedJurnalMonth ? 'active' : ''}" data-key="${key}">
        ${label}
      </button>
    `;
  }).join('');

  target.querySelectorAll('.filter-chip').forEach((button) => {
    button.addEventListener('click', () => {
      appState.selectedJurnalMonth = button.dataset.key;
      buildJurnalMonthFilter();
      renderJurnal();
    });
  });
}

function renderJurnal() {
  const target = document.getElementById('jurnal-list');
  if (!appState.jurnalData.length) {
    target.innerHTML = '<div class="empty-card">Belum ada transaksi untuk ditampilkan.</div>';
    return;
  }
  const attentionDates = getAttentionDates();
  const filteredRows = appState.selectedJurnalMonth === 'semua'
    ? appState.jurnalData
    : appState.jurnalData.filter((row) => getMonthKey(row[0]) === appState.selectedJurnalMonth);

  if (!filteredRows.length) {
    target.innerHTML = '<div class="empty-card">Tidak ada transaksi pada bulan ini.</div>';
    return;
  }

  target.innerHTML = filteredRows.map((row, filteredIndex) => {
    const actualIndex = appState.jurnalData.indexOf(row);
    const nominal = row[3] ? formatRp(parseAngka(row[3])) : '-';
    const lotText = row[4] ? `${row[4]} lot` : 'non-saham';
    const attentionBadge = attentionDates.has(getDateKey(row[0]))
      ? '<span class="mini-alert">Butuh perhatian</span>'
      : '';
    const editorHtml = appState.editingJurnalIndex === actualIndex ? buildJurnalEditor() : '';
    return `
      <button type="button" class="list-row list-row-button" onclick="openJurnalEditor(${actualIndex})">
        <div>
          <div class="list-title">${row[2] || row[1]} ${attentionBadge}</div>
          <div class="list-sub">${formatTanggal(row[0])} · ${row[1] || '-'}</div>
        </div>
        <div class="list-right">
          <div class="list-title">${nominal}</div>
          <div class="list-sub">${lotText} · edit</div>
        </div>
      </button>
      ${editorHtml}
    `;
  }).join('');
}

function buildJurnalEditor() {
  const row = appState.jurnalData[appState.editingJurnalIndex];
  if (!row) return '';

  const jenis = String(row[1] || '').toUpperCase();
  const isStock = ['BELI', 'JUAL'].includes(jenis);
  const selectedDate = formatDateForInput(row[0]);

  return `
    <div class="editor-card">
      <div class="editor-head">
        <div>
          <div class="panel-title">Edit transaksi</div>
          <div class="list-sub">Perubahan di sini akan langsung mengubah sheet JURNAL.</div>
        </div>
        <button type="button" class="ghost-btn editor-close" onclick="closeJurnalEditor()">Tutup</button>
      </div>

      <div class="field-block">
        <label class="field-label" for="edit-tanggal">Tanggal</label>
        <input id="edit-tanggal" class="field-input" type="date" value="${selectedDate}">
      </div>

      <div class="field-block">
        <label class="field-label" for="edit-jenis">Jenis transaksi</label>
        <select id="edit-jenis" class="field-input" onchange="toggleJurnalEditorFields()">
          ${TRANSACTION_TYPES.map((type) => `
            <option value="${type.value}" ${type.value === jenis ? 'selected' : ''}>${type.value}</option>
          `).join('')}
        </select>
      </div>

      <div class="field-block">
        <label class="field-label" for="edit-kode">Kode / keterangan</label>
        <input id="edit-kode" class="field-input" type="text" value="${row[2] || ''}" autocapitalize="characters">
      </div>

      <div id="edit-stock-fields" class="field-row" style="${isStock ? '' : 'display:none'}">
        <div>
          <label class="field-label" for="edit-harga">Harga</label>
          <input id="edit-harga" class="field-input" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" data-raw="${parseAngka(row[3]) || ''}" value="${formatInputThousands(parseAngka(row[3]) || '')}">
        </div>
        <div>
          <label class="field-label" for="edit-lot">Lot</label>
          <input id="edit-lot" class="field-input" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" data-raw="${parseAngka(row[4]) || ''}" value="${formatInputThousands(parseAngka(row[4]) || '')}">
        </div>
      </div>

      <div id="edit-nominal-fields" class="field-block" style="${isStock ? 'display:none' : ''}">
        <label class="field-label" for="edit-nominal">Nominal</label>
        <input id="edit-nominal" class="field-input" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" data-raw="${parseAngka(row[3]) || ''}" value="${formatInputThousands(parseAngka(row[3]) || '')}">
      </div>

      <div class="preview-box preview-box-soft">
        <div class="preview-title">Preview edit</div>
        <div class="preview-help">Ringkasan ini membantu Anda melihat dampak perubahan sebelum disimpan.</div>
        <div id="edit-warning-box" class="warning-box" style="display:none"></div>
        <div id="edit-preview-body"></div>
      </div>

      <div class="editor-actions">
        <button type="button" class="primary-btn block-btn" onclick="saveJurnalEditor()">Simpan perubahan</button>
        <button type="button" class="ghost-btn block-btn" onclick="closeJurnalEditor()">Batal</button>
        <button type="button" class="danger-btn block-btn" onclick="deleteJurnalEditor()">Hapus transaksi</button>
      </div>
    </div>
  `;
}

function openJurnalEditor(index) {
  appState.editingJurnalIndex = index;
  renderJurnal();
  bindJurnalEditorInputs();
  updateJurnalEditorPreview();
  const editor = document.querySelector('.editor-card');
  editor?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeJurnalEditor() {
  appState.editingJurnalIndex = null;
  renderJurnal();
}

function toggleJurnalEditorFields() {
  const jenis = document.getElementById('edit-jenis')?.value || '';
  const isStock = ['BELI', 'JUAL'].includes(jenis);
  document.getElementById('edit-stock-fields').style.display = isStock ? 'grid' : 'none';
  document.getElementById('edit-nominal-fields').style.display = isStock ? 'none' : 'grid';
  updateJurnalEditorPreview();
}

function bindJurnalEditorInputs() {
  bindFormattedNumericInputs(['edit-harga', 'edit-lot', 'edit-nominal']);
  ['edit-tanggal', 'edit-jenis', 'edit-kode', 'edit-harga', 'edit-lot', 'edit-nominal'].forEach((id) => {
    const element = document.getElementById(id);
    if (!element || element.dataset.bound) return;
    element.addEventListener('input', updateJurnalEditorPreview);
    element.addEventListener('change', updateJurnalEditorPreview);
    element.dataset.bound = 'true';
  });
}

function updateJurnalEditorPreview() {
  if (appState.editingJurnalIndex === null) return;
  const preview = document.getElementById('edit-preview-body');
  const warning = document.getElementById('edit-warning-box');
  if (!preview) return;

  const jenis = document.getElementById('edit-jenis')?.value || '';
  const tanggal = document.getElementById('edit-tanggal')?.value || '';

  if (['BELI', 'JUAL'].includes(jenis)) {
    const original = appState.jurnalData[appState.editingJurnalIndex];
    const harga = getNumericInputValue('edit-harga');
    const lot = getNumericInputValue('edit-lot');
    const gross = calculateTradeNominal(harga, lot);
    const originalHarga = parseAngka(original[3]);
    const originalLot = parseAngka(original[4]);
    const originalGross = calculateTradeNominal(originalHarga, originalLot);
    const feeRate = jenis === 'JUAL' ? 0.0015 : 0.0015;
    const originalEstimasi = jenis === 'JUAL' ? originalGross * (1 - feeRate) : originalGross * (1 + feeRate);
    const estimasi = jenis === 'JUAL' ? gross * (1 - feeRate) : gross * (1 + feeRate);
    const meteraiState = getDailyMeteraiStateForEdit(appState.editingJurnalIndex, tanggal, gross);
    const kenaMaterai = isKenaMaterai(meteraiState.totalAfterCurrent);
    logMateraiEvaluation('preview edit transaksi', meteraiState, gross);

    let meteraiLabel = 'Belum kena';
    if (meteraiState.beaMeteraiExists) {
      meteraiLabel = 'Hari itu sudah punya bea meterai';
    } else if (kenaMaterai) {
      meteraiLabel = 'Edit ini akan memicu bea meterai';
    }

    if (warning) {
      if (!meteraiState.beaMeteraiExists && kenaMaterai) {
        warning.style.display = 'block';
        warning.innerHTML = 'Perhatian: setelah edit ini, total transaksi hari tersebut melewati Rp10.000.000 dan belum ada bea meterai. Tambahkan bea meterai secara manual.';
      } else {
        warning.style.display = 'none';
        warning.innerHTML = '';
      }
    }

    preview.innerHTML = `
      <div class="preview-row"><span>Harga</span><strong>${formatRp(originalHarga)} -> ${formatRp(harga)}</strong></div>
      <div class="preview-row"><span>Total lot</span><strong>${originalLot.toLocaleString('id-ID')} -> ${(parseAngka(lot)).toLocaleString('id-ID')}</strong></div>
      <div class="preview-row"><span>Estimasi nilai transaksi</span><strong>${formatRp(originalEstimasi)} -> ${formatRp(estimasi)}</strong></div>
      <div class="preview-row"><span>Akumulasi beli/jual hari itu</span><strong>${formatRp(meteraiState.totalAfterCurrent)}</strong></div>
      <div class="preview-row"><span>Status bea meterai</span><strong>${meteraiLabel}</strong></div>
    `;
    return;
  }

  const nominal = getNumericInputValue('edit-nominal');
  if (warning) {
    warning.style.display = 'none';
    warning.innerHTML = '';
  }
  preview.innerHTML = `
    <div class="preview-row"><span>Nominal setelah edit</span><strong>${formatRp(nominal)}</strong></div>
    <div class="preview-row"><span>Tipe transaksi</span><strong>${jenis || '-'}</strong></div>
  `;
}

async function saveJurnalEditor() {
  if (appState.editingJurnalIndex === null) return;
  const transactionAllowed = await requireTransactionPin();
  if (!transactionAllowed) return;

  const original = appState.jurnalData[appState.editingJurnalIndex];
  const jenis = document.getElementById('edit-jenis').value;
  const payload = {
    origTanggal: original[0],
    origJenis: original[1],
    origKode: original[2],
    tanggal: formatDateForSheet(document.getElementById('edit-tanggal').value),
    jenis,
    kode: document.getElementById('edit-kode').value.trim() || jenis
  };

  if (['BELI', 'JUAL'].includes(jenis)) {
    payload.harga = getNumericInputValue('edit-harga') || '';
    payload.lot = getNumericInputValue('edit-lot') || '';
    if (!payload.kode || !payload.harga || !payload.lot) {
      alert('Lengkapi kode, harga, dan lot terlebih dahulu.');
      return;
    }
  } else {
    payload.harga = getNumericInputValue('edit-nominal') || '';
    payload.lot = '';
    if (!payload.harga) {
      alert('Nominal transaksi belum diisi.');
      return;
    }
  }

  try {
    await fetchJson('/api/jurnal-edit', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    alert('Transaksi berhasil diperbarui.');
    appState.editingJurnalIndex = null;
    await loadJurnal();
    await loadDashboard(true);
  } catch (error) {
    alert(error.message);
  }
}

async function deleteJurnalEditor() {
  if (appState.editingJurnalIndex === null) return;
  const original = appState.jurnalData[appState.editingJurnalIndex];
  if (!confirm('Yakin ingin menghapus transaksi ini dari JURNAL?')) return;
  const transactionAllowed = await requireTransactionPin();
  if (!transactionAllowed) return;

  try {
    await fetchJson('/api/jurnal-edit', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origTanggal: original[0],
        origJenis: original[1],
        origKode: original[2]
      })
    });
    alert('Transaksi berhasil dihapus.');
    appState.editingJurnalIndex = null;
    await loadJurnal();
    await loadDashboard(true);
  } catch (error) {
    alert(error.message);
  }
}

let selectedBulan = 'semua';

async function loadRiwayat() {
  statusBanner('riwayat-banner');
  const list = document.getElementById('riwayat-list');
  list.innerHTML = '<div class="loading-card">Memuat riwayat...</div>';
  try {
    const data = await fetchJson('/api/riwayat');
    appState.riwayatData = (data.rows || []).slice().reverse();
    buildMonthFilter();
    renderRiwayat();
  } catch (error) {
    list.innerHTML = `<div class="empty-card">${error.message}</div>`;
  }
}

function buildMonthFilter() {
  const keys = [...new Set(appState.riwayatData.map((row) => getMonthKey(row[0])).filter(Boolean))];
  const filter = document.getElementById('filter-bulan');
  const chips = ['semua', ...keys];
  filter.innerHTML = chips.map((key) => {
    const label = key === 'semua'
      ? 'Semua'
      : formatMonthKeyLabel(key, { month: 'short', year: 'numeric' });
    return `
      <button type="button" class="filter-chip ${key === selectedBulan ? 'active' : ''}" data-key="${key}">
        ${label}
      </button>
    `;
  }).join('');

  filter.querySelectorAll('.filter-chip').forEach((button) => {
    button.addEventListener('click', () => {
      selectedBulan = button.dataset.key;
      buildMonthFilter();
      renderRiwayat();
    });
  });
}

function renderRiwayat() {
  const filtered = selectedBulan === 'semua'
    ? appState.riwayatData
    : appState.riwayatData.filter((row) => getMonthKey(row[0]) === selectedBulan);

  const total = filtered.reduce((sum, row) => sum + parseSigned(row[3]), 0);
  document.getElementById('riwayat-summary').innerHTML = `
    <div class="summary-card">
      <div>
        <div class="summary-title">${selectedBulan === 'semua' ? 'Semua periode' : formatMonthKeyLabel(selectedBulan, { month: 'long', year: 'numeric' })}</div>
        <div class="summary-copy">${filtered.length} baris riwayat terealisasi</div>
      </div>
      <strong class="${toneClass(total)}">${formatRp(total)}</strong>
    </div>
  `;

  const list = document.getElementById('riwayat-list');
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-card">Tidak ada data pada periode ini.</div>';
    return;
  }

  list.innerHTML = filtered.map((row) => `
    <div class="list-row">
      <div>
        <div class="list-title">${row[1] || '-'}</div>
        <div class="list-sub">${formatTanggal(row[0])} · ${row[2] || '-'}</div>
      </div>
      <div class="list-right">
        <div class="list-title ${toneClass(parseSigned(row[3]))}">${formatRp(parseSigned(row[3]))}</div>
      </div>
    </div>
  `).join('');
}

async function loadAnalytics() {
  statusBanner('analytics-banner');
  const target = document.getElementById('analytics-content');
  target.innerHTML = '<div class="loading-card">Memuat performance...</div>';

  try {
    const [riwayatData, trackerData] = await Promise.all([
      fetchJson('/api/riwayat'),
      fetchJson('/api/tracker')
    ]);
    renderAnalytics(riwayatData.rows || [], trackerData.rows || [], extractTrackerHelperRows(trackerData));
  } catch (error) {
    target.innerHTML = `<div class="empty-card">${error.message}</div>`;
  }
}

function extractTrackerHelperRows(trackerPayload) {
  if (!trackerPayload || typeof trackerPayload !== 'object') return [];
  return trackerPayload.trackerHelper
    || trackerPayload.tracker_helper
    || trackerPayload.helperRows
    || trackerPayload.rowsTrackerHelper
    || [];
}

function normalizeTrackerHelperRows(rows) {
  return (rows || [])
    .map((row) => {
      const rawDate = row && row.date;
      const parsedDate = parseDate(rawDate);
      const cumIhsg = parseDecimalCumulative(row && row.cumIHSG);
      const cumPorto = parseDecimalCumulative(row && row.cumPorto);
      const movementValue = parseSigned(row && row.movement);

      console.log('[TRACKER_HELPER DATE PARSE]', {
        originalDateString: rawDate,
        parsedDateObject: parsedDate || null,
        isValid: Boolean(parsedDate)
      });

      if (!parsedDate || cumIhsg === null || cumPorto === null) return null;
      return {
        date: parsedDate,
        dateLabel: rawDate,
        monthKey: row && row.monthKey,
        realizedAcc: row && row.realizedAcc,
        unrealized: row && row.unrealized,
        movement: row && row.movement,
        movementValue: Number.isFinite(movementValue) ? movementValue : 0,
        realizedDaily: row && row.realizedDaily,
        portoGrowthDaily: row && row.portoGrowthDaily,
        ihsgDaily: row && row.ihsgDaily,
        alphaDaily: row && row.alphaDaily,
        realizedMonthly: row && row.realizedMonthly,
        portoGrowthMonthly: row && row.portoGrowthMonthly,
        ihsgMonthly: row && row.ihsgMonthly,
        alphaMonthly: row && row.alphaMonthly,
        cumIhsg,
        cumPorto
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date - b.date)
    .filter((row) => row.date >= TRACKER_CUTOFF_DATE);
}

function resolveAnalyticsDateRange(rows, preset, customStart, customEnd) {
  if (!rows.length) return null;

  const earliestDate = rows[0].date;
  const latestDate = rows[rows.length - 1].date;
  let startDate = earliestDate;
  let endDate = latestDate;

  if (preset === 'custom') {
    const parsedStart = normalizeDateOnly(customStart);
    const parsedEnd = normalizeDateOnly(customEnd);
    startDate = parsedStart || earliestDate;
    endDate = parsedEnd || latestDate;
  } else if (preset === '1w') {
    startDate = addDays(latestDate, -6);
  } else if (preset === '1m') {
    startDate = addMonths(latestDate, -1);
  } else if (preset === '3m') {
    startDate = addMonths(latestDate, -3);
  } else if (preset === 'ytd') {
    startDate = new Date(latestDate.getFullYear(), 0, 1);
  } else if (preset === '1y') {
    startDate = addYears(latestDate, -1);
  }

  if (startDate < earliestDate) startDate = earliestDate;
  if (endDate > latestDate) endDate = latestDate;

  if (startDate > endDate) {
    return {
      startDate,
      endDate,
      filteredRows: []
    };
  }

  const filteredRows = rows.filter((row) => row.date >= startDate && row.date <= endDate);
  return {
    startDate,
    endDate,
    filteredRows
  };
}

function reindexTrackerSeries(filteredRows) {
  if (!filteredRows.length) return [];
  const startPorto = filteredRows[0].cumPorto;
  const startIhsg = filteredRows[0].cumIhsg;

  return filteredRows.map((row) => ({
    ...row,
    reindexedPorto: (1 + row.cumPorto) / (1 + startPorto) - 1,
    reindexedIhsg: (1 + row.cumIhsg) / (1 + startIhsg) - 1
  }));
}

function buildAnalyticsChartState(rows, preset, customStart, customEnd) {
  const range = resolveAnalyticsDateRange(rows, preset, customStart, customEnd);
  if (!range || !range.filteredRows.length) {
    return {
      summary: null,
      series: [],
      error: 'Tidak ada data TRACKER_HELPER pada rentang tanggal tersebut.'
    };
  }

  const reindexedRows = reindexTrackerSeries(range.filteredRows);
  const lastRow = reindexedRows[reindexedRows.length - 1];

  return {
    summary: {
      periodReturn: lastRow.reindexedPorto,
      alpha: lastRow.reindexedPorto - lastRow.reindexedIhsg,
      startDate: reindexedRows[0].date,
      endDate: lastRow.date
    },
    series: reindexedRows,
    error: ''
  };
}

function getActiveTrackerHelperRows() {
  const range = resolveAnalyticsDateRange(
    appState.analyticsTrackerHelperRows,
    appState.analyticsRangePreset,
    appState.analyticsCustomStart,
    appState.analyticsCustomEnd
  );

  return range && range.filteredRows ? range.filteredRows : [];
}

function getActiveDateRangeForPerformance() {
  const trackerRange = resolveAnalyticsDateRange(
    appState.analyticsTrackerHelperRows,
    appState.analyticsRangePreset,
    appState.analyticsCustomStart,
    appState.analyticsCustomEnd
  );

  if (trackerRange && trackerRange.filteredRows && trackerRange.filteredRows.length) {
    return {
      startDate: trackerRange.filteredRows[0].date,
      endDate: trackerRange.filteredRows[trackerRange.filteredRows.length - 1].date
    };
  }

  const customStart = normalizeDateOnly(appState.analyticsCustomStart);
  const customEnd = normalizeDateOnly(appState.analyticsCustomEnd);
  return {
    startDate: customStart,
    endDate: customEnd
  };
}

function filterRiwayatTradesForPerformance(rows) {
  const { startDate, endDate } = getActiveDateRangeForPerformance();

  return (rows || [])
    .map((row) => {
      const date = parseDate(row && row[0]);
      const jenis = String(row && row[2] || '').trim().toUpperCase();
      const value = parseSigned(row && row[3]);

      if (!date || jenis !== 'JUAL') return null;
      if (startDate && date < startDate) return null;
      if (endDate && date > endDate) return null;

      return {
        date,
        kode: row[1] || '-',
        value,
        rawValue: row[3] || '-'
      };
    })
    .filter(Boolean);
}

function calculateTradingMetrics(rows) {
  const totalTrade = rows.length;
  if (!totalTrade) {
    return {
      totalTrade: '-',
      winCount: '0',
      loseCount: '0',
      winRate: '-',
      profitFactor: '-',
      maxProfit: '-',
      avgProfit: '-',
      maxLoss: '-',
      avgLoss: '-',
      topGainer: '-',
      topLoser: '-'
    };
  }

  const nonZeroTrades = rows.filter((row) => row.value !== 0);
  const positiveTrades = nonZeroTrades.filter((row) => row.value > 0);
  const negativeTrades = nonZeroTrades.filter((row) => row.value < 0);

  const grossProfit = positiveTrades.reduce((sum, row) => sum + row.value, 0);
  const grossLossAbs = Math.abs(negativeTrades.reduce((sum, row) => sum + row.value, 0));
  const maxProfitTrade = positiveTrades.length
    ? positiveTrades.reduce((best, row) => (row.value > best.value ? row : best))
    : null;
  const maxLossTrade = negativeTrades.length
    ? negativeTrades.reduce((worst, row) => (row.value < worst.value ? row : worst))
    : null;

  let profitFactor = '-';
  if (positiveTrades.length && !negativeTrades.length) {
    profitFactor = '∞';
  } else if (grossLossAbs > 0) {
    profitFactor = (grossProfit / grossLossAbs).toFixed(2);
  }

  let winRate = '-';
  if (nonZeroTrades.length) {
    winRate = `${Math.round((positiveTrades.length / nonZeroTrades.length) * 100)}%`;
  }

  return {
    totalTrade: totalTrade.toLocaleString('id-ID'),
    winCount: positiveTrades.length.toLocaleString('id-ID'),
    loseCount: negativeTrades.length.toLocaleString('id-ID'),
    winRate,
    profitFactor,
    maxProfit: maxProfitTrade ? formatRp(maxProfitTrade.value) : '-',
    avgProfit: positiveTrades.length ? formatRp(grossProfit / positiveTrades.length) : '-',
    maxLoss: maxLossTrade ? formatRp(maxLossTrade.value) : '-',
    avgLoss: negativeTrades.length
      ? formatRp(negativeTrades.reduce((sum, row) => sum + row.value, 0) / negativeTrades.length)
      : '-',
    topGainer: maxProfitTrade ? `${maxProfitTrade.kode} · ${formatRp(maxProfitTrade.value)}` : '-',
    topLoser: maxLossTrade ? `${maxLossTrade.kode} · ${formatRp(maxLossTrade.value)}` : '-'
  };
}

function buildTopTradeLists(rows) {
  const positiveTrades = rows
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
  const negativeTrades = rows
    .filter((row) => row.value < 0)
    .sort((a, b) => a.value - b.value);

  return {
    gainers: positiveTrades,
    losers: negativeTrades
  };
}

function renderTradeRankList(trades, kind, expanded) {
  if (!trades.length) {
    return '<div class="rank-empty">-</div>';
  }

  const visibleTrades = expanded ? trades : trades.slice(0, 3);
  const toneClassName = kind === 'gainer' ? 'performance-positive' : 'performance-negative';
  const toggleLabel = expanded ? 'Show Top 3' : 'Show All';

  return `
    <div class="rank-list-wrap">
      <div class="rank-list">
        ${visibleTrades.map((trade, index) => `
          <div class="rank-item">
            <span class="rank-index">${index + 1}.</span>
            <span class="rank-name">${trade.kode}</span>
            <strong class="${toneClassName}">${formatRp(trade.value)}</strong>
          </div>
        `).join('')}
      </div>
      ${trades.length > 3 ? `
        <button
          type="button"
          class="ghost-btn rank-toggle-btn"
          data-rank-toggle="${kind}"
        >
          ${toggleLabel}
        </button>
      ` : ''}
    </div>
  `;
}

function renderTradingMetricsCards(riwayatRows) {
  const target = document.getElementById('trading-metrics-content');
  if (!target) return;

  const trades = filterRiwayatTradesForPerformance(riwayatRows);
  const metrics = calculateTradingMetrics(trades);
  const topTradeLists = buildTopTradeLists(trades);

  target.innerHTML = `
    <div class="trading-group">
      <div class="panel-kicker">Overview</div>
      <div class="metric-grid trading-metrics-grid">
        <div class="metric-card">
          <span class="metric-label">Total Trade</span>
          <strong>${metrics.totalTrade}</strong>
          <div class="metric-copy">Win ${metrics.winCount} · Lose ${metrics.loseCount}</div>
        </div>
        <div class="metric-card">
          <span class="metric-label">Win Rate</span>
          <strong>${metrics.winRate}</strong>
        </div>
        <div class="metric-card">
          <span class="metric-label">Profit Factor</span>
          <strong>${metrics.profitFactor}</strong>
        </div>
      </div>
    </div>

    <div class="trading-group">
      <div class="panel-kicker">Profit</div>
      <div class="metric-grid trading-metrics-grid">
        <div class="metric-card">
          <span class="metric-label">Max Profit</span>
          <strong class="${metrics.maxProfit === '-' ? '' : 'performance-positive'}">${metrics.maxProfit}</strong>
        </div>
        <div class="metric-card">
          <span class="metric-label">Avg Profit</span>
          <strong class="${metrics.avgProfit === '-' ? '' : 'performance-positive'}">${metrics.avgProfit}</strong>
        </div>
        <div class="metric-card metric-card-list">
          <span class="metric-label">Top Realized Gainer</span>
          ${renderTradeRankList(topTradeLists.gainers, 'gainer', appState.performanceShowAllGainers)}
        </div>
      </div>
    </div>

    <div class="trading-group">
      <div class="panel-kicker">Loss</div>
      <div class="metric-grid trading-metrics-grid">
        <div class="metric-card">
          <span class="metric-label">Max Loss</span>
          <strong class="${metrics.maxLoss === '-' ? '' : 'performance-negative'}">${metrics.maxLoss}</strong>
        </div>
        <div class="metric-card">
          <span class="metric-label">Avg Loss</span>
          <strong class="${metrics.avgLoss === '-' ? '' : 'performance-negative'}">${metrics.avgLoss}</strong>
        </div>
        <div class="metric-card metric-card-list">
          <span class="metric-label">Top Realized Loser</span>
          ${renderTradeRankList(topTradeLists.losers, 'loser', appState.performanceShowAllLosers)}
        </div>
      </div>
    </div>
  `;

  bindTradingMetricsControls();
}

function buildDailyPerformanceRows(rows) {
  if (!rows.length) return [];

  return rows.map((row, index) => {
    const previousRow = rows[index - 1];
    const movementDelta = previousRow ? row.movementValue - previousRow.movementValue : null;

    return {
      tanggal: row.dateLabel,
      realizedToday: row.realizedDaily || '',
      realizedAcc: row.realizedAcc || '',
      unrealized: row.unrealized || '',
      movement: row.movement || '',
      movementDelta,
      portoGrowth: row.portoGrowthDaily || '',
      ihsg: row.ihsgDaily || '',
      alpha: row.alphaDaily || ''
    };
  });
}

function buildMonthlyPerformanceRows(rows) {
  if (!rows.length) return [];

  const monthlyRows = rows.filter((row, index) => {
    const nextRow = rows[index + 1];
    return !nextRow || nextRow.monthKey !== row.monthKey;
  });

  return monthlyRows.map((row, index) => {
    const previousRow = monthlyRows[index - 1];
    const movementDelta = previousRow ? row.movementValue - previousRow.movementValue : null;

    return {
      tanggal: row.dateLabel,
      realizedMonth: row.realizedMonthly || '',
      realizedAcc: row.realizedAcc || '',
      unrealized: row.unrealized || '',
      movement: row.movement || '',
      movementDelta,
      portoGrowth: row.portoGrowthMonthly || '',
      ihsg: row.ihsgMonthly || '',
      alpha: row.alphaMonthly || ''
    };
  });
}

function renderPerformanceTable() {
  const target = document.getElementById('performance-table-content');
  const activeRows = getActiveTrackerHelperRows();

  document.querySelectorAll('[data-performance-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.performanceView === appState.performanceTableView);
  });

  if (!target) return;
  if (!activeRows.length) {
    target.innerHTML = '<div class="empty-card">Tidak ada data performance pada rentang tanggal tersebut.</div>';
    return;
  }

  const isDailyView = appState.performanceTableView === 'daily';
  const tableRows = isDailyView
    ? buildDailyPerformanceRows(activeRows)
    : buildMonthlyPerformanceRows(activeRows);
  const renderedRows = [...tableRows].reverse();
  const visibleRows = appState.performanceShowAllRows ? renderedRows : renderedRows.slice(0, 50);

  if (!renderedRows.length) {
    target.innerHTML = '<div class="empty-card">Tidak ada data performance pada rentang tanggal tersebut.</div>';
    return;
  }

  const headers = isDailyView
    ? ['Tanggal', 'Realized Today', 'Realized Acc', 'Unrealized', 'Movement', 'Movement Delta', '% Porto Growth', '% IHSG', 'Alpha']
    : ['Tanggal', 'Realized Month', 'Realized Acc', 'Unrealized', 'Movement', 'Movement Delta', '% Porto Growth', '% IHSG', 'Alpha'];

  const bodyHtml = visibleRows.map((row) => `
    <tr>
      <td>${row.tanggal || '-'}</td>
      <td class="${displayToneClass(row.realizedToday || row.realizedMonth)}">${row.realizedToday || row.realizedMonth || '-'}</td>
      <td class="${displayToneClass(row.realizedAcc)}">${row.realizedAcc || '-'}</td>
      <td class="${displayToneClass(row.unrealized)}">${row.unrealized || '-'}</td>
      <td class="${displayToneClass(row.movement)}">${row.movement || '-'}</td>
      <td class="${row.movementDelta === null ? 'performance-neutral' : displayToneClass(row.movementDelta)}">${row.movementDelta === null ? '-' : formatRp(row.movementDelta)}</td>
      <td class="${displayToneClass(row.portoGrowth)}">${row.portoGrowth || '-'}</td>
      <td class="${displayToneClass(row.ihsg)}">${row.ihsg || '-'}</td>
      <td class="${displayToneClass(row.alpha)}">${row.alpha || '-'}</td>
    </tr>
  `).join('');

  target.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr>
        </thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>
    ${renderedRows.length > 50 ? `
      <button type="button" class="ghost-btn table-toggle-btn" id="performance-table-toggle">
        ${appState.performanceShowAllRows ? 'Show Top 50' : 'Show All'}
      </button>
    ` : ''}
  `;

  document.getElementById('performance-table-toggle')?.addEventListener('click', () => {
    appState.performanceShowAllRows = !appState.performanceShowAllRows;
    renderPerformanceTable();
  });
}

function renderAnalyticsEquityChart() {
  const summaryTarget = document.getElementById('equity-summary');
  const state = buildAnalyticsChartState(
    appState.analyticsTrackerHelperRows,
    appState.analyticsRangePreset,
    appState.analyticsCustomStart,
    appState.analyticsCustomEnd
  );

  document.querySelectorAll('[data-analytics-range]').forEach((button) => {
    button.classList.toggle('active', button.dataset.analyticsRange === appState.analyticsRangePreset);
  });

  if (!summaryTarget) return;

  if (state.error) {
    summaryTarget.innerHTML = `<div class="empty-card">${state.error}</div>`;
    if (analyticsChart) {
      analyticsChart.destroy();
      analyticsChart = null;
    }
    return;
  }

  summaryTarget.innerHTML = `
    <div class="metric-grid analytics-summary-grid">
      <div class="metric-card">
        <span class="metric-label">Period Return</span>
        <strong class="${toneClass(state.summary.periodReturn)}">${formatReturnPct(state.summary.periodReturn)}</strong>
      </div>
      <div class="metric-card">
        <span class="metric-label">Alpha vs IHSG</span>
        <strong class="${toneClass(state.summary.alpha)}">${formatReturnPct(state.summary.alpha)}</strong>
      </div>
      <div class="metric-card">
        <span class="metric-label">Periode aktif</span>
        <strong>${formatTanggal(state.summary.startDate)} - ${formatTanggal(state.summary.endDate)}</strong>
      </div>
    </div>
  `;

  if (typeof Chart === 'undefined') {
    summaryTarget.insertAdjacentHTML('beforeend', '<div class="empty-card">Chart.js gagal dimuat.</div>');
    return;
  }

  const canvas = document.getElementById('equity-chart-canvas');
  if (!canvas) return;

  if (analyticsChart) {
    analyticsChart.destroy();
  }

  analyticsChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: state.series.map((row) => formatShortDate(
        row.date,
        shouldIncludeYearForChart(state.series)
      )),
      datasets: [
        {
          label: 'Portfolio',
          data: state.series.map((row) => row.reindexedPorto * 100),
          borderColor: '#0f766e',
          backgroundColor: 'rgba(15, 118, 110, 0.16)',
          borderWidth: 3,
          tension: 0.24,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: false
        },
        {
          label: 'IHSG',
          data: state.series.map((row) => row.reindexedIhsg * 100),
          borderColor: '#6b7280',
          backgroundColor: 'rgba(107, 114, 128, 0.12)',
          borderWidth: 2,
          tension: 0.24,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: true,
          labels: {
            usePointStyle: true,
            boxWidth: 10
          }
        },
        tooltip: {
          callbacks: {
            title(items) {
              const row = state.series[items[0].dataIndex];
              return formatTanggal(row.date);
            },
            label(context) {
              return `${context.dataset.label}: ${formatPct(context.parsed.y)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            minRotation: 45,
            maxRotation: 45,
            autoSkip: true,
            maxTicksLimit: state.series.length > 36 ? 8 : 12
          }
        },
        y: {
          ticks: {
            callback(value) {
              return `${value}%`;
            }
          }
        }
      }
    }
  });
}

function bindAnalyticsControls() {
  document.querySelectorAll('[data-analytics-range]').forEach((button) => {
    if (button.dataset.bound) return;
    button.addEventListener('click', () => {
      appState.analyticsRangePreset = button.dataset.analyticsRange;
      appState.performanceShowAllRows = false;
      renderAnalyticsEquityChart();
      renderTradingMetricsCards(appState.riwayatData);
      renderPerformanceTable();
    });
    button.dataset.bound = 'true';
  });

  const customStart = document.getElementById('analytics-custom-start');
  const customEnd = document.getElementById('analytics-custom-end');
  const customApply = document.getElementById('analytics-custom-apply');

  if (customStart) customStart.value = appState.analyticsCustomStart;
  if (customEnd) customEnd.value = appState.analyticsCustomEnd;

  if (customApply && !customApply.dataset.bound) {
    customApply.addEventListener('click', () => {
      appState.analyticsCustomStart = customStart?.value || '';
      appState.analyticsCustomEnd = customEnd?.value || '';
      appState.analyticsRangePreset = 'custom';
      appState.performanceShowAllRows = false;
      renderAnalyticsEquityChart();
      renderTradingMetricsCards(appState.riwayatData);
      renderPerformanceTable();
    });
    customApply.dataset.bound = 'true';
  }

  document.querySelectorAll('[data-performance-view]').forEach((button) => {
    if (button.dataset.bound) return;
    button.addEventListener('click', () => {
      appState.performanceTableView = button.dataset.performanceView;
      appState.performanceShowAllRows = false;
      renderPerformanceTable();
    });
    button.dataset.bound = 'true';
  });
}

function bindTradingMetricsControls() {
  document.querySelectorAll('[data-rank-toggle]').forEach((button) => {
    if (button.dataset.bound) return;
    button.addEventListener('click', () => {
      if (button.dataset.rankToggle === 'gainer') {
        appState.performanceShowAllGainers = !appState.performanceShowAllGainers;
      }
      if (button.dataset.rankToggle === 'loser') {
        appState.performanceShowAllLosers = !appState.performanceShowAllLosers;
      }
      renderTradingMetricsCards(appState.riwayatData);
    });
    button.dataset.bound = 'true';
  });
}

function renderAnalytics(riwayat, tracker, trackerHelperRows) {
  appState.riwayatData = riwayat;
  appState.analyticsTrackerHelperRows = normalizeTrackerHelperRows(trackerHelperRows);

  document.getElementById('analytics-content').innerHTML = `
    <div class="panel">
      <div class="panel-title">Filter Waktu</div>
      <div class="chart-toolbar">
        <div class="filter-scroll">
          ${ANALYTICS_RANGE_PRESETS.map((item) => `
            <button
              type="button"
              class="filter-chip ${item.key === appState.analyticsRangePreset ? 'active' : ''}"
              data-analytics-range="${item.key}"
            >
              ${item.label}
            </button>
          `).join('')}
        </div>
        <div class="chart-range-grid">
          <div class="field-block">
            <label class="field-label" for="analytics-custom-start">Mulai</label>
            <input id="analytics-custom-start" class="field-input" type="date">
          </div>
          <div class="field-block">
            <label class="field-label" for="analytics-custom-end">Selesai</label>
            <input id="analytics-custom-end" class="field-input" type="date">
          </div>
          <button id="analytics-custom-apply" class="ghost-btn chart-apply-btn" type="button">Terapkan</button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Trading Performance Metrics</div>
      <div id="trading-metrics-content" class="page-stack"></div>
    </div>

    <div class="panel">
      <div class="panel-title">Equity curve vs IHSG</div>
      <div id="equity-summary" class="page-stack"></div>
      <div class="chart-card">
        <canvas id="equity-chart-canvas"></canvas>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Performance Table</div>
      <div class="filter-scroll">
        <button
          type="button"
          class="filter-chip ${appState.performanceTableView === 'daily' ? 'active' : ''}"
          data-performance-view="daily"
        >
          Daily View
        </button>
        <button
          type="button"
          class="filter-chip ${appState.performanceTableView === 'monthly' ? 'active' : ''}"
          data-performance-view="monthly"
        >
          Monthly View
        </button>
      </div>
      <div id="performance-table-content" class="page-stack"></div>
    </div>

    <div class="info-card">
      <div class="info-title">Membaca performance</div>
      <p class="info-copy">
        Layar ini membantu Anda melihat ritme bulanan. Fokus utamanya bukan hanya menang atau kalah, tetapi apakah hasil bulanan makin stabil dari waktu ke waktu.
      </p>
    </div>
  `;

  bindAnalyticsControls();
  renderAnalyticsEquityChart();
  renderTradingMetricsCards(riwayat);
  renderPerformanceTable();
}

document.addEventListener('DOMContentLoaded', bootstrapApp);
