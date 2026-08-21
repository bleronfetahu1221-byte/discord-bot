/**
 * ============================================================================
 * LOOTHUB ENTERPRISE BACKEND SERVER - STANDOFF 2 PLATFORM
 * ============================================================================
 */

const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;
const ADMIN_PASSCODE = "100200100";

// Middleware configuration
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Database Repositories
const db = {
    users: {}, // Stores user session data: { username, balance, createdAt, inventory }
    topupListing: {
        item: "G22 | Carbon",
        price: 50.00,
        pattern: "482"
    },
    topupClaims: [],
    withdrawalRequests: [],
    caseRegistry: {
        starter: {
            name: "Starter Case",
            cost: 25,
            items: [
                { name: "P350 | Forest", value: 10, odds: 50.0 },
                { name: "SM1014 | Carbon", value: 35, odds: 30.0 },
                { name: "AKR | Railgun", value: 110, odds: 15.0 },
                { name: "Dragon Glass | AWM", value: 850, odds: 4.8 },
                { name: "Karambit | Gold", value: 25000, odds: 0.2 }
            ]
        },
        pro: {
            name: "Pro Case",
            cost: 150,
            items: [
                { name: "TEC-9 | Scale", value: 60, odds: 45.0 },
                { name: "AWM | Sport", value: 300, odds: 38.0 },
                { name: "M9 Bayonet | Dragon", value: 1500, odds: 16.8 },
                { name: "Butterfly | Legacy", value: 35000, odds: 0.2 }
            ]
        }
    }
};

/**
 * Middleware or helper to verify session existence
 */
function verifyUserSession(req, res, next) {
    const { username } = req.body;
    if (!username || !db.users[username]) {
        return res.status(401).json({ success: false, message: "Unauthorized: Active user session required." });
    }
    req.userSession = db.users[username];
    next();
}

// ----------------------------------------------------------------------------
// AUTHENTICATION ENDPOINTS
// ----------------------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
    try {
        const { username } = req.body;
        if (!username || typeof username !== 'string' || username.trim() === "") {
            return res.status(400).json({ success: false, message: "Invalid username input string." });
        }

        const cleanName = username.trim();
        if (!db.users[cleanName]) {
            db.users[cleanName] = {
                username: cleanName,
                balance: 150.00, // Initial welcome bonus balance
                createdAt: new Date().toISOString(),
                inventory: []
            };
        }

        return res.json({
            success: true,
            message: "Session established successfully.",
            user: db.users[cleanName]
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Internal server error during authentication." });
    }
});

// ----------------------------------------------------------------------------
// MARKET TOP-UP ENDPOINTS
// ----------------------------------------------------------------------------
app.get('/api/topup/listing', (req, res) => {
    return res.json({
        success: true,
        listing: db.topupListing
    });
});

app.post('/api/topup/claim', verifyUserSession, (req, res) => {
    try {
        const { profilePhoto, proofScreenshot } = req.body;
        if (!profilePhoto || !proofScreenshot) {
            return res.status(400).json({ success: false, message: "Profile photo and proof screenshot references are required." });
        }

        const claimEntry = {
            id: 'topup_' + Date.now() + Math.floor(Math.random() * 1000),
            username: req.userSession.username,
            item: db.topupListing.item,
            amount: db.topupListing.price,
            pattern: db.topupListing.pattern,
            profilePhoto,
            proofScreenshot,
            timestamp: new Date().toISOString(),
            status: 'pending'
        };

        db.topupClaims.push(claimEntry);

        return res.json({
            success: true,
            message: "Top-up proof registered and dispatched to admin queue.",
            claimId: claimEntry.id
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Failed to process top-up claim." });
    }
});

// ----------------------------------------------------------------------------
// WITHDRAWAL ENDPOINTS
// ----------------------------------------------------------------------------
app.post('/api/withdraw/request', verifyUserSession, (req, res) => {
    try {
        const { amount, skinItem, pattern, profilePhoto } = req.body;
        const parsedAmount = parseFloat(amount);

        if (isNaN(parsedAmount) || parsedAmount < 20) {
            return res.status(400).json({ success: false, message: "Minimum withdrawal requirement is 20 Gold." });
        }

        if (req.userSession.balance < parsedAmount) {
            return res.status(400).json({ success: false, message: "Insufficient account balance for this withdrawal request." });
        }

        if (!skinItem || !pattern || !profilePhoto) {
            return res.status(400).json({ success: false, message: "Skin name, pattern code, and Standoff 2 profile photo verification are mandatory." });
        }

        // Deduct balance immediately upon request submission
        req.userSession.balance -= parsedAmount;

        // Generate randomized decimal suffix matching system specifications (e.g., .12 to .98)
        const randomDecimal = (Math.random() * (0.95 - 0.05) + 0.05).toFixed(2);
        const exactPrice = (parsedAmount + parseFloat(randomDecimal)).toFixed(2);

        const withdrawalEntry = {
            id: 'wd_' + Date.now() + Math.floor(Math.random() * 1000),
            username: req.userSession.username,
            requestedAmount: parsedAmount,
            exactPrice: parseFloat(exactPrice),
            skinItem,
            pattern,
            profilePhoto,
            timestamp: new Date().toISOString(),
            status: 'pending'
        };

        db.withdrawalRequests.push(withdrawalEntry);

        return res.json({
            success: true,
            exactPrice: parseFloat(exactPrice),
            newBalance: parseFloat(req.userSession.balance.toFixed(2)),
            message: "Withdrawal generated successfully."
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Server error handling withdrawal request." });
    }
});

// ----------------------------------------------------------------------------
// GAMING MODULE ENDPOINTS (CASES & UPGRADER)
// ----------------------------------------------------------------------------
app.post('/api/games/case/open', verifyUserSession, (req, res) => {
    try {
        const { caseKey } = req.body;
        const targetCase = db.caseRegistry[caseKey];

        if (!targetCase) {
            return res.status(400).json({ success: false, message: "Invalid or nonexistent case configuration." });
        }

        if (req.userSession.balance < targetCase.cost) {
            return res.status(400).json({ success: false, message: "Insufficient balance to open this case." });
        }

        req.userSession.balance -= targetCase.cost;

        // Weighted random drop algorithm
        const roll = Math.random() * 100;
        let cumulative = 0;
        let wonItem = targetCase.items[0];

        for (const skin of targetCase.items) {
            cumulative += skin.odds;
            if (roll <= cumulative) {
                wonItem = skin;
                break;
            }
        }

        req.userSession.balance += wonItem.value;

        // Construct 25-item rollout sequence array for frontend animation matrix rendering
        const rollerSequence = [];
        for (let i = 0; i < 25; i++) {
            const randomSkin = targetCase.items[Math.floor(Math.random() * targetCase.items.length)];
            rollerSequence.push(randomSkin);
        }
        // Pin winning item at structural landing index 18
        rollerSequence[18] = wonItem;

        return res.json({
            success: true,
            wonItem,
            rollerSequence,
            newBalance: parseFloat(req.userSession.balance.toFixed(2))
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Error processing case opening." });
    }
});

app.post('/api/games/upgrader/play', verifyUserSession, (req, res) => {
    try {
        const { betAmount, multiplier } = req.body;
        const bet = parseFloat(betAmount);
        const mult = parseFloat(multiplier);

        if (isNaN(bet) || bet <= 0 || bet > req.userSession.balance) {
            return res.status(400).json({ success: false, message: "Invalid bet amount specification." });
        }

        const validMultipliers = { 2: 0.45, 5: 0.18, 10: 0.08 };
        if (!validMultipliers[mult]) {
            return res.status(400).json({ success: false, message: "Unsupported multiplier configuration." });
        }

        req.userSession.balance -= bet;

        const winChance = validMultipliers[mult];
        const isWin = Math.random() < winChance;
        let payout = 0;

        if (isWin) {
            payout = parseFloat((bet * mult).toFixed(2));
            req.userSession.balance += payout;
        }

        return res.json({
            success: true,
            isWin,
            payout,
            newBalance: parseFloat(req.userSession.balance.toFixed(2))
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Upgrader engine execution error." });
    }
});

// ----------------------------------------------------------------------------
// ADMIN MANAGEMENT MODULE ENDPOINTS
// ----------------------------------------------------------------------------
app.post('/api/admin/set-topup', (req, res) => {
    try {
        const passcode = req.body.passcode;
        const item = req.body.item;
        const price = req.body.price;
        const pattern = req.body.pattern;

        if (passcode !== ADMIN_PASSCODE) {
            return res.status(403).json({ success: false, message: "Unauthorized: Invalid Admin Passcode." });
        }

        if (!item || !price || !pattern) {
            return res.status(400).json({ success: false, message: "All listing properties (item, price, pattern) are required." });
        }

        db.topupListing = {
            item,
            price: parseFloat(price),
            pattern: String(pattern)
        };

        return res.json({
            success: true,
            message: "Active top-up listing updated live.",
            listing: db.topupListing
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Failed to update top-up listing." });
    }
});

app.post('/api/admin/queues', (req, res) => {
    try {
        const passcode = req.body.passcode;
        if (passcode !== ADMIN_PASSCODE) {
            return res.status(403).json({ success: false, message: "Unauthorized: Invalid Admin Passcode." });
        }

        return res.json({
            success: true,
            topupClaims: db.topupClaims,
            withdrawalRequests: db.withdrawalRequests,
            systemUsersCount: Object.keys(db.users).length
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Error retrieving admin queue data." });
    }
});

// Fallback routing for any sub-path (like /palermo) to correctly load index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`[LootHUB Engine] Enterprise server active and listening on port ${PORT}`);
});
