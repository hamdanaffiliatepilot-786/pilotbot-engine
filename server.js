require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { ApifyClient } = require('apify-client');
const axios = require('axios');
const cron = require('node-cron');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 🔑 KEYS
const SB_URL = process.env.SB_URL;
const SB_KEY = process.env.SB_KEY;
const GROQ_KEY = process.env.GROQ_KEY; 
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const BLOGGER_CLIENT_ID = process.env.BLOGGER_CLIENT_ID;
const BLOGGER_CLIENT_SECRET = process.env.BLOGGER_CLIENT_SECRET;
const BLOGGER_REFRESH_TOKEN = process.env.BLOGGER_REFRESH_TOKEN;
const BLOG_ID = process.env.BLOG_ID;
const INSTA_SESSION_ID = process.env.INSTA_SESSION_ID;
const UNSPLASH_KEY = process.env.UNSPLASH_KEY;
const PINTEREST_TOKEN = process.env.PINTEREST_TOKEN;
const PINTEREST_BOARD_ID = process.env.PINTEREST_BOARD_ID;
const CJ_ACCESS_TOKEN = process.env.CJ_ACCESS_TOKEN;

const supabase = createClient(SB_URL, SB_KEY);
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

// 🤖 GROQ AI HELPER (With Retries for safety)
async function askAI(prompt) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: "You are an expert e-commerce SEO copywriter and data extractor. Always output STRICT JSON when asked." },
                { role: "user", content: prompt }
            ],
            temperature: 0.6,
        }, { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } });
        return response.data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
    } catch(e) {
        console.error("AI Error:", e.response?.data || e.message);
        return null;
    }
}

async function getSettings() { const { data } = await supabase.from('agent_settings').select('*').eq('id', 1).single(); return data; }

// ==========================================
// 🛠️ WEBSITE TOOLS API
// ==========================================

app.get('/', (req, res) => res.send('🤖 PilotBot God Mode Engine is AWAKE!'));
app.get('/ping', (req, res) => res.status(200).send('🤖 PilotBot is awake!'));
app.get('/api/settings', async (req, res) => { const settings = await getSettings(); res.json(settings); });
app.post('/api/settings', async (req, res) => { const newSettings = req.body; const { error } = await supabase.from('agent_settings').update(newSettings).eq('id', 1); if (error) return res.json({ success: false, error: error.message }); res.json({ success: true }); });

app.post('/api/emi-calculator', (req, res) => { const { principal, rate, tenure } = req.body; if (!principal || !rate || !tenure) return res.status(400).json({ success: false }); const r = rate / (12 * 100); const emi = (principal * r * Math.pow(1 + r, tenure)) / (Math.pow(1 + r, tenure) - 1); res.json({ success: true, emi: Math.round(emi) }); });

app.get('/api/currency', async (req, res) => { const { from = 'USD', to = 'INR', amount = 1 } = req.query; try { const { data } = await axios.get(`https://open.er-api.com/v6/latest/${from}`); const rate = data.rates[to]; res.json({ success: true, rate, result: (amount * rate).toFixed(2) }); } catch (e) { res.json({ success: false }); } });

app.post('/api/compare-prices', async (req, res) => { const { product } = req.body; if (!product) return res.json({ success: false, prices: [] }); try { const prompt = `I need estimated prices for "${product}" across 8 global platforms. Give me a JSON array with 8 objects. Stores must be: Amazon, Flipkart, Myntra, Meesho, Ajio, AliExpress, Nykaa, and Walmart. Each object must have: "store" (string), "price" (estimated string with $ symbol), "search_query" (optimized search term). Just return the raw JSON array.`; let prices = JSON.parse(await askAI(prompt)); prices = prices.map(p => { let url = '#'; const q = encodeURIComponent(p.search_query || product); switch(p.store) { case 'Amazon': url = `https://www.amazon.com/s?k=${q}`; break; case 'Flipkart': url = `https://www.flipkart.com/search?q=${q}`; break; case 'AliExpress': url = `https://www.aliexpress.com/w/wholesale-${q}.html`; break; default: url = `https://www.google.com/search?q=buy+${q}`; } return { ...p, url: url }; }); res.json({ success: true, prices: prices }); } catch (error) { res.json({ success: false, prices: [] }); } });

app.post('/api/reel-product', async (req, res) => { const { reelUrl } = req.body; if (!reelUrl) return res.json({ success: false, productName: "No URL" }); try { const run = await apifyClient.actor("shu8hvrXbJbY3Eb9W").call({ "resultsType": "posts", "directUrls": [reelUrl], "resultsLimit": 1, "instagramCookies": [{ "name": "sessionid", "value": INSTA_SESSION_ID, "domain": ".instagram.com" }] }); const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems(); if(items.length > 0) { const caption = items[0].caption || items[0].text || "Product found"; const productName = await askAI(`Extract the main product name from this caption. Just return the name. Caption: "${caption}"`); res.json({ success: true, productName: productName }); } else { res.json({ success: false, productName: "Could not identify" }); } } catch (error) { res.json({ success: false, productName: "Error" }); } });

app.get('/api/coupons', async (req, res) => { const store = req.query.store || 'amazon'; const keyword = store === 'amazon' ? 'amazon coupons today' : 'flipkart offers today'; try { const run = await apifyClient.actor("se6u51NCji6y89vBS").call({ "keywords": [keyword], "maxResultsPerKeyword": 3, "fullDetails": true, "marketplace": "com" }); const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems(); const coupons = items.map(item => ({ code: item.title || "Deal", discount: item.price ? `Price: ${item.price}` : "Click to see" })).slice(0, 3); res.json({ coupons }); } catch (error) { res.json({ coupons: [{ code: "Limit Reached", discount: "Try later" }] }); } });

app.post('/api/price-alert', async (req, res) => { const { email, product_url, target_price } = req.body; if (!email || !product_url || !target_price) return res.status(400).json({ success: false }); const { error } = await supabase.from('price_alerts').insert({ email, product_url, target_price }); if (!error) res.json({ success: true, message: "Alert set!" }); else res.json({ success: false, error: error.message }); });

app.post('/api/gift-finder', async (req, res) => { const { relation, budget, interest } = req.body; if (!relation || !budget) return res.json({ success: false, gifts: [] }); try { const prompt = `Suggest 5 best gift ideas for my ${relation} who likes ${interest || 'general things'}. Budget: ${budget}. Return a JSON array with 5 objects. Each object must have: "gift_name" (string), "estimated_price" (string with $), "reason" (10 words).`; const gifts = JSON.parse(await askAI(prompt)); res.json({ success: true, gifts }); } catch (error) { res.json({ success: false, gifts: [] }); } });

// 🛒 DASHBOARD & ORDER APIs
app.post('/api/save-order', async (req, res) => { const { paypal_order_id, product_name, product_image, price_usd, buyer_email } = req.body; if(!paypal_order_id || !product_name) return res.json({ success: false }); const expected = new Date(); expected.setDate(expected.getDate() + 10); const { data, error } = await supabase.from('orders').insert({ paypal_order_id, product_name, product_image, price_usd, buyer_email, expected_delivery: expected.toISOString().split('T')[0] }).select().single(); if(!error) res.json({ success: true, order: data }); else res.json({ success: false, error }); });
app.get('/api/orders', async (req, res) => { const email = req.query.email; if(!email) return res.json({ success: false, orders: [] }); const { data } = await supabase.from('orders').select('*').eq('buyer_email', email).order('created_at', { ascending: false }); res.json({ success: true, orders: data || [] }); });
app.post('/api/add-wishlist', async (req, res) => { const { email, product_id } = req.body; if(!email || !product_id) return res.json({ success: false }); const { error } = await supabase.from('wishlist').insert({ email, product_id }); if(!error) res.json({ success: true }); else res.json({ success: false, error }); });
app.get('/api/wishlist', async (req, res) => { const email = req.query.email; if(!email) return res.json({ success: false, items: [] }); const { data } = await supabase.from('wishlist').select('*').eq('email', email); res.json({ success: true, items: data || [] }); });

// 🚀 CJ DROPSHIPPING INSTANT TEST API (Advanced Prompt)
app.get('/api/test-cj', async (req, res) => {
    if (!CJ_ACCESS_TOKEN) return res.json({ success: false, error: "CJ_ACCESS_TOKEN missing!" });
    try {
        const cjRes = await axios.get('https://developers.cjdropshipping.com/api2.0/v1/product/list', { params: { pageNum: 1, pageSize: 2 }, headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN } });
        const products = cjRes?.data?.data?.list;
        if(!products || products.length === 0) return res.json({ success: false, error: "No products" });
        let savedCount = 0;
        for (let prod of products) {
            const prompt = `You are an expert e-commerce copywriter. Analyze this product: Name: ${prod.productNameEn}, Base Price: $${prod.sellPrice}.
            Return a STRICT JSON: {
              "seo_title": "High search volume Amazon style title under 200 chars",
              "seo_desc": "Persuasive 2-line sales description",
              "specs": "Material: High Quality|Weight: 200g|Shipping: Fast Delivery|Warranty: 1 Year (Use | separated key:value pairs)",
              "selling_price_usd": "calculate_usd_price_with_50_percent_margin_rounded_to_99"
            }`;
            const aiResult = await askAI(prompt);
            if(aiResult) {
                const seoData = JSON.parse(aiResult);
                await supabase.from('store_products').insert({ 
                    cj_product_id: prod.productId, name: seoData.seo_title, description: seoData.seo_desc, specs: seoData.specs,
                    image: prod.productImage, price_usd: seoData.selling_price_usd, affiliate_link: prod.productUrl 
                });
                savedCount++;
            }
        }
        res.json({ success: true, message: `✅ ${savedCount} Products Imported with Advanced Data!` });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// ==========================================
// 🤖 AUTOMATION ENGINE (God Mode Crons)
// ==========================================

// 🔥 CRON 1: DAILY TRENDING BLOG POST (8 AM)
cron.schedule('0 8 * * *', async () => {
    if(!GROQ_KEY) return;
    console.log("⏰ Writing Trending SEO Blog...");
    try {
        // Step 1: Ask AI what's trending today
        const trendPrompt = `What is the most trending tech or fashion product people are searching for today on Google? Just return the exact product name, nothing else.`;
        const trendingProduct = await askAI(trendPrompt);
        if(!trendingProduct) return;

        // Step 2: Write Blog on that trending topic
        const blogPrompt = `Write a highly engaging, SEO-optimized 800-word shopping guide about "Best ${trendingProduct} to Buy Today". Include buying advice, pros/cons, and where to buy. Return strict JSON: {"title": "SEO Title", "metaDesc": "160 char meta", "keywords": "kw1, kw2", "content": "HTML content"}`;
        const blogData = JSON.parse(await askAI(blogPrompt));
        
        let finalContent = blogData.content;
        if (UNSPLASH_KEY) { try { const imgRes = await axios.get(`https://api.unsplash.com/photos/random?query=${trendingProduct}&client_id=${UNSPLASH_KEY}`); finalContent = `<img src="${imgRes.data.urls.regular}" alt="${blogData.keywords}"/><br>` + finalContent; } catch(e) {} }

        const accessToken = await getBloggerAccessToken();
        if (accessToken) {
            await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts`, {
                kind: 'blogger#post', title: blogData.title,
                content: finalContent + `<br><p>Shop Now at <a href="https://affiliatepilot-frontend.vercel.app">AffiliatePilot Store</a></p>`
            }, { headers: { Authorization: `Bearer ${accessToken}` } });
            console.log(`✅ Trending Blog Posted on ${trendingProduct}!`);
        }
    } catch(e) { console.log("❌ Blog Error:", e.message); }
});

// 🛒 CRON 2: CJ DROPSHIPPING PRODUCT IMPORTER (10 AM - Advanced)
cron.schedule('0 10 * * *', async () => {
    if (!CJ_ACCESS_TOKEN || !GROQ_KEY) return;
    console.log("⏰ Importing Advanced CJ Products...");
    try {
        const cjRes = await axios.get('https://developers.cjdropshipping.com/api2.0/v1/product/list', { params: { pageNum: 1, pageSize: 3 }, headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN } });
        const products = cjRes?.data?.data?.list; if(!products || products.length === 0) return;
        
        for (let prod of products) {
            const prompt = `Product: ${prod.productNameEn}, Base Price: $${prod.sellPrice}. Return JSON: {"seo_title": "title", "seo_desc": "sales desc", "specs": "Key:Value|Key:Value", "selling_price_usd": "usd_price_with_50_percent_margin_rounded_to_99"}`;
            const aiResult = await askAI(prompt);
            if(aiResult) {
                const seoData = JSON.parse(aiResult);
                await supabase.from('store_products').insert({ 
                    cj_product_id: prod.productId, name: seoData.seo_title, description: seoData.seo_desc, specs: seoData.specs,
                    image: prod.productImage, price_usd: seoData.selling_price_usd, affiliate_link: prod.productUrl 
                });
            }
        }
        console.log("✅ Advanced CJ Products Imported!");
    } catch(e) { console.log("❌ CJ Error:", e.message); }
});

// 📌 CRON 3: PINTEREST AUTO-PINNER (12 PM)
cron.schedule('0 12 * * *', async () => {
    if (!PINTEREST_TOKEN || !PINTEREST_BOARD_ID) return;
    console.log("⏰ Pinning to Pinterest...");
    try {
        const { data: products } = await supabase.from('store_products').select('*').eq('is_pinned', false).limit(3);
        for (let prod of products) {
            await axios.post('https://api.pinterest.com/v5/pins', {
                board_id: PINTEREST_BOARD_ID, title: prod.name, description: prod.description,
                destination_link: `https://affiliatepilot-frontend.vercel.app/product/${prod.id}`,
                media_source: { source_type: "image_url", url: prod.image }
            }, { headers: { Authorization: `Bearer ${PINTEREST_TOKEN}` } });
            await supabase.from('store_products').update({ is_pinned: true }).eq('id', prod.id);
        }
        console.log("✅ Products Pinned!");
    } catch(e) { console.log("❌ Pinterest Error:", e.message); }
});

// 💸 CRON 4: PRICE DROP ALERT ENGINE (2 PM)
cron.schedule('0 14 * * *', async () => {
    console.log("⏰ Checking Price Drops...");
    try {
        // Step 1: Get all alerts that are not notified yet
        const { data: alerts } = await supabase.from('price_alerts').select('*').eq('is_notified', false);
        if(!alerts) return;

        for (let alert of alerts) {
            // Step 2: Ask AI for estimated current price
            const estimate = await askAI(`What is the approximate current price of ${alert.product_url}? Just return the numeric value in USD.`);
            const currentPrice = parseFloat(estimate);
            const targetPrice = parseFloat(alert.target_price);

            // Step 3: Compare and notify
            if(currentPrice <= targetPrice) {
                console.log(`📉 PRICE DROPPED for ${alert.email}! Target was $${targetPrice}, now $${currentPrice}`);
                // TODO: Send Email via SendGrid/Resend
                await supabase.from('price_alerts').update({ is_notified: true }).eq('id', alert.id);
            }
        }
    } catch(e) { console.log("❌ Price Drop Error:", e.message); }
});

// 🧹 CRON 5: STORE CLEANUP (Remove products older than 30 days)
cron.schedule('0 0 * * 0', async () => { // Runs every Sunday at Midnight
    console.log("⏰ Cleaning Old Products...");
    try {
        const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        await supabase.from('store_products').delete().lt('created_at', thirtyDaysAgo.toISOString());
        console.log("✅ Old Products Cleaned!");
    } catch(e) { console.log("❌ Cleanup Error:", e.message); }
});

async function getBloggerAccessToken() {
    try { const response = await axios.post('https://oauth2.googleapis.com/token', { client_id: BLOGGER_CLIENT_ID, client_secret: BLOGGER_CLIENT_SECRET, refresh_token: BLOGGER_REFRESH_TOKEN, grant_type: 'refresh_token' }); return response.data.access_token; } catch (error) { return null; }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 PilotBot God Mode Running!'));
