require('dotenv').config(); // 🔴 SABSE PEHLE YE HONA ZAROORI HAI
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { ApifyClient } = require('apify-client');
const axios = require('axios');
const cron = require('node-cron');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 🔑 AB SAB KEYS .ENV AUR RENDER SE AAYENGI (CODE MEIN NAHI)
const SB_URL = process.env.SB_URL;
const SB_KEY = process.env.SB_KEY;
const GEM_KEY = process.env.GEMINI_KEY;
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const BLOGGER_CLIENT_ID = process.env.BLOGGER_CLIENT_ID;
const BLOGGER_CLIENT_SECRET = process.env.BLOGGER_CLIENT_SECRET;
const BLOGGER_REFRESH_TOKEN = process.env.BLOGGER_REFRESH_TOKEN;
const BLOG_ID = process.env.BLOG_ID;
const INSTA_SESSION_ID = process.env.INSTA_SESSION_ID;
const UNSPLASH_KEY = process.env.UNSPLASH_KEY;
const CJ_ACCESS_TOKEN = process.env.CJ_ACCESS_TOKEN;
const PINTEREST_TOKEN = process.env.PINTEREST_TOKEN;
const PINTEREST_BOARD_ID = process.env.PINTEREST_BOARD_ID;

// CLIENTS
const supabase = createClient(SB_URL, SB_KEY);
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

async function getSettings() {
    const { data } = await supabase.from('agent_settings').select('*').eq('id', 1).single();
    return data;
}

// ==========================================
// 🛠️ WEBSITE TOOLS API
// ==========================================

app.get('/', (req, res) => res.send('🤖 PilotBot Engine is AWAKE and LIVE!'));

app.get('/ping', (req, res) => res.status(200).send('🤖 PilotBot is awake and running 24/7!'));

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

// 1. EMI Calculator
app.post('/api/emi-calculator', (req, res) => {
    const { principal, rate, tenure } = req.body;
    if (!principal || !rate || !tenure) return res.status(400).json({ success: false, error: "Missing data" });
    const r = rate / (12 * 100);
    const emi = (principal * r * Math.pow(1 + r, tenure)) / (Math.pow(1 + r, tenure) - 1);
    res.json({ success: true, emi: Math.round(emi) });
});

// 2. Real-Time Currency Converter
app.get('/api/currency', async (req, res) => {
    const { from = 'USD', to = 'INR', amount = 1 } = req.query;
    try {
        const { data } = await axios.get(`https://open.er-api.com/v6/latest/${from}`);
        const rate = data.rates[to];
        res.json({ success: true, rate, result: (amount * rate).toFixed(2) });
    } catch (e) { res.json({ success: false, error: "Currency API Error" }); }
});

// 3. AI Price Comparison
app.post('/api/compare-prices', async (req, res) => {
    const { product } = req.body;
    if (!product) return res.json({ success: false, prices: [] });
    
    try {
        const genAI = new GoogleGenerativeAI(GEM_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const prompt = `I need estimated prices for "${product}" across 8 global platforms. Give me a JSON array with 8 objects. Stores must be: Amazon India, Flipkart, Myntra, Meesho, Ajio, AliExpress, Nykaa, and Walmart. Each object must have "store" (string), "price" (estimated string with ₹ symbol), and "url" (search URL string). Just return the raw JSON array, no other text.`;
        
        const result = await model.generateContent(prompt);
        let responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const prices = JSON.parse(responseText);
        res.json({ success: true, prices: prices });
    } catch (error) {
        console.error("Price Compare Error:", error.message);
        res.json({ success: false, prices: [] });
    }
});

// 4. Instagram Reel Product Finder
app.post('/api/reel-product', async (req, res) => {
    const { reelUrl } = req.body;
    if (!reelUrl) return res.json({ success: false, productName: "No URL provided" });
    
    try {
        const run = await apifyClient.actor("shu8hvrXbJbY3Eb9W").call({
            "resultsType": "posts", "directUrls": [reelUrl], "resultsLimit": 1,
            "instagramCookies": [{ "name": "sessionid", "value": INSTA_SESSION_ID, "domain": ".instagram.com" }]
        });
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        
        if(items.length > 0) {
            const caption = items[0].caption || items[0].text || "Product found in reel";
            const genAI = new GoogleGenerativeAI(GEM_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-pro" });
            const prompt = `Analyze this Instagram caption and extract the main product name. Just return the product name, nothing else. Caption: "${caption}"`;
            const result = await model.generateContent(prompt);
            const productName = result.response.text().trim();

            res.json({ 
                success: true, productName: productName,
                searchLink: `https://www.amazon.in/s?k=${encodeURIComponent(productName)}`,
                flipkartLink: `https://www.flipkart.com/search?q=${encodeURIComponent(productName)}`
            });
        } else {
            res.json({ success: false, productName: "Could not identify product" });
        }
    } catch (error) {
        console.error("Apify Reel Error:", error.message);
        res.json({ success: false, productName: "Error analyzing reel." });
    }
});

// 5. Real-Time Coupons
app.get('/api/coupons', async (req, res) => {
    const store = req.query.store || 'amazon';
    const keyword = store === 'amazon' ? 'amazon coupons today' : 'flipkart offers today';
    
    try {
        const run = await apifyClient.actor("se6u51NCji6y89vBS").call({
            "keywords": [keyword], "maxResultsPerKeyword": 3, "fullDetails": true, "marketplace": "com"
        });
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        const coupons = items.map(item => ({
            code: item.title || "Deal Available", discount: item.price ? `Price: ${item.price}` : "Click to see"
        })).slice(0, 3);
        res.json({ coupons: coupons });
    } catch (error) {
        console.error("Apify Coupon Error:", error.message);
        res.json({ coupons: [{ code: "Limit Reached", discount: "Try again later" }] });
    }
});

// 6. Set Price Drop Alert
app.post('/api/price-alert', async (req, res) => {
    const { email, product_url, target_price } = req.body;
    if (!email || !product_url || !target_price) return res.status(400).json({ success: false, error: "Missing fields" });
    const { error } = await supabase.from('price_alerts').insert({ email, product_url, target_price });
    if (!error) res.json({ success: true, message: "Alert set successfully!" });
    else res.json({ success: false, error: error.message });
});

// ==========================================
// 🤖 AUTOMATION ENGINE (Cron Jobs)
// ==========================================

// 🔥 CRON 1: DAILY HIGH-SEO BLOG POST (8 AM Daily)
cron.schedule('0 8 * * *', async () => {
    console.log("⏰ Writing SEO Blog...");
    try {
        const genAI = new GoogleGenerativeAI(GEM_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        
        const prompt = `Write a high SEO shopping guide (800 words) about "Best Tech Deals Today". 
        Return a strict JSON object with: 
        {"title": "SEO Optimized Title", "metaDesc": "160 char meta description", "keywords": "keyword1, keyword2", "content": "HTML content. Use <!--AFF_LINK_1--> where affiliate links should go."}`;
        
        const result = await model.generateContent(prompt);
        let responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const blogData = JSON.parse(responseText);

        let finalContent = blogData.content;
        
        // Fetch Image from Unsplash if key is provided
        if (UNSPLASH_KEY) {
            try {
                const imgRes = await axios.get(`https://api.unsplash.com/photos/random?query=technology-shopping&client_id=${UNSPLASH_KEY}`);
                const imageUrl = imgRes.data.urls.regular;
                finalContent = `<img src="${imageUrl}" alt="${blogData.keywords}" style="max-width:100%;"/><br><br>` + finalContent;
            } catch(e) { console.log("Unsplash image fetch failed, posting without image."); }
        }

        // Post to Blogger
        const accessToken = await getBloggerAccessToken();
        if (accessToken) {
            await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts`, {
                kind: 'blogger#post',
                title: blogData.title,
                content: finalContent + `<br><p>Visit <a href="https://affiliatepilot-frontend.vercel.app">AffiliatePilot</a></p>`
            }, { headers: { Authorization: `Bearer ${accessToken}` } });
            console.log("✅ SEO Blog Posted!");
        }
    } catch(e) { console.log("❌ Blog Error:", e.message); }
});

// 🛒 CRON 2: CJ DROPSHIPPING PRODUCT IMPORTER (10 AM Daily)
cron.schedule('0 10 * * *', async () => {
    if (!CJ_ACCESS_TOKEN) return; // Skip if no key
    console.log("⏰ Importing CJ Products...");
    try {
        const cjRes = await axios.post('https://developers.cjdropshipping.com/api2.0/v1/product/list', {
            pageNum: 1, pageSize: 3
        }, { headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN } });

        const products = cjRes.data.data.list;
        const genAI = new GoogleGenerativeAI(GEM_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });

        for (let prod of products) {
            const aiPrompt = `Analyze this product: Name: ${prod.productNameEn}, Original Price: $${prod.sellPrice}. 
            Give me a JSON: {"seo_title": "high search volume title for India", "seo_desc": "meta description for shopping", "selling_price_inr": calculate_selling_price_in_INR_with_50_percent_margin}`;
            const aiRes = await model.generateContent(aiPrompt);
            let aiText = aiRes.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            const seoData = JSON.parse(aiText);

            await supabase.from('store_products').insert({
                cj_product_id: prod.productId,
                name: seoData.seo_title,
                description: seoData.seo_desc,
                image: prod.productImage,
                price_inr: seoData.selling_price_inr,
                affiliate_link: prod.productUrl
            });
        }
        console.log("✅ CJ Products Imported to Store!");
    } catch(e) { console.log("❌ CJ Error:", e.message); }
});

// 📌 CRON 3: PINTEREST AUTO-PINNER (12 PM Daily)
cron.schedule('0 12 * * *', async () => {
    if (!PINTEREST_TOKEN || !PINTEREST_BOARD_ID) return; // Skip if no keys
    console.log("⏰ Pinning to Pinterest...");
    try {
        const { data: products } = await supabase.from('store_products').select('*').eq('is_pinned', false).limit(3);
        
        for (let prod of products) {
            await axios.post('https://api.pinterest.com/v5/pins', {
                board_id: PINTEREST_BOARD_ID,
                title: prod.name,
                description: prod.description,
                destination_link: `https://affiliatepilot-frontend.vercel.app/store/${prod.id}`,
                media_source: { source_type: "image_url", url: prod.image }
            }, { headers: { Authorization: `Bearer ${PINTEREST_TOKEN}` } });

            await supabase.from('store_products').update({ is_pinned: true }).eq('id', prod.id);
        }
        console.log("✅ Products Pinned to Pinterest!");
    } catch(e) { console.log("❌ Pinterest Error:", e.message); }
});

// 🔑 BLOGGER TOKEN HELPER
async function getBloggerAccessToken() {
    try {
        const response = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: BLOGGER_CLIENT_ID, client_secret: BLOGGER_CLIENT_SECRET, refresh_token: BLOGGER_REFRESH_TOKEN, grant_type: 'refresh_token'
        });
        return response.data.access_token;
    } catch (error) { console.error("Blogger Token Error", error.message); return null; }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 Ultimate PilotBot Engine Running!'));
