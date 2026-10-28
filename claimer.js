const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); // Optional if Node 18+, but safe to have

const TELEGRAM_BOT_TOKEN = "8642907155:AAHULXBX2ENPPrE7ZYDJwezQorQu0z0yc-o";
const TELEGRAM_CHAT_ID = "8450000919";
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');

const FIRST_NAMES = ["Rahul", "Priya", "Arjun", "Sneha", "Vikram", "Ananya", "Karthik", "Divya", "Rohan", "Meera"];
const LAST_NAMES = ["Kumar", "Sharma", "Reddy", "Patel", "Singh", "Gupta", "Nair", "Rao", "Verma", "Choudhary"];

function getRandomName() { return `${FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]}`; }
function getRandomHydLocation() {
    const lat = (17.3850 + (Math.random() * 0.05 - 0.025)).toFixed(6);
    const lng = (78.4867 + (Math.random() * 0.05 - 0.025)).toFixed(6);
    return { lat, lng };
}

async function sendTelegramMsg(text) {
    try { await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text, parse_mode: 'Markdown' }) }); } catch (e) {}
}

async function updateProfileName(sessionData) {
    const randomName = getRandomName();
    const headers = { "user-agent": "Swiggy-Android", "content-type": "application/json; charset=utf-8", "tid": sessionData.tid, "sid": sessionData.sid, "swuid": sessionData.deviceId, "deviceid": sessionData.deviceId };
    try {
        const res = await fetch('https://profile.swiggy.com/v1/me', { method: 'POST', headers: headers, body: JSON.stringify({ name: randomName }) });
        const data = await res.json();
        if (data.statusCode === 0) return randomName;
    } catch (err) {}
    return null;
}

async function claimOffers() {
    console.log('\n[🌙] Night & Breakfast Claimer Started...');
    if (!fs.existsSync(SESSIONS_FILE)) return;

    let sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    let unclaimed = sessions.filter(s => !s.claimed);
    if (unclaimed.length === 0) return;

    let successCount = 0, failCount = 0;
    let report = `*🌙 Night & Breakfast Claimer Report*\n\n`;

    for (let session of unclaimed) {
        try {
            if (!session.nameSet) {
                const newName = await updateProfileName(session);
                if (newName) { session.name = newName; session.nameSet = true; }
            }

            const { lat, lng } = getRandomHydLocation();
            const headers = { "user-agent": "Swiggy-Android", "content-type": "application/json; charset=utf-8", "tid": session.tid, "sid": session.sid, "swuid": session.deviceId, "deviceid": session.deviceId, "lat": lat, "lng": lng };

            const offersRes = await fetch(`https://www.swiggy.com/dapi/offers?lat=${lat}&lng=${lng}`, { headers });
            const offersData = await offersRes.json();
            const offers = offersData.data || [];
            
            const targetOffers = offers.filter(o => o.title && (o.title.toLowerCase().includes("free cash") || o.title.toLowerCase().includes("late night") || o.title.toLowerCase().includes("breakfast") || o.title.toLowerCase().includes("morning")));

            if (targetOffers.length > 0) {
                let claimedAny = false, claimedTitles = [];
                for (const targetOffer of targetOffers) {
                    const claimRes = await fetch(`https://www.swiggy.com/dapi/offers/claim`, { method: 'POST', headers: headers, body: JSON.stringify({ offerId: targetOffer.offerId, lat, lng }) });
                    const claimData = await claimRes.json();
                    if (claimData.statusCode === 0 || claimData.success) {
                        claimedTitles.push(targetOffer.title);
                        claimedAny = true;
                    }
                }
                if (claimedAny) {
                    session.claimed = true;
                    session.claimedAt = new Date().toISOString();
                    session.claimedOffers = claimedTitles;
                    successCount++;
                    report += `✅ \`${session.mobile}\` - Claimed: ${claimedTitles.join(', ')}\n`;
                } else { failCount++; report += `⚠️ \`${session.mobile}\` - All claims failed\n`; }
            } else { failCount++; report += `⛔ \`${session.mobile}\` - No matching offers found\n`; }
        } catch (err) { failCount++; }
    }

    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
    report += `\n*Total:* ${unclaimed.length} | *Success:* ${successCount} | *Failed:* ${failCount}`;
    await sendTelegramMsg(report);
}

module.exports = { claimOffers, updateProfileName };