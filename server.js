const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { ApifyClient } = require('apify-client'); // APIFY ADDED
const axios = require('axios');
const cron = require('node-cron');
const app = express();
app.use(express.json());

// 🔑 HARDCODED KEYS
const SB_URL = 'https://pvsqvpbjhiwjgifbgmzl.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2c3F2cGJqaGl3amdpZmJnbXpsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDgxNDg0MiwiZXhwIjoyMDk2MzkwODQyfQ.obNCTgtXsFrszT478xb2Cne1mGnxYK-Mls52OccouK4';
const DEFAULT_GEMINI_KEY = 'AQ.Ab8RN6JomLmhvW5ZSmLlMLTrpBj8NzbZPqTtoAqRAdmHIZEEFA';

// 🔑 APIFY CREDENTIALS
const APIFY_TOKEN = 'apify_api_vR3MuRp3NLyql4NTm603ykIAqAa3Fo4x3m1n';
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

// 🔑 BLOGGER CREDENTIALS
const BLOGGER_CLIENT_ID = '347967969883-i25938q4sqpsgoihh3up0s2dahp0e7c9.apps.googleusercontent.com';
const BLOGGER_CLIENT_SECRET = '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';
const BLOGGER_REFRESH_TOKEN = '1//04N1D0adAA4NJCgYIARAAGAQSNwF-L9Ir9PxJtu7wfbQr5srSZEx_HszKuX23n2HdQWkyumqxGz_WKcScM_NKk9Plggmf9qhxMMA';
const BLOG_ID = '4924676053847184907';

const supabase = createClient(SB_URL, SB_KEY);

// Helper: Get Settings
async function getSettings() {
    const { data } = await supabase.from('agent_settings').select('*').eq('id', 1).single();
    return data;
}

// ROUTES
app.get('/', (req, res) => res.send('🤖 PilotBot Engine with Apify is LIVE!'));

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
// 🛒 APIFY: REAL-TIME COUPON & DEAL FETCHER
// ==========================================
app.get('/api/coupons', async (req, res) => {
    const store = req.query.store || 'amazon';
    const keyword = store === 'amazon' ? 'coupons deals' : 'offers deals';
    
    try {
        console.log(`Fetching ${store} coupons via Apify...`);
        const run = await apifyClient.actor("se6u51NCji6y89vBS").call({
            "keywords": [keyword],
            "maxResultsPerKeyword": 5,
            "fullDetails": true,
            "marketplace": "com"
        });
        
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        
        const coupons = items.map(item => ({
            code: item.title || "Deal Active",
            discount: item.price ? `Price: ${item.price}` : "Click to see deal"
        })).slice(0, 5);

        res.json({ coupons: coupons });
    } catch (error) {
        console.error("Apify Error:", error.message);
        res.json({ coupons: [{ code: "API Limit", discount: "Try again later" }] });
    }
});

// ==========================================
// 🎬 APIFY: INSTAGRAM REEL PRODUCT FINDER
// ==========================================
app.post('/api/reel-product', async (req, res) => {
    const { reelUrl } = req.body;
    
    try {
        console.log("Scraping Instagram Reel via Apify...");
        const run = await apifyClient.actor("shu8hvrXbJbY3Eb9W").call({
            "resultsType": "posts",
            "directUrls": [reelUrl],
            "resultsLimit": 1,
            "addParentData": false
        });
        
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        
        if(items.length > 0) {
            const reelData = items[0];
            const caption = reelData.caption || reelData.text || "Product found in reel";
            
            // Use Gemini to extract product name
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
        res.json({ success: false, productName: "Error analyzing reel" });
    }
});

// BLOGGER LOGIC (Same as before)
async function getBloggerAccessToken() { /* ... */ }
cron.schedule('0 8 * * *', async () => { /* ... */ });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 PilotBot Engine with Apify & Blogger Running!'));
