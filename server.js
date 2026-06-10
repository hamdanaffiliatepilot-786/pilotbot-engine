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

// ==========================================
// 🔑 ENVIRONMENT VARIABLES
// ==========================================
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
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_SECRET_TOKEN = process.env.ADMIN_SECRET_TOKEN || 'super_secret_admin_token_Mrhamdu123@';

const supabase = createClient(SB_URL, SB_KEY);
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

// ==========================================
// 🤖 HELPER ENGINES
// ==========================================

async function askAI(prompt) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: "You are a world-class e-commerce SEO copywriter. Always output STRICT JSON or strict HTML as requested." },
                { role: "user", content: prompt }
            ],
            temperature: 0.7,
        }, { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } });
        return response.data.choices[0].message.content.replace(/```json/g, '').replace(/```html/g, '').replace(/```/g, '').trim();
    } catch(e) { console.error("AI Error:", e.message); return null; }
}

async function sendTelegramAlert(message) {
    if(!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: "HTML"
        });
    } catch(e) { console.error("Telegram Error:", e.message); }
}

async function sendEmailAlert(to, subject, html) {
    if(!RESEND_API_KEY) return;
    try {
        await axios.post('https://api.resend.com/emails', {
            from: 'AffiliatePilot <onboarding@resend.dev>',
            to: to, subject: subject, html: html
        }, { headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' } });
    } catch(e) { console.error("Resend Error:", e.response?.data || e.message); }
}

async function getBloggerToken() {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', { 
        client_id: BLOGGER_CLIENT_ID, client_secret: BLOGGER_CLIENT_SECRET, refresh_token: BLOGGER_REFRESH_TOKEN, grant_type: 'refresh_token' 
    });
    return tokenRes.data.access_token;
}

// ==========================================
// 🛒 CORE API ROUTES
// ==========================================

app.get('/', (req, res) => res.send('🤖 PilotBot God Mode V5 is AWAKE!'));

// SAVE ORDER + TELEGRAM + EMAIL
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
    
    sendTelegramAlert(`🚨 <b>New Order!</b>\n💰 Price: $${total_price}\n📈 Profit: $${total_profit}\n📦 Product: ${products.map(p=>p.name).join(', ')}`);
    sendEmailAlert(process.env.ADMIN_EMAIL, `🚨 New Order: $${total_price}`, `<h2>New Order Received!</h2><p>Product: ${products.map(p=>p.name).join(', ')}</p><p>Profit: $${total_profit}</p>`);
    res.json({ success: true, order: orderData });
});

// ADMIN STATS (HARDCODED TOKEN FIX)
app.get('/api/admin/stats', async (req, res) => {
    const auth = req.headers.authorization;
    if(auth !== `Bearer super_secret_admin_token_Mrhamdu123@`) return res.status(401).json({ error: "Unauthorized" });
    try {
        const { data: orders } = await supabase.from('orders').select('*');
        const { data: products } = await supabase.from('store_products').select('*');
        
        const safeOrders = orders || [];
        const safeProducts = products || [];
        
        let totalRevenue = 0, totalCJCost = 0, totalShippingCost = 0, totalProfit = 0;
        const trafficSources = {}; const statusCounts = {};
        
        safeOrders.forEach(o => {
            const price = parseFloat(String(o.price_usd).replace(/[^0-9.]/g, '')) || 0;
            totalRevenue += price; totalCJCost += parseFloat(o.cj_base_cost)||0; totalShippingCost += parseFloat(o.cj_shipping_cost)||0; totalProfit += parseFloat(o.profit_margin)||0;
            if(o.traffic_source) trafficSources[o.traffic_source] = (trafficSources[o.traffic_source]||0)+1;
            if(o.status) statusCounts[o.status] = (statusCounts[o.status]||0)+1;
        });
        
        res.json({ success: true, totalOrders: safeOrders.length, totalProducts: safeProducts.length, totalRevenue: totalRevenue.toFixed(2), totalCJCost: totalCJCost.toFixed(2), totalShippingCost: totalShippingCost.toFixed(2), totalProfit: totalProfit.toFixed(2), trafficSources, statusCounts, recentOrders: safeOrders.slice(-5).reverse() });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// COMPARE PRICES
app.post('/api/compare-prices', async (req, res) => { 
    const { product } = req.body; 
    if (!product) return res.json({ success: false, prices: [] }); 
    try { 
        const prompt = `I need estimated prices for "${product}" across 8 platforms. JSON array with 8 objects. Stores: Amazon, Flipkart, Myntra, Meesho, Ajio, AliExpress, Nykaa, Walmart. Keys: "store", "price", "search_query". Raw JSON only.`; 
        let prices = JSON.parse(await askAI(prompt)); 
        prices = prices.map(p => { let url = '#'; const q = encodeURIComponent(p.search_query || product); switch(p.store) { case 'Amazon': url = `https://www.amazon.com/s?k=${q}`; break; case 'Flipkart': url = `https://www.flipkart.com/search?q=${q}`; break; default: url = `https://www.google.com/search?q=buy+${q}`; } return { ...p, url: url }; }); 
        res.json({ success: true, prices: prices }); 
    } catch (error) { res.json({ success: false, prices: [] }); } 
});

// MANUAL PRODUCT IMPORT
app.get('/api/test-cj', async (req, res) => {
    if (!CJ_ACCESS_TOKEN || !GROQ_KEY) return res.json({ success: false, error: "Missing API Keys" });
    try {
        const cjRes = await axios.get('https://developers.cjdropshipping.com/api2.0/v1/product/list', { params: { pageNum: 1, pageSize: 5 }, headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN } });
        const products = cjRes?.data?.data?.list; if(!products) return res.json({ success: false, error: "No products" });
        let savedCount = 0;
        for (let prod of products) {
            let shipCost = 5.00; try { const s = await axios.post('https://developers.cjdropshipping.com/api2.0/v1/logistics/freight', { pid: prod.productId, vid: prod.defaultVariantId, quantity: 1, country: "US" }, { headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN } }); if(s.data?.data?.totalPrice) shipCost = parseFloat(s.data.data.totalPrice); } catch(e) {}
            const base = parseFloat(prod.sellPrice) || 2;
            const calculatedPrice = ((base + shipCost) * 1.4); const finalPrice = Math.floor(calculatedPrice) + 0.99; const profit = (finalPrice - base - shipCost).toFixed(2);
            const r = await askAI(`Product: ${prod.productNameEn}. JSON: {"seo_title":"Amazon viral title","seo_desc":"2 line desc","specs":"Material: Premium|Shipping: FREE|Warranty: 1 Year"}`);
            if(r) { const d = JSON.parse(r); await supabase.from('store_products').insert({ cj_product_id: prod.productId, name: d.seo_title, description: d.seo_desc, specs: d.specs, image: prod.productImage, price_usd: finalPrice.toFixed(2), affiliate_link: prod.productUrl, cj_pid: prod.productId, cj_vid: prod.defaultVariantId, cj_base_cost: base.toFixed(2), cj_shipping_cost: shipCost.toFixed(2), profit_margin: profit }); savedCount++; }
        }
        sendTelegramAlert(`🛍️ <b>Products Imported!</b>\n✅ ${savedCount} new smart-priced products added to store.`);
        res.json({ success: true, message: `✅ ${savedCount} Products Imported!` });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// BLOG SETUP (Creates Important Pages)
app.get('/api/setup-blog', async (req, res) => {
    if(!GROQ_KEY || !BLOGGER_REFRESH_TOKEN) return res.json({ error: "Missing Keys" });
    try {
        const accessToken = await getBloggerToken();
        const pages = [
            { title: "About Us - AffiliatePilot", prompt: "Write a professional 'About Us' page for an AI-powered e-commerce store named AffiliatePilot. Mention we find the best deals, offer FREE worldwide shipping, and use smart AI to compare prices. Format in clean HTML." },
            { title: "Contact Us", prompt: "Write a 'Contact Us' page for AffiliatePilot. Mention users can reach out via email at support@affiliatepilot.com. Format in clean HTML." },
            { title: "Privacy Policy", prompt: "Write a standard legal 'Privacy Policy' page for an e-commerce blog named AffiliatePilot. Include sections on data collection, cookies, and third-party links. Format in clean HTML." },
            { title: "Terms and Conditions", prompt: "Write a standard 'Terms and Conditions' page for an e-commerce store AffiliatePilot. Include sections on AI price estimations, affiliate links, and shipping policies. Format in clean HTML." },
            { title: "Disclaimer", prompt: "Write a 'Disclaimer' page for AffiliatePilot stating that prices are AI-estimated and may vary on the final store, and we use affiliate links for commissions. Format in clean HTML." }
        ];

        for (let page of pages) {
            const content = await askAI(page.prompt);
            if(content) {
                await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/pages`, {
                    kind: 'blogger#page', title: page.title, content: content
                }, { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
            }
        }
        sendTelegramAlert('📝 <b>Blog Setup Complete!</b>\n5 professional legal & about pages have been published to Blogger.');
        res.json({ success: true, message: "✅ Blog setup complete! 5 pages published." });
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
            const r = await askAI(`Product: ${prod.productNameEn}. JSON: {"seo_title":"Amazon viral title","seo_desc":"2 line desc","specs":"Material: Premium|Shipping: FREE|Warranty: 1 Year"}`);
            if(r) { const d = JSON.parse(r); await supabase.from('store_products').insert({ cj_product_id: prod.productId, name: d.seo_title, description: d.seo_desc, specs: d.specs, image: prod.productImage, price_usd: finalPrice.toFixed(2), affiliate_link: prod.productUrl, cj_pid: prod.productId, cj_vid: prod.defaultVariantId, cj_base_cost: base.toFixed(2), cj_shipping_cost: shipCost.toFixed(2), profit_margin: profit }); }
        }
        sendTelegramAlert('🤖 <b>Daily Import Done!</b>\nNew products added to store with smart pricing.');
    } catch(e) { console.error("Cron Error:", e.message); }
});

// CRON 2: POWER SEO BLOG (8 AM Daily)
cron.schedule('0 8 * * *', async () => {
    if(!GROQ_KEY || !BLOGGER_REFRESH_TOKEN) return;
    try {
        const { data: prods } = await supabase.from('store_products').select('*').limit(3).order('created_at', { ascending: false });
        if(!prods || prods.length === 0) return;

        let imageUrl = 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800'; 
        if(UNSPLASH_KEY) { try { const unsplashRes = await axios.get(`https://api.unsplash.com/photos/random?query=gadgets+technology&client_id=${UNSPLASH_KEY}`); imageUrl = unsplashRes.data.urls.regular; } catch(e) {} }

        const prodLinks = prods.map(p => `<div style="margin-bottom: 15px; padding: 15px; border: 1px solid #eee; border-radius: 8px;"><h3><a href="https://yourwebsite.com/product/${p.id}">${p.name}</a></h3><p>Price: $${p.price_usd} (FREE Shipping)</p><a href="https://yourwebsite.com/product/${p.id}" style="background: #2563eb; color: white; padding: 10px 15px; text-decoration: none; border-radius: 5px;">Buy Now →</a></div>`).join('');

        const prompt = `Write a highly SEO optimized 1500-word blog post titled "Top 10 Must-Have Gadgets Under $50 for ${new Date().getFullYear()}". Use H2, H3 tags, bullet points, bold texts. Include introduction, "Top Picks" section with these products: ${prodLinks}, and conclusion. Output raw HTML only.`;
        const htmlContent = await askAI(prompt);
        if(!htmlContent) return;

        const finalHtml = `<img src="${imageUrl}" alt="Best Gadgets" style="width:100%; border-radius: 10px; margin-bottom: 20px;"/> <br/> ${htmlContent}`;
        const accessToken = await getBloggerToken();

        await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts`, {
            kind: 'blogger#post', title: `Top Trending Gadgets & Deals - ${new Date().toLocaleDateString()}`, content: finalHtml
        }, { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
        
        sendTelegramAlert('📝 <b>SEO Blog Live!</b>\nNew blog with images & product links posted.');
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
            board_id: PINTEREST_BOARD_ID, title: p.name,
            description: `${p.description} Get it for $${p.price_usd} with FREE Worldwide Shipping! #gadgets #trending`,
            link: `https://yourwebsite.com/product/${p.id}`,
            media_source: { source_type: "image_url", url: p.image }
        }, { headers: { 'Authorization': `Bearer ${PINTEREST_TOKEN}`, 'Content-Type': 'application/json' } });
        sendTelegramAlert('📌 <b>Pinterest Pin Live!</b>\nProduct pinned for traffic.');
    } catch(e) { console.error("Pinterest Error:", e.response?.data || e.message); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 PilotBot V5 Running!'));
