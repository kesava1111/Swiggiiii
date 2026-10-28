const fs = require('fs');
const path = require('path');

const TELEGRAM_BOT_TOKEN = "8642907155:AAHULXBX2ENPPrE7ZYDJwezQorQu0z0yc-o";
const TELEGRAM_CHAT_ID = "8450000919";
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');

// Helper function to wait for 10 minutes
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const FIRST_NAMES = ["Rahul", "Priya", "Arjun", "Sneha", "Vikram", "Ananya", "Karthik", "Divya", "Rohan", "Meera"];
const LAST_NAMES = ["Kumar", "Sharma", "Reddy", "Patel", "Singh", "Gupta", "Nair", "Rao", "Verma", "Choudhary"];

function getRandomName() { return `${FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]}`; }
function getRandomHydLocation() {
    const lat = (17.3850 + (Math.random() * 0.05 - 0.025)).toFixed(6);
    const lng = (78.4867 + (Math.random() * 0.05 - 0.025)).toFixed(6);
    return { lat, lng };
}

async function sendTelegramMsg(text) {
    try { 
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text, parse_mode: 'Markdown' }) 
        }); 
    } catch (e) {}
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

async function claimOffers(offerType) {
    console.log(`\n[🌟] ${offerType === 'late-night' ? 'Late Night' : 'Breakfast'} Claimer Started (with Retries)...`);
    if (!fs.existsSync(SESSIONS_FILE)) return;

    let sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    let targetSessions = offerType === 'late-night' 
        ? sessions.filter(s => !s.claimedLateNight) 
        : sessions.filter(s => !s.claimedBreakfast);

    if (targetSessions.length === 0) {
        console.log('[*] No unclaimed sessions. Sleeping...');
        return;
    }

    let successCount = 0, failCount = 0;
    let report = `*🌟 ${offerType === 'late-night' ? 'Late Night' : 'Breakfast'} Claimer Report*\n\n`;

    for (let session of targetSessions) {
        let maxRetries = 3; // Maximum 3 attempts per account
        let claimed = false;

        if (!session.nameSet) {
            const newName = await updateProfileName(session);
            if (newName) { session.name = newName; session.nameSet = true; }
        }

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            if (attempt > 0) {
                console.log(`[*] Waiting 10 minutes before retrying for ${session.mobile} (Attempt ${attempt + 1}/${maxRetries})...`);
                await sleep(10 * 60 * 1000); // Wait 10 minutes
            }

            const { lat, lng } = getRandomHydLocation(); // New location every attempt
            console.log(`[*] Attempt ${attempt + 1} for ${session.mobile} at ${lat}, ${lng}`);

            const headers = { "user-agent": "Swiggy-Android", "content-type": "application/json; charset=utf-8", "tid": session.tid, "sid": session.sid, "swuid": session.deviceId, "deviceid": session.deviceId, "lat": lat, "lng": lng };

            try {
                const offersRes = await fetch(`https://www.swiggy.com/dapi/offers?lat=${lat}&lng=${lng}`, { headers });
                const offersData = await offersRes.json();
                const offers = offersData.data || [];
                
                const targetOffers = offers.filter(o => o.title && (
                    o.title.toLowerCase().includes("free cash") || 
                    o.title.toLowerCase().includes("late night") || 
                    o.title.toLowerCase().includes("breakfast") || 
                    o.title.toLowerCase().includes("morning")
                ));

                if (targetOffers.length > 0) {
                    for (const targetOffer of targetOffers) {
                        const claimRes = await fetch(`https://www.swiggy.com/dapi/offers/claim`, { method: 'POST', headers: headers, body: JSON.stringify({ offerId: targetOffer.offerId, lat, lng }) });
                        const claimData = await claimRes.json();
                        
                        if (claimData.statusCode === 0 || claimData.success) {
                            claimed = true;
                            const successMsg = `*✅ ${offerType === 'late-night' ? 'LATE NIGHT' : 'BREAKFAST'} OFFER CLAIMED!*\n\n📱 *Mobile:* \`${session.mobile}\`\n *Offer:* ${targetOffer.title}\n *Note:* Cash will apply ${offerType === 'late-night' ? 'after 9 PM' : 'after 7 AM'}.\n\n*Updated Tokens:*\n\`\`\`json\n${JSON.stringify({ mobile: session.mobile, userid: session.userid, tid: session.tid, sid: session.sid, deviceId: session.deviceId }, null, 2)}\n\`\`\``;
                            await sendTelegramMsg(successMsg);
                            break; // Exit offer loop
                        }
                    }
                }

                if (claimed) break; // Exit retry loop if successful

            } catch (err) {
                console.error(`[-] Error during attempt ${attempt + 1} for ${session.mobile}:`, err.message);
            }
        }

        if (claimed) {
            if (offerType === 'late-night') session.claimedLateNight = true;
            else session.claimedBreakfast = true;
            session.claimedAt = new Date().toISOString();
            successCount++;
            report += `✅ \`${session.mobile}\` - Claimed Successfully\n`;
        } else {
            failCount++;
            report += ` \`${session.mobile}\` - Failed after 3 attempts\n`;
        }
    }

    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
    report += `\n*Total Checked:* ${targetSessions.length} | *Success:* ${successCount} | *Failed:* ${failCount}`;
    await sendTelegramMsg(report);
}

module.exports = { claimOffers, updateProfileName };
