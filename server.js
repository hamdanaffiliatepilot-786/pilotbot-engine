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
const ADMIN_SECRET_TOKEN = process.env.ADMIN_SECRET_TOKEN || 'super_secret_admin_token_Mrhamdu123@';

const supabase = createClient(SB_URL, SB_KEY);
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

const WEBSITE_URL = "https://affiliatepilot-frontend.vercel.app";
const LOGO_URL = "https://z-cdn-media.chatglm.cn/files/f57e5ecf-3851-451b-85be-81edc12550ec.png?auth_key=1880958256-a4ec5c83ad274ef88c40ebf635d53c56-0-77f68c8df2516c58efa9b22ef1eebc1e";

async function askAI(prompt) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: "You are a world-class viral tech blog writer for top sites like Wirecutter and Tom's Guide. Always output STRICT, STYLISH HTML." },
                { role: "user", content: prompt }
            ],
            temperature: 0.7,
        }, { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } });
        return response.data.choices[0].message.content.replace(/```html/g, '').replace(/```/g, '').trim();
    } catch(e) { console.error("AI Error:", e.message); return null; }
}

async function sendTelegramAlert(message) {
    if(!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: "HTML" });
    } catch(e) { console.error("Telegram Error:", e.response?.data || e.message); }
}

async function getBloggerToken() {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', { client_id: BLOGGER_CLIENT_ID, client_secret: BLOGGER_CLIENT_SECRET, refresh_token: BLOGGER_REFRESH_TOKEN, grant_type: 'refresh_token' });
    return tokenRes.data.access_token;
}

async function getUnsplashImage(query) {
    let imageUrl = 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800'; 
    if(UNSPLASH_KEY) {
        try {
            const unsplashRes = await axios.get(`https://api.unsplash.com/photos/random?query=${query}&client_id=${UNSPLASH_KEY}`);
            imageUrl = unsplashRes.data.urls.regular;
        } catch(e) {}
    }
    return imageUrl;
}

app.get('/', (req, res) => res.send('🤖 PilotBot God Mode V6 is AWAKE!'));

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
    sendTelegramAlert(`🚨 <b>New Order!</b>\n💰 Price: $${total_price}\n📈 Profit: $${total_profit}\n📦 Product: ${products.map(p=>p.name).join(', ')}`);
    res.json({ success: true, order: orderData });
});

// ADMIN STATS
app.get('/api/admin/stats', async (req, res) => {
    const auth = req.headers.authorization;
    if(auth !== `Bearer super_secret_admin_token_Mrhamdu123@`) return res.status(401).json({ error: "Unauthorized" });
    try {
        const { data: orders } = await supabase.from('orders').select('*');
        const { data: products } = await supabase.from('store_products').select('*');
        const safeOrders = orders || []; const safeProducts = products || [];
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

// BLOG SETUP
app.get('/api/setup-blog', async (req, res) => {
    if(!GROQ_KEY || !BLOGGER_REFRESH_TOKEN) return res.json({ error: "Missing Keys" });
    try {
        const accessToken = await getBloggerToken();
        const pages = [
            { title: "About Us - AffiliatePilot", query: "technology team", prompt: "Write a 1000-word 'About Us' page for AffiliatePilot. Format STRICT HTML. H2, H3, bullet points. End with a link: <a href='${WEBSITE_URL}'>Visit Store</a>." },
            { title: "Contact Us", query: "customer support", prompt: "Write a 'Contact Us' page. Email: support@affiliatepilot.com. Format STRICT HTML." },
            { title: "Privacy Policy", query: "data security", prompt: "Write a legal 'Privacy Policy' for AffiliatePilot. Include Data Collection, Cookies, Third-Party. Format STRICT HTML." },
            { title: "Terms and Conditions", query: "legal document", prompt: "Write 'Terms and Conditions' for AffiliatePilot. Include AI Pricing, Affiliate Links. Format STRICT HTML." },
            { title: "Disclaimer", query: "warning", prompt: "Write a 'Disclaimer' for AffiliatePilot. Prices are AI-estimated. Format STRICT HTML." }
        ];

        for (let page of pages) {
            const imageUrl = await getUnsplashImage(page.query);
            const content = await askAI(page.prompt);
            if(content) {
                const finalHtml = `<div style="text-align:center; margin-bottom:20px;"><a href="${WEBSITE_URL}"><img src="${LOGO_URL}" alt="AffiliatePilot" style="height:60px;"/></a></div><img src="${imageUrl}" alt="${page.title}" style="width:100%; border-radius: 10px; margin-bottom: 20px;"/> <br/> ${content}`;
                await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/pages`, {
                    kind: 'blogger#page', title: page.title, content: finalHtml
                }, { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
            }
        }
        sendTelegramAlert('📝 <b>Blog Setup Complete!</b>\n5 professional pages with Logo & Images published!');
        res.json({ success: true, message: "✅ Blog setup complete!" });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

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
        sendTelegramAlert('🤖 <b>Daily Import Done!</b>\nNew products added.');
    } catch(e) { console.error("Cron Error:", e.message); }
});

// CRON 2: GOD MODE SEO BLOG WITH LOGO & PRODUCT LINKS (8 AM Daily)
cron.schedule('0 8 * * *', async () => {
    if(!GROQ_KEY || !BLOGGER_REFRESH_TOKEN) return;
    try {
        const { data: prods } = await supabase.from('store_products').select('*').limit(3).order('created_at', { ascending: false });
        if(!prods || prods.length === 0) return;

        const prodLinks = prods.map(p => `<div style="margin-bottom: 15px; padding: 15px; border: 1px solid #eee; border-radius: 8px; display:flex; gap:15px; align-items:center;"><img src="${p.image}" alt="${p.name}" style="width:80px; height:80px; object-fit:contain; border-radius:8px;"/><div><h3 style="margin:0 0 5px 0;"><a href="${WEBSITE_URL}/product/${p.id}">${p.name}</a></h3><p style="margin:0 0 10px 0; color:#2563eb; font-weight:bold;">$${p.price_usd} (FREE Shipping)</p><a href="${WEBSITE_URL}/product/${p.id}" style="background: #2563eb; color: white; padding: 8px 15px; text-decoration: none; border-radius: 5px; font-weight:bold;">Buy Now →</a></div></div>`).join('');

        const heroImageUrl = await getUnsplashImage("gadgets technology modern");
        
        // 🔥 GOD MODE PROMPT - 2000 Words, Viral Style, SEO Meta, Logo, Links
        const prompt = `Write a highly SEO optimized, 2000-word blog post in the style of Wirecutter or Tom's Guide, titled "Top 10 Must-Have Gadgets Under $50 for ${new Date().getFullYear()}". 
        
        STRICT FORMATTING RULES:
        1. Start with an engaging hook and a Table of Contents.
        2. Use proper HTML tags: <h2>, <h3>, <p>, <ul>, <li>, <strong>, <blockquote>.
        3. Insert 3 relevant images using this EXACT format: <img src="https://source.unsplash.com/800x400/?keyword1,keyword2" alt="Descriptive SEO alt text" style="width:100%; border-radius: 8px; margin: 15px 0;" /> (replace keyword1,keyword2 with relevant terms like 'smart home gadget', 'wireless earbuds', etc).
        4. Include a "Top Picks" section where these products naturally fit in with detailed reviews (Pros/Cons): ${prodLinks}
        5. Add a "Frequently Asked Questions (FAQ)" section at the end with at least 5 questions and detailed answers.
        6. Add this SEO summary box at the very beginning: <div style="background:#f0f9ff; padding:10px; border-left:4px solid #2563eb; margin-bottom:20px;"><strong>📋 Quick Summary:</strong> Discover the best tech gadgets under $50. We tested and reviewed the top devices for quality and value. <a href="${WEBSITE_URL}/store">Shop all deals here.</a></div>
        7. Add a CTA at the very end: <div style="text-align:center; margin-top:30px; padding:20px; background:#f3f4f6; border-radius:10px;"><h3>Want more deals?</h3><p>Join our Telegram channel for daily alerts: <a href="https://t.me/affiliatepilot_deals">Join Here</a></p><a href="${WEBSITE_URL}" style="background:#2563eb; color:white; padding:10px 20px; text-decoration:none; border-radius:5px; font-weight:bold;">Visit AffiliatePilot Store</a></div>
        8. Output STRICT RAW HTML ONLY. No markdown.`;
        
        const htmlContent = await askAI(prompt);
        if(!htmlContent) return;

        const finalHtml = `<div style="text-align:center; margin-bottom:20px;"><a href="${WEBSITE_URL}"><img src="${LOGO_URL}" alt="AffiliatePilot" style="height:60px;"/></a></div><img src="${heroImageUrl}" alt="Best Gadgets ${new Date().getFullYear()}" style="width:100%; border-radius: 10px; margin-bottom: 20px;"/> <br/> ${htmlContent}`;
        const accessToken = await getBloggerToken();

        await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts`, {
            kind: 'blogger#post', 
            title: `Top Trending Gadgets & Best Deals - ${new Date().toLocaleDateString()}`, 
            content: finalHtml
        }, { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
        
        sendTelegramAlert('📝 <b>GOD MODE Blog Live!</b>\nNew 2000-word viral blog with Logo, Product Links & Images posted!');
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
            link: `${WEBSITE_URL}/product/${p.id}`,
            media_source: { source_type: "image_url", url: p.image }
        }, { headers: { 'Authorization': `Bearer ${PINTEREST_TOKEN}`, 'Content-Type': 'application/json' } });
        sendTelegramAlert('📌 <b>Pinterest Pin Live!</b>\nProduct pinned for traffic.');
    } catch(e) { console.error("Pinterest Error:", e.response?.data || e.message); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 PilotBot V6 Running!'));
