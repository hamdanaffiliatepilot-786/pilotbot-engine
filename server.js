require('dotenv').config(); // 🔴 PEHLE .env file bana aur sab keys wahan daal!
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

// 🔑 KEYS (Ab .env se aayengi)
const supabase = createClient(process.env.SB_URL, process.env.SB_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);
const apifyClient = new ApifyClient({ token: process.env.APIFY_TOKEN });

// ==========================================
// 🛠️ WEBSITE TOOLS API
// ==========================================

// 1. EMI Calculator
app.post('/api/emi-calculator', (req, res) => {
    const { principal, rate, tenure } = req.body;
    const r = rate / (12 * 100);
    const emi = (principal * r * Math.pow(1 + r, tenure)) / (Math.pow(1 + r, tenure) - 1);
    res.json({ success: true, emi: Math.round(emi) });
});

// 2. Real-Time Currency Converter
app.get('/api/currency', async (req, res) => {
    const { from, to, amount } = req.query;
    try {
        const { data } = await axios.get(`https://open.er-api.com/v6/latest/${from}`);
        const rate = data.rates[to];
        res.json({ success: true, rate, result: (amount * rate).toFixed(2) });
    } catch (e) { res.json({ success: false, error: "Currency API Error" }); }
});

// 3. Instagram Reel Product Finder (Existing - Upgraded)
app.post('/api/reel-product', async (req, res) => { /* ... (same as before) ... */ });

// 4. Real-Time Coupons (Existing - Upgraded)
app.get('/api/coupons', async (req, res) => { /* ... (same as before) ... */ });

// 5. Set Price Drop Alert
app.post('/api/price-alert', async (req, res) => {
    const { email, product_url, target_price } = req.body;
    const { error } = await supabase.from('price_alerts').insert({ email, product_url, target_price });
    if (!error) res.json({ success: true, message: "Alert set!" });
    else res.json({ success: false, error });
});

// ==========================================
// 🤖 AUTOMATION ENGINE (Cron Jobs)
// ==========================================

// 🔥 CRON 1: DAILY HIGH-SEO BLOG POST (With Images & Affiliate Placeholders)
cron.schedule('0 8 * * *', async () => {
    console.log("⏰ Writing SEO Blog...");
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        
        // Step 1: Generate Blog Content with SEO Meta & Placeholders
        const prompt = `Write a high SEO shopping guide (800 words) about "Best Tech Deals Today". 
        Return a strict JSON with: 
        {"title": "SEO Title", "metaDesc": "160 char meta desc", "keywords": "kw1, kw2", "content": "HTML content. Use <!--AFF_LINK_1--> where affiliate links should go."}`;
        
        const result = await model.generateContent(prompt);
        const blogData = JSON.parse(result.response.text().replace(/```json/g, '').replace(/```/g, ''));

        // Step 2: Fetch Royalty-Free Image from Unsplash
        const imgRes = await axios.get(`https://api.unsplash.com/photos/random?query=technology&client_id=${process.env.UNSPLASH_KEY}`);
        const imageUrl = imgRes.data.urls.regular;

        // Step 3: Post to Blogger
        const accessToken = await getBloggerAccessToken();
        if (accessToken) {
            // Add Image to content
            let finalContent = `<img src="${imageUrl}" alt="${blogData.keywords}"/><br>` + blogData.content;
            
            // Later, replace <!--AFF_LINK_1--> with real links when you get them
            // finalContent = finalContent.replace('<!--AFF_LINK_1-->', '<a href="YOUR_AMAZON_LINK">Buy Now</a>');

            await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${process.env.BLOG_ID}/posts`, {
                kind: 'blogger#post',
                title: blogData.title,
                content: finalContent + `<br><p>Visit <a href="https://affiliatepilot-frontend.vercel.app">AffiliatePilot</a></p>`
            }, { headers: { Authorization: `Bearer ${accessToken}` } });
            console.log("✅ SEO Blog Posted with Image!");
        }
    } catch(e) { console.log("❌ Blog Error:", e.message); }
});

// 🛒 CRON 2: CJ DROPSHIPPING PRODUCT IMPORTER
cron.schedule('0 10 * * *', async () => {
    console.log("⏰ Importing CJ Products...");
    try {
        // Step 1: Get Trending Products from CJ API
        const cjRes = await axios.post('https://developers.cjdropshipping.com/api2.0/v1/product/list', {
            pageNum: 1, pageSize: 5 // Get 5 products daily
        }, { headers: { 'CJ-Access-Token': process.env.CJ_ACCESS_TOKEN } });

        const products = cjRes.data.data.list;
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });

        for (let prod of products) {
            // Step 2: Enhance with AI for SEO & Pricing
            const aiPrompt = `Analyze this product: Name: ${prod.productNameEn}, Price: $${prod.sellPrice}. 
            Give me a JSON: {"seo_title": "high search volume title", "seo_desc": "meta description", "selling_price_inr": calculate_inr_price_with_50_percent_margin}`;
            const aiRes = await model.generateContent(aiPrompt);
            const seoData = JSON.parse(aiRes.response.text().replace(/```json/g, '').replace(/```/g, ''));

            // Step 3: Save to Supabase Store
            await supabase.from('store_products').insert({
                cj_product_id: prod.productId,
                name: seoData.seo_title,
                description: seoData.seo_desc,
                image: prod.productImage,
                price_inr: seoData.selling_price_inr,
                affiliate_link: prod.productUrl // Placeholder for now
            });
        }
        console.log("✅ CJ Products Imported to Store!");
    } catch(e) { console.log("❌ CJ Error:", e.message); }
});

// 📌 CRON 3: PINTEREST AUTO-PINNER (For Store & Affiliate)
cron.schedule('0 12 * * *', async () => {
    console.log("⏰ Pinning to Pinterest...");
    try {
        // Step 1: Get Unpinned Products from Store
        const { data: products } = await supabase.from('store_products').select('*').eq('is_pinned', false).limit(3);
        
        for (let prod of products) {
            // Step 2: Create Pin via Pinterest API
            await axios.post('https://api.pinterest.com/v5/pins', {
                board_id: process.env.PINTEREST_BOARD_ID,
                title: prod.name,
                description: prod.description,
                destination_link: `https://yourwebsite.com/store/${prod.id}`, // Link to your site
                media_source: { source_type: "image_url", url: prod.image }
            }, { headers: { Authorization: `Bearer ${process.env.PINTEREST_TOKEN}` } });

            // Step 3: Mark as Pinned in DB
            await supabase.from('store_products').update({ is_pinned: true }).eq('id', prod.id);
        }
        console.log("✅ Products Pinned to Pinterest!");
    } catch(e) { console.log("❌ Pinterest Error:", e.message); }
});

// ==========================================
// 🔑 BLOGGER TOKEN HELPER
// ==========================================
async function getBloggerAccessToken() {
    try {
        const response = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: process.env.BLOGGER_CLIENT_ID, 
            client_secret: process.env.BLOGGER_CLIENT_SECRET, 
            refresh_token: process.env.BLOGGER_REFRESH_TOKEN, 
            grant_type: 'refresh_token'
        });
        return response.data.access_token;
    } catch (error) { console.error("Token Error", error.message); return null; }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 Ultimate PilotBot Engine Running!'));
