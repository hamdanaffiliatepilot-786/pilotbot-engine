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

// Environment Variables
const SB_URL = process.env.SB_URL;
const SB_KEY = process.env.SB_KEY;
const GROQ_KEY = process.env.GROQ_KEY; 
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const CJ_ACCESS_TOKEN = process.env.CJ_ACCESS_TOKEN;
const BLOGGER_CLIENT_ID = process.env.BLOGGER_CLIENT_ID;
const BLOGGER_CLIENT_SECRET = process.env.BLOGGER_CLIENT_SECRET;
const BLOGGER_REFRESH_TOKEN = process.env.BLOGGER_REFRESH_TOKEN;
const BLOG_ID = process.env.BLOG_ID;
const PINTEREST_TOKEN = process.env.PINTEREST_TOKEN;
const PINTEREST_BOARD_ID = process.env.PINTEREST_BOARD_ID;
const UNSPLASH_KEY = process.env.UNSPLASH_KEY;
const ADMIN_SECRET_TOKEN = process.env.ADMIN_SECRET_TOKEN || 'default_token';

const supabase = createClient(SB_URL, SB_KEY);
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

async function askAI(prompt) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: "You are a world-class e-commerce SEO copywriter and marketing expert. Always output STRICT JSON." },
                { role: "user", content: prompt }
            ],
            temperature: 0.7,
        }, { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } });
        return response.data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
    } catch(e) { console.error("AI Error:", e.message); return null; }
}

// ==========================================
// 🛒 CORE API ROUTES
// ==========================================

app.get('/', (req, res) => res.send('🤖 PilotBot God Mode V4 is AWAKE!'));

// SAVE ORDER
app.post('/api/save-order', async (req, res) => {
    const { paypal_order_id, products, buyer_email, buyer_address, traffic_source, total_price, total_profit } = req.body;
    if(!paypal_order_id || !products) return res.json({ success: false });
    const expected = new Date(); expected.setDate(expected.getDate() + 12);
    const { data: orderData, error } = await supabase.from('orders').insert({
        paypal_order_id, product_name: products.map(p=>p.name).join(', '), product_image: products[0].image, price_usd: total_price, 
        buyer_email, buyer_address, expected_delivery: expected.toISOString().split('T')[0], status: 'Pending CJ Order',
        traffic_source: traffic_source || 'Direct',
        cj_base_cost: products.reduce((s,p)=>s+parseFloat(p.cj_base_cost||0),0),
        cj_shipping_cost: products.reduce((s,p)=>s+parseFloat(p.cj_shipping_cost||0),0), profit_margin: total_profit
    }).select().single();
    if(error) return res.json({ success: false, error });
    console.log(`✅ NEW ORDER: $${total_price} | Profit: $${total_profit}`);
    res.json({ success: true, order: orderData });
});

// ADMIN STATS
app.get('/api/admin/stats', async (req, res) => {
    const auth = req.headers.authorization;
    if(auth !== `Bearer ${ADMIN_SECRET_TOKEN}`) return res.status(401).json({ error: "Unauthorized" });
    try {
        const { data: orders } = await supabase.from('orders').select('*');
        const { data: products } = await supabase.from('store_products').select('*');
        let totalRevenue = 0, totalCJCost = 0, totalShippingCost = 0, totalProfit = 0;
        const trafficSources = {}; const statusCounts = {};
        orders.forEach(o => {
            const price = parseFloat(String(o.price_usd).replace(/[^0-9.]/g, '')) || 0;
            totalRevenue += price; totalCJCost += parseFloat(o.cj_base_cost)||0; totalShippingCost += parseFloat(o.cj_shipping_cost)||0; totalProfit += parseFloat(o.profit_margin)||0;
            if(o.traffic_source) trafficSources[o.traffic_source] = (trafficSources[o.traffic_source]||0)+1;
            if(o.status) statusCounts[o.status] = (statusCounts[o.status]||0)+1;
        });
        res.json({ success: true, totalOrders: orders.length, totalProducts: products.length, totalRevenue: totalRevenue.toFixed(2), totalCJCost: totalCJCost.toFixed(2), totalShippingCost: totalShippingCost.toFixed(2), totalProfit: totalProfit.toFixed(2), trafficSources, statusCounts, recentOrders: orders.slice(-5).reverse() });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// COMPARE PRICES
app.post('/api/compare-prices', async (req, res) => { const { product } = req.body; if (!product) return res.json({ success: false, prices: [] }); try { const prompt = `I need estimated prices for "${product}" across 8 global platforms. Give me a JSON array with 8 objects. Stores: Amazon, Flipkart, Myntra, Meesho, Ajio, AliExpress, Nykaa, Walmart. Each object must have: "store", "price", "search_query". Just return the raw JSON array.`; let prices = JSON.parse(await askAI(prompt)); prices = prices.map(p => { let url = '#'; const q = encodeURIComponent(p.search_query || product); switch(p.store) { case 'Amazon': url = `https://www.amazon.com/s?k=${q}`; break; case 'Flipkart': url = `https://www.flipkart.com/search?q=${q}`; break; default: url = `https://www.google.com/search?q=buy+${q}`; } return { ...p, url: url }; }); res.json({ success: true, prices: prices }); } catch (error) { res.json({ success: false, prices: [] }); } });

// MANUAL PRODUCT IMPORT
app.get('/api/test-cj', async (req, res) => {
    if (!CJ_ACCESS_TOKEN || !GROQ_KEY) return res.json({ success: false, error: "Missing API Keys" });
    try {
        const cjRes = await axios.get('https://developers.cjdropshipping.com/api2.0/v1/product/list', { params: { pageNum: 1, pageSize: 5 }, headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN } });
        const products = cjRes?.data?.data?.list;
        if(!products) return res.json({ success: false, error: "No products from CJ" });
        let savedCount = 0;
        for (let prod of products) {
            let shipCost = 5.00; 
            try { const s = await axios.post('https://developers.cjdropshipping.com/api2.0/v1/logistics/freight', { pid: prod.productId, vid: prod.defaultVariantId, quantity: 1, country: "US" }, { headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN } }); if(s.data?.data?.totalPrice) shipCost = parseFloat(s.data.data.totalPrice); } catch(e) {}
            const base = parseFloat(prod.sellPrice) || 2;
            const calculatedPrice = ((base + shipCost) * 1.4); const finalPrice = Math.floor(calculatedPrice) + 0.99; const profit = (finalPrice - base - shipCost).toFixed(2);
            const prompt = `Product: ${prod.productNameEn}. JSON: {"seo_title":"Amazon viral title","seo_desc":"2 line desc","specs":"Material: Premium|Shipping: FREE Worldwide|Warranty: 1 Year"}`;
            const r = await askAI(prompt);
            if(r) { const d = JSON.parse(r); await supabase.from('store_products').insert({ cj_product_id: prod.productId, name: d.seo_title, description: d.seo_desc, specs: d.specs, image: prod.productImage, price_usd: finalPrice.toFixed(2), affiliate_link: prod.productUrl, cj_pid: prod.productId, cj_vid: prod.defaultVariantId, cj_base_cost: base.toFixed(2), cj_shipping_cost: shipCost.toFixed(2), profit_margin: profit }); savedCount++; }
        }
        res.json({ success: true, message: `✅ ${savedCount} Smart Priced Products Imported!` });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// ==========================================
// 🤖 AUTOMATION ENGINE (Traffic Monster)
// ==========================================

// CRON 1: Smart Product Import (10 AM Daily)
cron.schedule('0 10 * * *', async () => {
    if (!CJ_ACCESS_TOKEN || !GROQ_KEY) return;
    try {
        const cjRes = await axios.get('https://developers.cjdropshipping.com/api2.0/v1/product/list', { params: { pageNum: 1, pageSize: 5 }, headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN } });
        const products = cjRes?.data?.data?.list; if(!products) return;
        for (let prod of products) {
            let shipCost = 5.00; try { const s = await axios.post('https://developers.cjdropshipping.com/api2.0/v1/logistics/freight', { pid: prod.productId, vid: prod.defaultVariantId, quantity: 1, country: "US" }, { headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN } }); if(s.data?.data?.totalPrice) shipCost = parseFloat(s.data.data.totalPrice); } catch(e) {}
            const base = parseFloat(prod.sellPrice) || 2;
            const calculatedPrice = ((base + shipCost) * 1.4); const finalPrice = Math.floor(calculatedPrice) + 0.99; const profit = (finalPrice - base - shipCost).toFixed(2);
            const prompt = `Product: ${prod.productNameEn}. JSON: {"seo_title":"Amazon viral title","seo_desc":"2 line desc","specs":"Material: Premium|Shipping: FREE Worldwide|Warranty: 1 Year"}`;
            const r = await askAI(prompt);
            if(r) { const d = JSON.parse(r); await supabase.from('store_products').insert({ cj_product_id: prod.productId, name: d.seo_title, description: d.seo_desc, specs: d.specs, image: prod.productImage, price_usd: finalPrice.toFixed(2), affiliate_link: prod.productUrl, cj_pid: prod.productId, cj_vid: prod.defaultVariantId, cj_base_cost: base.toFixed(2), cj_shipping_cost: shipCost.toFixed(2), profit_margin: profit }); }
        }
    } catch(e) { console.error("Cron Product Error:", e.message); }
});

// CRON 2: POWER SEO BLOG + UNSPLASH IMAGES (8 AM Daily)
cron.schedule('0 8 * * *', async () => {
    if(!GROQ_KEY || !BLOGGER_REFRESH_TOKEN) return;
    try {
        const { data: prods } = await supabase.from('store_products').select('*').limit(3).order('created_at', { ascending: false });
        if(!prods || prods.length === 0) return;

        // 1. Fetch High Quality Image from Unsplash
        let imageUrl = 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800'; // Default
        if(UNSPLASH_KEY) {
            try {
                const unsplashRes = await axios.get(`https://api.unsplash.com/photos/random?query=gadgets+technology&client_id=${UNSPLASH_KEY}`);
                imageUrl = unsplashRes.data.urls.regular;
            } catch(e) { console.log("Unsplash failed, using default"); }
        }

        const prodLinks = prods.map(p => `<div style="margin-bottom: 15px; padding: 15px; border: 1px solid #ddd; border-radius: 10px;"><h3><a href="https://yourwebsite.com/product/${p.id}">${p.name}</a></h3><p>Price: $${p.price_usd} (FREE Shipping)</p><a href="https://yourwebsite.com/product/${p.id}" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Buy Now</a></div>`).join('');

        const prompt = `Write a 1500-word highly SEO optimized blog post about the latest trending gadgets of 2024. Use H2, H3 tags, bullet points, and bold texts. Naturally insert these product listings in the middle and end: ${prodLinks}. Output raw HTML only.`;
        const htmlContent = await askAI(prompt);
        if(!htmlContent) return;

        const finalHtml = `<img src="${imageUrl}" alt="Best Gadgets" style="width:100%; border-radius: 10px; margin-bottom: 20px;"/> <br/> ${htmlContent}`;

        const tokenRes = await axios.post('https://oauth2.googleapis.com/token', { client_id: BLOGGER_CLIENT_ID, client_secret: BLOGGER_CLIENT_SECRET, refresh_token: BLOGGER_REFRESH_TOKEN, grant_type: 'refresh_token' });
        const accessToken = tokenRes.data.access_token;

        await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts`, {
            kind: 'blogger#post', title: `Top Trending Gadgets & Best Deals - ${new Date().toLocaleDateString()}`, content: finalHtml
        }, { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
        
        console.log("✅ SEO Blog Posted with Image!");
    } catch(e) { console.error("Blog Cron Error:", e.response?.data || e.message); }
});

// CRON 3: PINTEREST VIRAL PIN (12 PM Daily)
cron.schedule('0 12 * * *', async () => {
    if(!PINTEREST_TOKEN || !PINTEREST_BOARD_ID) return;
    try {
        const { data: prods } = await supabase.from('store_products').select('*').limit(1).order('created_at', { ascending: false });
        if(!prods || prods.length === 0) return;
        const p = prods[0];

        await axios.post('https://api.pinterest.com/v5/pins', {
            board_id: PINTEREST_BOARD_ID,
            title: p.name,
            description: `${p.description} Get it for just $${p.price_usd} with FREE Worldwide Shipping! Shop now. #gadgets #trending #shopping #deals #tech`,
            link: `https://yourwebsite.com/product/${p.id}`,
            media_source: { source_type: "image_url", url: p.image }
        }, { headers: { 'Authorization': `Bearer ${PINTEREST_TOKEN}`, 'Content-Type': 'application/json' } });
        
        console.log("✅ Pinterest Pin Posted!");
    } catch(e) { console.error("Pinterest Error:", e.response?.data || e.message); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 PilotBot V4 Running!'));
