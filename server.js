'use strict';

const express  = require('express');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const multer   = require('multer');

const app  = express();
const PORT = process.env.PORT || 10000;

/* ============================================================
   CONFIG
   ============================================================ */
const GMAIL_CLIENT_ID     = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const GMAIL_USER          = process.env.GMAIL_USER;
const ADMIN_EMAIL         = process.env.ADMIN_EMAIL || 'xpxorder@gmail.com';
const ADMIN_PASSWORD      = process.env.ADMIN_PASSWORD || 'XPXforza@2026';

const KEYS_FILE    = path.join(__dirname, 'keys.json');
const BUNDLE_FILE  = path.join(__dirname, 'Forza Horizon 6 Premium Edition Package.zip');
const BUNDLE_NAME  = 'Forza Horizon 6 Premium Edition Package.zip';

const DOWNLOAD_TTL_MS = 10 * 60 * 1000; // 10 minutes

/* ============================================================
   CORS
   ============================================================ */
app.use(cors({
  origin: function(origin, callback) {
    const allowed = [
      'https://xpxfh6.netlify.app',
      
      'http://localhost',
      'http://127.0.0.1',
    ];
    // Allow requests with no origin (curl, Render admin dashboard itself)
    if (!origin || allowed.some(a => origin.startsWith(a)) || origin.includes('onrender.com')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
}));
app.use(express.json());

/* ============================================================
   HELPERS
   ============================================================ */
function readKeys() {
  const data = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  if (!data.orders) data.orders = [];
  return data;
}
function writeKeys(data) {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2));
}
function genToken(prefix) {
  return prefix + '_' + crypto.randomBytes(24).toString('hex');
}

/* ============================================================
   GMAIL OAUTH2 EMAIL HELPER
   ============================================================ */
async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get access token: ' + JSON.stringify(data));
  return data.access_token;
}

async function sendEmail({ to, subject, html, attachments = [] }) {
  const accessToken = await getAccessToken();

  let mime = [
    'MIME-Version: 1.0',
    `From: XPX Gaming <${GMAIL_USER}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
  ];

  if (attachments.length) {
    const boundary = 'XPX_BOUNDARY_' + Date.now();
    mime.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`);
    mime.push('Content-Type: text/html; charset=utf-8', '', html);
    for (const att of attachments) {
      mime.push('', `--${boundary}`);
      mime.push('Content-Type: application/octet-stream');
      mime.push('Content-Transfer-Encoding: base64');
      mime.push(`Content-Disposition: attachment; filename="${att.filename}"`, '');
      mime.push(att.content);
    }
    mime.push('', `--${boundary}--`);
  } else {
    mime.push('Content-Type: text/html; charset=utf-8', '', html);
  }

  const raw = Buffer.from(mime.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Gmail API error: ' + JSON.stringify(data));
  return data;
}


/* ============================================================
   MULTER — memory storage for screenshot upload
   ============================================================ */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/* ============================================================
   SUBMIT ORDER — customer places order, admin gets email
   ============================================================ */
app.post('/api/submit-order', upload.single('screenshot'), async (req, res) => {
  const ip       = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const name     = (req.body.name     || '').trim();
  const email    = (req.body.email    || '').trim();
  const whatsapp = (req.body.whatsapp || '').trim();

  if (!name || !email) return res.json({ success: false, message: 'Name and email are required.' });
  if (!req.file)       return res.json({ success: false, message: 'Payment screenshot is required.' });

  const orderId = 'FH6-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();

  try {
    const screenshotExt = req.file.mimetype === 'image/png' ? 'png' : 'jpg';
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `[NEW ORDER] ${orderId} — ${name}`,
      html: `
        <div style="font-family:monospace;background:#06060a;color:#eeeaf0;padding:24px;border-radius:8px;">
          <h2 style="color:#e8c97a;letter-spacing:3px;margin-bottom:16px;">NEW FORZA ORDER RECEIVED</h2>
          <table style="border-collapse:collapse;width:100%;">
            <tr><td style="color:#9591a0;padding:6px 12px 6px 0;width:140px;">Order ID</td><td style="color:#4af0ff;font-weight:700;">${orderId}</td></tr>
            <tr><td style="color:#9591a0;padding:6px 12px 6px 0;">Customer Name</td><td style="color:#eeeaf0;">${name}</td></tr>
            <tr><td style="color:#9591a0;padding:6px 12px 6px 0;">Email</td><td style="color:#eeeaf0;">${email}</td></tr>
            <tr><td style="color:#9591a0;padding:6px 12px 6px 0;">WhatsApp</td><td style="color:#eeeaf0;">${whatsapp || '—'}</td></tr>
            <tr><td style="color:#9591a0;padding:6px 12px 6px 0;">Submitted At</td><td style="color:#eeeaf0;">${new Date().toLocaleString()}</td></tr>
            <tr><td style="color:#9591a0;padding:6px 12px 6px 0;">IP Address</td><td style="color:#eeeaf0;">${ip}</td></tr>
          </table>
          <p style="margin-top:20px;color:#9591a0;">Payment screenshot attached. Send the customer a redeem key manually.</p>
        </div>
      `,
      attachments: [{
        filename: `payment_${orderId}.${screenshotExt}`,
        content: req.file.buffer.toString('base64'),
      }],
    });

    // Save order to keys.json
    const data = readKeys();
    if (!data.orders) data.orders = [];
    data.orders.push({ orderId, name, email, whatsapp, ip, status: 'pending', submittedAt: new Date().toISOString() });
    writeKeys(data);

    console.log(`[${new Date().toISOString()}] ORDER: ${orderId} from ${email}`);
    return res.json({ success: true, message: 'Order received! Your redeem key will be emailed within 1-6 hours.' });
  } catch(err) {
    console.error('submit-order error:', err);
    return res.json({ success: false, message: 'Server error. Please try again or contact support.' });
  }
});


/* ============================================================
   VERIFY ORDER — admin clicks verify, sends key to customer
   ============================================================ */
app.post('/api/verify-order', async (req, res) => {
  const pw      = req.query.password || req.body.password;
  const orderId = req.body.orderId;
  if (pw !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

  const data = readKeys();
  const orderIdx = (data.orders || []).findIndex(o => o.orderId === orderId);
  if (orderIdx === -1) return res.status(404).json({ error: 'Order not found' });

  const order = data.orders[orderIdx];
  if (order.status === 'verified') return res.json({ success: false, message: 'Order already verified.' });

  // Pick first unused unreserved key
  const keyIdx = data.keys.findIndex(k => !k.used && !k.reserved);
  if (keyIdx === -1) return res.json({ success: false, message: 'No keys available!' });

  const assignedKey = data.keys[keyIdx].key;

  // Reserve key
  data.keys[keyIdx].reserved = true;
  data.keys[keyIdx].orderId  = orderId;

  // Update order
  data.orders[orderIdx].status     = 'verified';
  data.orders[orderIdx].verifiedAt = new Date().toISOString();
  data.orders[orderIdx].assignedKey = assignedKey;
  writeKeys(data);

  // Email customer
  try {
    await sendEmail({
      to: order.email,
      subject: 'Your Forza Horizon 6 Premium Edition — Redeem Key',
      html: `
        <div style="font-family:monospace;background:#06060a;color:#eeeaf0;padding:32px;border-radius:12px;max-width:560px;">
          <h2 style="color:#e8c97a;letter-spacing:3px;margin-bottom:8px;">XPX GAMING</h2>
          <p style="color:#9591a0;font-size:13px;margin-bottom:24px;">Forza Horizon 6 Premium Edition</p>
          <p style="margin-bottom:16px;">Hi <strong>${order.name}</strong>, your payment has been verified. Here is your Redeem Key:</p>
          <div style="background:#0e0d14;border:1px solid #e8c97a;border-radius:8px;padding:20px;text-align:center;margin:24px 0;">
            <div style="font-size:11px;color:#9591a0;letter-spacing:3px;margin-bottom:8px;">YOUR REDEEM KEY</div>
            <div style="font-size:22px;font-weight:700;color:#e8c97a;letter-spacing:4px;">${assignedKey}</div>
          </div>
          <div style="background:#0a0e0b;border:1px solid #1a2e20;border-radius:8px;padding:16px;margin-bottom:24px;">
            <div style="color:#39d98a;font-size:11px;letter-spacing:2px;margin-bottom:10px;">HOW TO USE YOUR KEY</div>
            <ol style="color:#9591a0;font-size:13px;line-height:1.8;padding-left:16px;">
              <li>Go to <a href="https://xpxfh6.netlify.app/payment.html" style="color:#e8c97a;">xpxfh6.netlify.app/payment.html</a></li>
              <li>Enter your Redeem Key in the key field</li>
              <li>Click <strong style="color:#eeeaf0;">Redeem & Download</strong></li>
              <li>Your Forza Horizon 6 package will download automatically</li>
            </ol>
          </div>
          <div style="border-top:1px solid #1a1825;padding-top:16px;text-align:center;">
            <p style="color:#4a4660;font-size:11px;letter-spacing:2px;">© 2026 XPX GAMING — AASHRYAAA PVT. LTD.</p>
          </div>
        </div>
      `,
    });
    console.log(`[${new Date().toISOString()}] VERIFIED: ${orderId} → key ${assignedKey} sent to ${order.email}`);
    return res.json({ success: true, message: 'Key sent to customer!' });
  } catch(err) {
    console.error('verify-order email error:', err);
    return res.json({ success: false, message: 'Key assigned but email failed: ' + err.message });
  }
});

/* ============================================================
   HEALTH CHECK + KEEP-ALIVE PING
   ============================================================ */
app.get('/', (req, res) => {
  res.json({ status: 'online', service: 'XPX Forza Backend v1.0' });
});

app.get('/ping', (req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

/* ============================================================
   VERIFY REDEEM KEY → issue download token
   ============================================================ */
app.post('/api/verify-key', async (req, res) => {
  const ip      = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const trimmed = (req.body.key || '').trim().toUpperCase();

  if (!trimmed) return res.json({ success: false, message: 'Please enter a redeem key.' });

  const data = readKeys();

  // Check master key
  const masterKey = process.env.MASTER_KEY || 'FORZA-MASTER-2026';
  if (trimmed === masterKey.toUpperCase()) {
    const dlToken = genToken('dl');
    data.downloadTokens[dlToken] = { createdAt: Date.now(), expiresAt: Date.now() + DOWNLOAD_TTL_MS };
    writeKeys(data);
    return res.json({ success: true, downloadToken: dlToken, message: 'Master key accepted.' });
  }

  const idx = data.keys.findIndex(k => k.key.toUpperCase() === trimmed);

  if (idx === -1) return res.json({ success: false, message: 'Invalid redeem key. Please check and try again.' });
  if (data.keys[idx].used) return res.json({ success: false, message: 'This key has already been redeemed. Please contact support.' });

  // Mark used + issue download token
  data.keys[idx].used     = true;
  data.keys[idx].usedAt   = new Date().toISOString();
  data.keys[idx].usedByIP = ip;

  const dlToken = genToken('dl');
  data.downloadTokens[dlToken] = { createdAt: Date.now(), expiresAt: Date.now() + DOWNLOAD_TTL_MS };
  writeKeys(data);

  console.log(`[${new Date().toISOString()}] KEY REDEEMED: "${trimmed}" from ${ip}`);
  return res.json({ success: true, downloadToken: dlToken, message: 'Key verified. Download starting.' });
});

/* ============================================================
   DOWNLOAD BUNDLE
   ============================================================ */
app.get('/api/download', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const data = readKeys();
  const dl   = data.downloadTokens[token];

  if (!dl) return res.status(403).json({ error: 'Invalid download token.' });
  if (Date.now() > dl.expiresAt) {
    delete data.downloadTokens[token];
    writeKeys(data);
    return res.status(403).json({ error: 'Download token expired. Please redeem your key again.' });
  }

  if (!fs.existsSync(BUNDLE_FILE)) {
    return res.status(404).json({ error: 'Bundle file not found on server.' });
  }

  // Don't delete token immediately — allow re-download within TTL
  console.log(`[${new Date().toISOString()}] DOWNLOAD: token ${token.slice(0, 16)}...`);

  res.setHeader('Content-Disposition', `attachment; filename="${BUNDLE_NAME}"`);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Length', fs.statSync(BUNDLE_FILE).size);
  fs.createReadStream(BUNDLE_FILE).pipe(res);
});

/* ============================================================
   ADMIN DASHBOARD
   ============================================================ */
app.get('/admin', (req, res) => {
  const pw = req.query.password;
  if (pw !== ADMIN_PASSWORD) return res.status(401).send('Unauthorized');

  const data   = readKeys();
  const total  = data.keys.length;
  const used   = data.keys.filter(k => k.used).length;
  const avail  = total - used;

  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>XPX Forza Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #06060a; color: #eeeaf0; font-family: monospace; padding: 24px; }
    h1 { color: #e8c97a; letter-spacing: 4px; margin-bottom: 24px; }
    .stats { display: flex; gap: 16px; margin-bottom: 32px; flex-wrap: wrap; }
    .stat { background: #0e0d14; border: 1px solid #1a1825; padding: 16px 24px; border-radius: 8px; }
    .stat .n { font-size: 32px; font-weight: 700; color: #39d98a; }
    .stat .l { font-size: 11px; color: #9591a0; letter-spacing: 2px; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th { color: #9591a0; font-size: 11px; letter-spacing: 2px; padding: 8px 12px; text-align: left; border-bottom: 1px solid #1a1825; }
    td { padding: 10px 12px; border-bottom: 1px solid #0e0d14; font-size: 13px; }
    .used { color: #e05c4b; }
    .avail { color: #39d98a; }
    .bundle { background: #0e0d14; border: 1px solid #1a1825; padding: 12px 16px; border-radius: 6px; margin-bottom: 24px; }
  </style>
</head>
<body>
  <h1>🎮 XPX FORZA ADMIN</h1>
  <div class="bundle">
    📦 Bundle File: ${fs.existsSync(BUNDLE_FILE) ? '✅ Present — downloads working' : '❌ MISSING — uploads needed'}
  </div>
  <div class="stats">
    <div class="stat"><div class="n">${total}</div><div class="l">TOTAL KEYS</div></div>
    <div class="stat"><div class="n" style="color:#39d98a">${avail}</div><div class="l">AVAILABLE</div></div>
    <div class="stat"><div class="n" style="color:#e05c4b">${used}</div><div class="l">USED</div></div>
  </div>
  <h2 style="color:#e8c97a;letter-spacing:3px;margin:32px 0 16px;">ORDERS</h2>
  ${(data.orders||[]).length === 0 ? '<p style="color:#4a4660;">No orders yet.</p>' : `
  <table>
    <tr><th>ORDER ID</th><th>NAME</th><th>EMAIL</th><th>WHATSAPP</th><th>STATUS</th><th>SUBMITTED</th><th>ACTION</th></tr>
    ${(data.orders||[]).map(o => `
    <tr>
      <td style="color:#4af0ff;font-size:11px;">${o.orderId}</td>
      <td>${o.name}</td>
      <td>${o.email}</td>
      <td style="color:#9591a0">${o.whatsapp||'—'}</td>
      <td class="${o.status==='verified'?'avail':''}' style="color:${o.status==='pending'?'#e8c97a':'#39d98a'}">${o.status==='verified'?'✓ VERIFIED':'⏳ PENDING'}</td>
      <td style="color:#9591a0;font-size:11px">${new Date(o.submittedAt).toLocaleString()}</td>
      <td>${o.status==='pending' ? `<button onclick="verifyOrder('${o.orderId}')" style="background:#39d98a;color:#06060a;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-weight:700;font-family:monospace;letter-spacing:1px;">VERIFY</button>` : `<span style="color:#39d98a">Key: ${o.assignedKey||'—'}</span>`}</td>
    </tr>`).join('')}
  </table>`}

  <h2 style="color:#e8c97a;letter-spacing:3px;margin:32px 0 16px;">REDEEM KEYS</h2>
  <table>
    <tr><th>#</th><th>KEY</th><th>STATUS</th><th>USED AT</th><th>IP</th></tr>
    ${data.keys.map((k, i) => `
    <tr>
      <td style="color:#4a4660">${i + 1}</td>
      <td style="color:#4af0ff">${k.key}</td>
      <td class="${k.used ? 'used' : 'avail'}">${k.used ? '✗ USED' : k.reserved ? '🔒 RESERVED' : '✓ AVAILABLE'}</td>
      <td style="color:#9591a0">${k.usedAt ? new Date(k.usedAt).toLocaleString() : '—'}</td>
      <td style="color:#9591a0">${k.usedByIP || '—'}</td>
    </tr>`).join('')}
  </table>
  <script>
  function verifyOrder(orderId) {
    if (!confirm('Send redeem key to customer for order ' + orderId + '?')) return;
    fetch('/api/verify-order?password=${ADMIN_PASSWORD}', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({orderId: orderId, password: '${ADMIN_PASSWORD}'})
    }).then(r=>r.json()).then(d=>{
      alert(d.message || (d.success ? 'Done!' : 'Error'));
      if (d.success) location.reload();
    }).catch(e=>alert('Error: '+e.message));
  }
  </script>
</body>
</html>`);
});

/* ============================================================
   START
   ============================================================ */
app.listen(PORT, () => {
  console.log(`\n🎮 XPX Forza Backend running on port ${PORT}`);
  console.log(`   Admin: http://localhost:${PORT}/admin?password=${ADMIN_PASSWORD}`);
  console.log(`   Bundle: ${fs.existsSync(BUNDLE_FILE) ? '✅ present' : '❌ MISSING'}\n`);
});
