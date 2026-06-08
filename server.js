const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { ApifyClient } = require('apify-client');
const axios = require('axios');
const cron = require('node-cron');
const app = express();
app.use(express.json());

// 🔑 ALL KEYS
const SB_URL = 'https://pvsqvpbjhiwjgifbgmzl.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2c3F2cGJqaGl3amdpZmJnbXpsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDgxNDg0MiwiZXhwIjoyMDk2MzkwODQyfQ.obNCTgtXsFrszT478xb2Cne1mGnxYK-Mls52OccouK4';
const DEFAULT_GEMINI_KEY = 'AQ.Ab8RN6JomLmhvW5ZSmLlMLTrpBj8NzbZPqTtoAqRAdmHIZEEFA';

const APIFY_TOKEN = 'apify_api_vR3MuRp3NLyql4NTm603ykIAqAa3Fo4x3m1n';
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

const BLOGGER_CLIENT_ID = '347967969883-i25938q4sqpsgoihh3up0s2dahp0e7c9.apps.googleusercontent.com';
const BLOGGER_CLIENT_SECRET = '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';
const BLOGGER_REFRESH_TOKEN = '1//04N1D0adAA4NJCgYIARAAGAQSNwF-L9Ir9PxJtu7wfbQr5srSZEx_HszKuX23n2HdQWkyumqxGz_WKcScM_NKk9Plggmf9qhxMMA';
const BLOG_ID = '4924676053847184907';

// Tumhara Instagram Session ID (Decoded)
const INSTA_SESSION_ID = "77703968755:c3Gd0s17DSKhxF:28:AYiRunJ_F2QXSYtEwn4AuAu3DJW9NnjKotTWRm-LkA";

const supabase = createClient(SB_URL, SB_KEY);

async function getSettings() {
    const { data } = await supabase.from('agent_settings').select('*').eq('id', 1).single();
    return data;
}

// ROUTES
app.get('/', (req, res) => res.send('🤖 PilotBot Engine is AWAKE!'));

app.get('/api/settings', async (req, res) => {
    const settings = await getSettings();
    res.json(settings);
});

app.post('/api/settings', async (req, res) => {
    const newSettings = req.body;
    const { error } = await supabase.from('agent_settings').update(newSettings).eq('id', 1);
    if (error) return res.json({ success: false, error: error.message });
    res.json({ success: true });
});

// ==========================================
// 💸 NEW: AI PRICE COMPARISON (Instant)
// ==========================================
app.post('/api/compare-prices', async (req, res) => {
    const { product } = req.body;
    const settings = await getSettings();
    const GEM_KEY = settings.gemini_key || DEFAULT_GEMINI_KEY;
    
    try {
        const genAI = new GoogleGenerativeAI(GEM_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        
        const prompt = `I need to compare prices for "${product}" across Indian e-commerce sites. Give me a JSON array with 3 objects: Amazon India, Flipkart, and eBay. Each object must have "store" (string), "price" (string with ₹ symbol), and "url" (string with search URL). Just return the raw JSON array, no other text.`;
        
        const result = await model.generateContent(prompt);
        let responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        
        const prices = JSON.parse(responseText);
        res.json({ success: true, prices: prices });
    } catch (error) {
        console.error("Price Compare Error:", error.message);
        res.json({ success: false, prices: [] });
    }
});

// ==========================================
// 🎬 APIFY: INSTAGRAM REEL FINDER
// ==========================================
app.post('/api/reel-product', async (req, res) => {
    const { reelUrl } = req.body;
    try {
        console.log("Scraping Reel via Apify...");
        const run = await apifyClient.actor("shu8hvrXbJbY3Eb9W").call({
            "resultsType": "posts",
            "directUrls": [reelUrl],
            "resultsLimit": 1,
            "addParentData": false,
            "instagramCookies": [{ "name": "sessionid", "value": INSTA_SESSION_ID, "domain": ".instagram.com" }]
        });
        
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        
        if(items.length > 0) {
            const reelData = items[0];
            const caption = reelData.caption || reelData.text || "Product found in reel";
            
            const settings = await getSettings();
            const GEM_KEY = settings.gemini_key || DEFAULT_GEMINI_KEY;
            const genAI = new GoogleGenerativeAI(GEM_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-pro" });
            
            const prompt = `Analyze this Instagram caption and extract the main product name. Just return the product name, nothing else. Caption: "${caption}"`;
            const result = await model.generateContent(prompt);
            const productName = result.response.text().trim();

            res.json({ 
                success: true, 
                productName: productName,
                searchLink: `https://www.amazon.in/s?k=${encodeURIComponent(productName)}`,
                flipkartLink: `https://www.flipkart.com/search?q=${encodeURIComponent(productName)}`
            });
        } else {
            res.json({ success: false, productName: "Could not identify product" });
        }
    } catch (error) {
        console.error("Apify Reel Error:", error.message);
        res.json({ success: false, productName: "Error analyzing reel. Apify might be sleeping." });
    }
});

// ==========================================
// 🛒 APIFY: REAL-TIME COUPONS
// ==========================================
app.get('/api/coupons', async (req, res) => {
    const store = req.query.store || 'amazon';
    const keyword = store === 'amazon' ? 'amazon coupons today' : 'flipkart offers today';
    
    try {
        console.log(`Fetching ${store} coupons via Apify...`);
        const run = await apifyClient.actor("se6u51NCji6y89vBS").call({
            "keywords": [keyword],
            "maxResultsPerKeyword": 3,
            "fullDetails": true,
            "marketplace": "com"
        });
        
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        
        const coupons = items.map(item => ({
            code: item.title || "Deal Available",
            discount: item.price ? `Price: ${item.price}` : "Click to see"
        })).slice(0, 3);

        res.json({ coupons: coupons });
    } catch (error) {
        console.error("Apify Coupon Error:", error.message);
        // SMART FALLBACK if Apify sleeps
        res.json({ coupons: [{ code: "Server Busy", discount: "Coupons are updating. Try again in 2 mins!" }] });
    }
});

// BLOGGER LOGIC
async function getBloggerAccessToken() {
    try {
        const response = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: BLOGGER_CLIENT_ID, client_secret: BLOGGER_CLIENT_SECRET, refresh_token: BLOGGER_REFRESH_TOKEN, grant_type: 'refresh_token'
        });
        return response.data.access_token;
    } catch (error) { console.error("Blogger Token Error", error.message); return null; }
}

cron.schedule('0 8 * * *', async () => {
    console.log("⏰ Writing Blog...");
    const settings = await getSettings();
    const GEM_KEY = settings.gemini_key || DEFAULT_GEMINI_KEY;
    try {
        const genAI = new GoogleGenerativeAI(GEM_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent("Write a high SEO 800-word shopping guide about Best Tech Deals Today. No fake links.");
        const blogText = result.response.text();
        
        const accessToken = await getBloggerAccessToken();
        if (accessToken) {
            await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts`, {
                kind: 'blogger#post', title: 'Best Tech Deals Today - By Hamdan', content: blogText + `<br><p>Visit <a href="https://affiliatepilot-frontend.vercel.app">AffiliatePilot</a></p>`
            }, { headers: { Authorization: `Bearer ${accessToken}` } });
            console.log("✅ Blog Posted!");
        }
    } catch(e) { console.log("❌ Blog Error:", e.message); }
});

// KEEP RENDER AWAKE
cron.schedule('*/10 * * * *', async () => {
    try { await axios.get('https://pilotbot-engine.onrender.com/'); console.log("Render Kept Awake!"); } catch(e) {}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 PilotBot Engine Running!'));
