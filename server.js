const express = require('express');
const { google } = require('googleapis');
const dotenv = require('dotenv');
const cors = require('cors');
const demoData = require('./demo-data');
const rateLimit = require('express-rate-limit');

const pinLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 menit
  max: 5, // max 5 kali coba
  message: {
    error: 'Terlalu banyak percobaan PIN, coba lagi nanti'
  }
});

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET
);
oauth2Client.setCredentials({
  refresh_token: process.env.REFRESH_TOKEN
});

function isGoogleConfigured() {
  return Boolean(
    process.env.CLIENT_ID &&
    process.env.CLIENT_SECRET &&
    process.env.REFRESH_TOKEN &&
    process.env.SPREADSHEET_ID
  );
}

function parseNumeric(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  return parseFloat(cleaned) || 0;
}

function formatDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function normalizeDateKey(value) {
  if (!value) return '';
  if (typeof value === 'number' && value > 1000) {
    const excelEpoch = new Date(1899, 11, 30);
    excelEpoch.setDate(excelEpoch.getDate() + value);
    return formatDateKey(excelEpoch);
  }

  const raw = String(value).trim();
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return formatDateKey(direct);
  }

  const months = {
    jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, jun: 5,
    jul: 6, agu: 7, sep: 8, okt: 9, nov: 10, des: 11, dec: 11
  };
  const match = raw.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[\s-](\d{2,4})$/);
  if (!match) return raw;

  const day = Number(match[1]);
  const month = months[match[2].toLowerCase()];
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  if (month === undefined) return raw;
  const parsed = new Date(year, month, day);
  return formatDateKey(parsed);
}

function calculateTradeNominal(harga, lot) {
  const parsedHarga = parseNumeric(harga);
  const parsedLot = parseNumeric(lot);
  return parsedHarga * parsedLot * 100;
}

function getSheets() {
  return google.sheets({ version: 'v4', auth: oauth2Client });
}

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

function isDemoMode(forceDemo) {
  if (forceDemo === '1') return true;
  if (!isGoogleConfigured()) return true;
  return false;
}

app.post('/api/verify-pin', pinLimiter, (req, res) => {
  const providedPin = String(req.headers['x-app-pin'] || '');
  const isValid = Boolean(process.env.APP_PIN) && providedPin === process.env.APP_PIN;

  console.log('[PIN VERIFY]', {
    hasPinInBody: Boolean(providedPin),
    providedLength: providedPin.length,
    isValid,
    at: new Date().toISOString()
  });

  if (!isValid) {
    return res.status(401).json({ success: false, error: 'PIN tidak valid.' });
  }

  res.json({ success: true });
});

app.use('/api', (req, res, next) => {
  if (req.path === '/verify-pin') {
    return next();
  }

  const providedPin = req.headers['x-app-pin'];
  const isValid = Boolean(process.env.APP_PIN) && providedPin === process.env.APP_PIN;

  console.log('[API AUTH]', {
    method: req.method,
    path: req.originalUrl,
    hasHeaderPin: Boolean(providedPin),
    providedLength: typeof providedPin === 'string' ? providedPin.length : 0,
    isValid,
    at: new Date().toISOString()
  });

  if (!isValid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
});

app.get('/api/bootstrap', (req, res) => {
  const configured = isGoogleConfigured();
  const loggedIn = configured;
  res.json({
    configured,
    loggedIn,
    demoMode: !configured,
    spreadsheetReady: Boolean(process.env.SPREADSHEET_ID)
  });
});

app.get('/api/dashboard', async (req, res) => {
  if (isDemoMode(req.query.demo)) {
    return res.json({
      source: 'demo',
      dashboard: demoData.dashboard,
      portfolio: demoData.portfolio
    });
  }
  try {
    const sheets = getSheets();
    const [dashboard, portfolio] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'DASHBOARD!A1:G25'
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'PORTOFOLIO!A1:G20'
      })
    ]);
    res.json({
      source: 'live',
      dashboard: dashboard.data.values,
      portfolio: portfolio.data.values
    });
  } catch (e) {
    res.status(500).json({ error: e.message, source: 'live' });
  }
});

app.get('/api/jurnal', async (req, res) => {
  if (isDemoMode(req.query.demo)) {
    return res.json({ source: 'demo', rows: demoData.jurnal });
  }
  try {
    const sheets = getSheets();
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'JURNAL!A2:E2000',
      valueRenderOption: 'FORMATTED_VALUE'
    });
    // Filter: hanya baris yang kolom A (TANGGAL) tidak kosong - tanggal pasti ada isinya
    const rows = (result.data.values || []).filter(r =>
      r && r[0] && r[0].toString().trim() !== ''
    );
    res.json({ source: 'live', rows });
  } catch (e) {
    res.status(500).json({ error: e.message, source: 'live' });
  }
});

app.get('/api/riwayat', async (req, res) => {
  if (isDemoMode(req.query.demo)) {
    return res.json({ source: 'demo', rows: demoData.riwayat });
  }
  try {
    const sheets = getSheets();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'RIWAYAT!A:D'
    });
    const rows = response.data.values || [];
    const dataRows = rows.slice(1).filter(r => r[0] && r[0].toString().trim() !== '');
    res.json({ source: 'live', rows: dataRows });
  } catch (e) {
    res.status(500).json({ error: e.message, source: 'live' });
  }
});

app.get('/api/tracker', async (req, res) => {
  if (isDemoMode(req.query.demo)) {
    return res.json({ source: 'demo', rows: demoData.tracker });
  }
  try {
    const sheets = getSheets();
    const [formattedTrackerHelperResult, numericTrackerHelperResult] = await Promise.all([
      sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
        ranges: [
          'TRACKER_HELPER!B2:B2000',
          'TRACKER_HELPER!C2:C2000',
          'TRACKER_HELPER!D2:F2000',
          'TRACKER_HELPER!J2:J2000',
          'TRACKER_HELPER!L2:N2000',
          'TRACKER_HELPER!Q2:Q2000',
          'TRACKER_HELPER!S2:U2000'
        ],
        valueRenderOption: 'FORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING'
      }),
      sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
        ranges: ['TRACKER_HELPER!B2:B2000', 'TRACKER_HELPER!O2:P2000'],
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING'
      })
    ]);

    const formattedRanges = formattedTrackerHelperResult.data.valueRanges || [];
    const formattedDateRows = (formattedRanges[0] && formattedRanges[0].values) || [];
    const formattedMonthKeyRows = (formattedRanges[1] && formattedRanges[1].values) || [];
    const formattedCoreMetricRows = (formattedRanges[2] && formattedRanges[2].values) || [];
    const formattedDailyRealizedRows = (formattedRanges[3] && formattedRanges[3].values) || [];
    const formattedDailyPctRows = (formattedRanges[4] && formattedRanges[4].values) || [];
    const formattedMonthlyRealizedRows = (formattedRanges[5] && formattedRanges[5].values) || [];
    const formattedMonthlyPctRows = (formattedRanges[6] && formattedRanges[6].values) || [];

    // Pindah ke sini agar bisa dipakai bersama oleh rows dan trackerHelper
    const numericRanges = numericTrackerHelperResult.data.valueRanges || [];
    const dateRows = (numericRanges[0] && numericRanges[0].values) || [];
    const cumulativeRows = (numericRanges[1] && numericRanges[1].values) || [];

    // Filter sama dengan trackerHelper: wajib ada tanggal + cumIHSG + cumPorto
    const rows = formattedDateRows.map((dateRow, index) => {
      const metricRow = formattedCoreMetricRows[index] || [];
      const cumulativeRow = cumulativeRows[index] || [];
      const date = dateRow && dateRow[0];
      const cumIHSG = cumulativeRow[0];
      const cumPorto = cumulativeRow[1];

      if (
        date === null || date === undefined || String(date).trim() === '' ||
        cumIHSG === null || cumIHSG === undefined || cumIHSG === '' ||
        cumPorto === null || cumPorto === undefined || cumPorto === ''
      ) {
        return null;
      }

      return [
        date,
        metricRow[0] || '',
        metricRow[1] || '',
        metricRow[2] || ''
      ];
    }).filter(Boolean);

    const trackerHelper = dateRows.map((dateRow, index) => {
      const formattedMonthKeyRow = formattedMonthKeyRows[index] || [];
      const formattedCoreMetricRow = formattedCoreMetricRows[index] || [];
      const formattedDailyRealizedRow = formattedDailyRealizedRows[index] || [];
      const formattedDailyPctRow = formattedDailyPctRows[index] || [];
      const formattedMonthlyRealizedRow = formattedMonthlyRealizedRows[index] || [];
      const formattedMonthlyPctRow = formattedMonthlyPctRows[index] || [];
      const cumulativeRow = cumulativeRows[index] || [];
      const date = dateRow && dateRow[0];
      const cumIHSG = cumulativeRow[0];
      const cumPorto = cumulativeRow[1];

      if (
        date === null || date === undefined || String(date).trim() === '' ||
        cumIHSG === null || cumIHSG === undefined || cumIHSG === '' ||
        cumPorto === null || cumPorto === undefined || cumPorto === ''
      ) {
        return null;
      }

      return {
        date,
        monthKey: formattedMonthKeyRow[0] || '',
        realizedAcc: formattedCoreMetricRow[0] || '',
        unrealized: formattedCoreMetricRow[1] || '',
        movement: formattedCoreMetricRow[2] || '',
        realizedDaily: formattedDailyRealizedRow[0] || '',
        portoGrowthDaily: formattedDailyPctRow[0] || '',
        ihsgDaily: formattedDailyPctRow[1] || '',
        alphaDaily: formattedDailyPctRow[2] || '',
        realizedMonthly: formattedMonthlyRealizedRow[0] || '',
        portoGrowthMonthly: formattedMonthlyPctRow[0] || '',
        ihsgMonthly: formattedMonthlyPctRow[1] || '',
        alphaMonthly: formattedMonthlyPctRow[2] || '',
        cumIHSG: Number(cumIHSG),
        cumPorto: Number(cumPorto)
      };
    });

    res.json({
      source: 'live',
      rows,
      trackerHelper: trackerHelper.filter((row) =>
        row &&
        !Number.isNaN(row.cumIHSG) &&
        !Number.isNaN(row.cumPorto)
      )
    });
  } catch (e) {
    res.status(500).json({ error: e.message, source: 'live' });
  }
});

// Cari baris setelah data terakhir di JURNAL
// Baca kolom A (TANGGAL) dengan FORMATTED_VALUE - tanggal pasti ada teks, baris kosong benar2 kosong
async function findFirstEmptyRow(sheets) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'JURNAL!A2:A2000',
    valueRenderOption: 'FORMATTED_VALUE'
  });
  const rows = result.data.values || [];
  // Cari index TERAKHIR yang ada isinya (tanggal tidak kosong)
  let lastFilledIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const val = rows[i] && rows[i][0];
    if (val && val.toString().trim() !== '') {
      lastFilledIdx = i;
    }
  }
  // lastFilledIdx adalah 0-based index dari A2, jadi row excel = lastFilledIdx + 2
  // baris berikutnya = lastFilledIdx + 2 + 1
  return lastFilledIdx + 3;
}

async function getDailyTradeState(sheets, tanggal, currentTradeNominal = 0) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'JURNAL!A2:E2000',
    valueRenderOption: 'FORMATTED_VALUE'
  });

  const targetDateKey = normalizeDateKey(tanggal);
  const rows = result.data.values || [];
  let totalTradeNominal = 0;
  let beaMeteraiExists = false;

  rows.forEach((row) => {
    if (!row || !row[0]) return;
    if (normalizeDateKey(row[0]) !== targetDateKey) return;

    const jenis = (row[1] || '').toString().trim().toUpperCase();
    if (jenis === 'BEA METERAI') {
      beaMeteraiExists = true;
      return;
    }

    if (jenis === 'BELI' || jenis === 'JUAL') {
      totalTradeNominal += calculateTradeNominal(row[3], row[4]);
    }
  });

  console.log('[BEA METERAI BACKEND]', {
    tanggal,
    targetDateKey,
    nilaiTransaksiTerakhir: currentTradeNominal,
    totalHarianDariSheet: totalTradeNominal,
    kenaMaterai: totalTradeNominal >= 10000000,
    beaMeteraiExists
  });

  return {
    totalTradeNominal,
    beaMeteraiExists
  };
}

app.post('/api/transaksi', async (req, res) => {
  console.log('[API CALL] POST /api/transaksi', {
    bodyKeys: Object.keys(req.body || {}),
    at: new Date().toISOString()
  });
  if (isDemoMode(req.query.demo)) {
    return res.status(400).json({
      error: 'Mode demo hanya untuk melihat prototype. Login Google diperlukan untuk menyimpan transaksi ke sheet asli.'
    });
  }
  try {
    const sheets = getSheets();
    const { tanggal, jenis, kode, harga, lot, totalLembar, nilaiBersih, realizedPL, posisiStok, idUrut } = req.body;

    const emptyRow = await findFirstEmptyRow(sheets);

    // BELI/JUAL: isi A (tanggal), B (jenis), C (kode), D (harga), E (lot) SAJA
    // TOP UP/TARIK/DIVIDEN/BEA METERAI: isi A, B, C (keterangan), D (nominal) SAJA
    // Kolom F dst sudah ada formula di sheet, jangan diisi
    let row, endCol;
    if (['BELI', 'JUAL'].includes(jenis)) {
      row = [tanggal, jenis, kode, harga, lot];
      endCol = 'E';
    } else {
      row = [tanggal, jenis, kode || jenis, harga];
      endCol = 'D';
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `JURNAL!A${emptyRow}:${endCol}${emptyRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] }
    });

    // Auto bea meterai - cek akumulasi BELI + JUAL dalam hari yang sama.
    // Jika total transaksi harian sudah >= 10 juta, tambahkan BEA METERAI sekali saja.
    if (['BELI', 'JUAL'].includes(jenis)) {
      const currentTradeNominal = calculateTradeNominal(harga, lot);
      const dailyTradeState = await getDailyTradeState(sheets, tanggal, currentTradeNominal);

      if (dailyTradeState.totalTradeNominal >= 10000000 && !dailyTradeState.beaMeteraiExists) {
        const bmRow = emptyRow + 1;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `JURNAL!A${bmRow}:D${bmRow}`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [[tanggal, 'BEA METERAI', 'Bea Meterai', 10000]] }
        });
      }
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/transaksi/:rowIndex', async (req, res) => {
  console.log('[API CALL] PUT /api/transaksi/:rowIndex', {
    rowIndex: req.params.rowIndex,
    bodyKeys: Object.keys(req.body || {}),
    at: new Date().toISOString()
  });
  if (isDemoMode(req.query.demo)) {
    return res.status(400).json({ error: 'Edit transaksi dinonaktifkan di mode demo.' });
  }
  try {
    const sheets = getSheets();
    const rowIndex = parseInt(req.params.rowIndex) + 2;
    const { tanggal, jenis, kode, harga, lot, totalLembar, nilaiBersih, realizedPL, posisiStok, idUrut } = req.body;
    const row = [tanggal, jenis, kode, harga, lot, totalLembar, nilaiBersih, realizedPL, posisiStok, idUrut];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `JURNAL!A${rowIndex}:J${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] }
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/transaksi/:rowIndex', async (req, res) => {
  console.log('[API CALL] DELETE /api/transaksi/:rowIndex', {
    rowIndex: req.params.rowIndex,
    at: new Date().toISOString()
  });
  if (isDemoMode(req.query.demo)) {
    return res.status(400).json({ error: 'Hapus transaksi dinonaktifkan di mode demo.' });
  }
  try {
    const sheets = getSheets();
    const rowIndex = parseInt(req.params.rowIndex) + 2;

    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `JURNAL!A${rowIndex}:J${rowIndex}`
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Edit transaksi di RIWAYAT - cari row di JURNAL berdasarkan index RIWAYAT
// RIWAYAT hanya baca-saja, edit sebenarnya di JURNAL
// Kita cari baris JURNAL yang cocok berdasarkan posisi di RIWAYAT
app.put('/api/edit-riwayat/:riwayatIdx', async (req, res) => {
  console.log('[API CALL] PUT /api/edit-riwayat/:riwayatIdx', {
    riwayatIdx: req.params.riwayatIdx,
    bodyKeys: Object.keys(req.body || {}),
    at: new Date().toISOString()
  });
  if (isDemoMode(req.query.demo)) {
    return res.status(400).json({ error: 'Mode demo hanya untuk melihat tampilan riwayat.' });
  }
  try {
    const sheets = getSheets();
    const riwayatIdx = parseInt(req.params.riwayatIdx);
    const { tanggal, kode, jenis } = req.body;

    // Baca RIWAYAT untuk dapat data baris yang diedit
    const riwayat = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'RIWAYAT!A:D'
    });
    const rows = riwayat.data.values || [];
    const dataRows = rows.slice(1);
    const riwayatRows = dataRows.filter(r => r[0] && r[0].toString().trim() !== '');
    // riwayatIdx adalah index dari array reversed, balik dulu
    const actualIdx = riwayatRows.length - 1 - riwayatIdx;
    const targetRow = riwayatRows[actualIdx];
    if (!targetRow) return res.status(404).json({ error: 'Baris tidak ditemukan' });

    const origTanggal = targetRow[0];
    const origKode = targetRow[1];
    const origJenis = targetRow[2];

    // Cari di JURNAL baris yang cocok
    const jurnal = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'JURNAL!A2:E1002',
      valueRenderOption: 'UNFORMATTED_VALUE'
    });
    const jurnalRows = jurnal.data.values || [];
    let foundRow = -1;
    for (let i = 0; i < jurnalRows.length; i++) {
      const r = jurnalRows[i];
      if (r[0] && r[1] && r[2]) {
        const tgl = r[0].toString().trim();
        const jen = r[1].toString().trim();
        const kd = r[2].toString().trim();
        if (tgl === origTanggal && jen === origJenis && kd === origKode) {
          foundRow = i + 2; // +2 karena header
          break;
        }
      }
    }

    if (foundRow === -1) return res.status(404).json({ error: 'Baris JURNAL tidak ditemukan' });

    // Update kolom A-E (tanggal, jenis, kode, harga, lot)
    const { harga, lot } = req.body;
    const isSaham = ['BELI','JUAL'].includes(jenis);
    let updateRow, endCol;
    if (isSaham && lot) {
      updateRow = [tanggal, jenis, kode, harga || '', lot];
      endCol = 'E';
    } else if (harga) {
      updateRow = [tanggal, jenis, kode, harga];
      endCol = 'D';
    } else {
      updateRow = [tanggal, jenis, kode];
      endCol = 'C';
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `JURNAL!A${foundRow}:${endCol}${foundRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [updateRow] }
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/edit-riwayat/:riwayatIdx', async (req, res) => {
  console.log('[API CALL] DELETE /api/edit-riwayat/:riwayatIdx', {
    riwayatIdx: req.params.riwayatIdx,
    at: new Date().toISOString()
  });
  if (isDemoMode(req.query.demo)) {
    return res.status(400).json({ error: 'Mode demo hanya untuk melihat tampilan riwayat.' });
  }
  try {
    const sheets = getSheets();
    const riwayatIdx = parseInt(req.params.riwayatIdx);

    const riwayat = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'RIWAYAT!A:D'
    });
    const rows = riwayat.data.values || [];
    const dataRows = rows.slice(1);
    const riwayatRows = dataRows.filter(r => r[0] && r[0].toString().trim() !== '');
    const actualIdx = riwayatRows.length - 1 - riwayatIdx;
    const targetRow = riwayatRows[actualIdx];
    if (!targetRow) return res.status(404).json({ error: 'Baris tidak ditemukan' });

    const origTanggal = targetRow[0];
    const origKode = targetRow[1];
    const origJenis = targetRow[2];

    const jurnal = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'JURNAL!A2:E1002',
      valueRenderOption: 'UNFORMATTED_VALUE'
    });
    const jurnalRows = jurnal.data.values || [];
    let foundRow = -1;
    for (let i = 0; i < jurnalRows.length; i++) {
      const r = jurnalRows[i];
      if (r[0] && r[1] && r[2]) {
        const tgl = r[0].toString().trim();
        const jen = r[1].toString().trim();
        const kd = r[2].toString().trim();
        if (tgl === origTanggal && jen === origJenis && kd === origKode) {
          foundRow = i + 2;
          break;
        }
      }
    }

    if (foundRow === -1) return res.status(404).json({ error: 'Baris JURNAL tidak ditemukan' });

    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `JURNAL!A${foundRow}:E${foundRow}`
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Helper: cari row di JURNAL berdasarkan tanggal+jenis+kode
async function findJurnalRow(sheets, origTanggal, origJenis, origKode) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'JURNAL!A2:C2000',
    valueRenderOption: 'FORMATTED_VALUE'
  });
  const rows = result.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;
    const tgl = (r[0]||'').toString().trim();
    const jen = (r[1]||'').toString().trim();
    const kd  = (r[2]||'').toString().trim();
    if (tgl === origTanggal.trim() && jen === origJenis.trim() && kd === origKode.trim()) {
      return i + 2; // +2 karena header di row 1
    }
  }
  return -1;
}

app.put('/api/jurnal-edit', async (req, res) => {
  console.log('[API CALL] PUT /api/jurnal-edit', {
    bodyKeys: Object.keys(req.body || {}),
    at: new Date().toISOString()
  });
  if (isDemoMode(req.query.demo)) {
    return res.status(400).json({ error: 'Mode demo hanya untuk melihat prototype.' });
  }
  try {
    const sheets = getSheets();
    const { origTanggal, origJenis, origKode, tanggal, jenis, kode, harga, lot } = req.body;
    const rowNum = await findJurnalRow(sheets, origTanggal, origJenis, origKode);
    if (rowNum === -1) return res.status(404).json({ error: 'Baris tidak ditemukan di JURNAL' });

    const isSaham = ['BELI','JUAL'].includes(jenis);
    let row, endCol;
    if (isSaham && lot) {
      row = [tanggal, jenis, kode, harga || '', lot];
      endCol = 'E';
    } else if (harga) {
      row = [tanggal, jenis, kode, harga];
      endCol = 'D';
    } else {
      row = [tanggal, jenis, kode];
      endCol = 'C';
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `JURNAL!A${rowNum}:${endCol}${rowNum}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] }
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/jurnal-edit', async (req, res) => {
  console.log('[API CALL] DELETE /api/jurnal-edit', {
    bodyKeys: Object.keys(req.body || {}),
    at: new Date().toISOString()
  });
  if (isDemoMode(req.query.demo)) {
    return res.status(400).json({ error: 'Mode demo hanya untuk melihat prototype.' });
  }
  try {
    const sheets = getSheets();
    const { origTanggal, origJenis, origKode } = req.body;
    const rowNum = await findJurnalRow(sheets, origTanggal, origJenis, origKode);
    if (rowNum === -1) return res.status(404).json({ error: 'Baris tidak ditemukan di JURNAL' });

    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `JURNAL!A${rowNum}:E${rowNum}`
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT, () => {
  console.log(`PortoKu server running at http://localhost:${process.env.PORT}`);
});
