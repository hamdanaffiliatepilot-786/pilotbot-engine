require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cron = require('node-cron');
const cors = require('cors');
const { Resend } = require('resend');
const { TwitterApi } = require('twitter-api-v2');
const { google } = require('googleapis');

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 🛠️ ENV VARIABLES
// ==========================================
const SB_URL = process.env.SB_URL;
const SB_KEY = process.env.SB_KEY;
const GROQ_KEY = process.env.GROQ_KEY; 
const CJ_ACCESS_TOKEN = process.env.CJ_ACCESS_TOKEN;
const ZENDROP_API_KEY = process.env.ZENDROP_API_KEY;
const BLOGGER_CLIENT_ID = process.env.BLOGGER_CLIENT_ID;
const BLOGGER_CLIENT_SECRET = process.env.BLOGGER_CLIENT_SECRET;
const BLOGGER_REFRESH_TOKEN = process.env.BLOGGER_REFRESH_TOKEN;
const BLOG_ID = process.env.BLOG_ID;
const PINTEREST_TOKEN = process.env.PINTEREST_TOKEN;
const PINTEREST_BOARD_ID = process.env.PINTEREST_BOARD_ID;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID; 
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID; 
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Mrhamdu123@";
const WEBSITE_URL = "https://affiliatepilot-frontend.vercel.app";

// Google Search Console Setup
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

const supabase = createClient(SB_URL, SB_KEY);
const resend = new Resend(RESEND_API_KEY);
const twitterClient = new TwitterApi({ appKey: TWITTER_API_KEY, appSecret: TWITTER_API_SECRET, accessToken: TWITTER_ACCESS_TOKEN, accessSecret: TWITTER_ACCESS_SECRET });

// ==========================================
// 🧠 CORE HELPER FUNCTIONS
// ==========================================
async function askAI(prompt) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], temperature: 0.8,
        }, { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } });
        return response.data.choices[0].message.content.replace(/```html/g, '').replace(/```/g, '').trim();
    } catch(e) { console.error("AI Error:", e.message); return null; }
}

async function sendTelegram(message, isChannel = false) {
    const chatId = isChannel ? TELEGRAM_CHANNEL_ID : TELEGRAM_CHAT_ID;
    if(!TELEGRAM_BOT_TOKEN || !chatId) return;
    try { await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: chatId, text: message, parse_mode: "HTML" }); } 
    catch(e) { console.error("TG Error:", e.message); }
}

async function getBloggerToken() {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', { client_id: BLOGGER_CLIENT_ID, client_secret: BLOGGER_CLIENT_SECRET, refresh_token: BLOGGER_REFRESH_TOKEN, grant_type: 'refresh_token' });
    return tokenRes.data.access_token;
}

async function submitToGoogleIndex(url) {
    if(!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) return console.log("Google Indexing skipped");
    try {
        const auth = new google.auth.JWT(GOOGLE_CLIENT_EMAIL, null, GOOGLE_PRIVATE_KEY, ['https://www.googleapis.com/auth/indexing']);
        const indexing = google.indexing({ version: 'v3', auth });
        await indexing.urlNotifications.publish({ requestBody: { type: 'URL_UPDATED', url: url } });
        console.log("Google Index Submitted:", url);
    } catch(e) { console.error("Google Index Error:", e.message); }
}

async function pingIndexNow(productUrl) {
    try { await axios.post('https://api.indexnow.org/IndexNow', { host: "affiliatepilot-frontend.vercel.app", key: "pilotbotindexkey123", urlList: [productUrl] }); } catch(e) {}
}

// ==========================================
// 🚀 GOD MODE V9 AUTOMATION PIPELINE
// ==========================================
async function runGodModePipeline() {
    await sendTelegram("🤖 <b>God Mode V9 Activated!</b>\n🔍 Fetching winning products from CJ/Zendrop...");
    let report = "📊 <b>Daily Automation Report:</b>\n\n";
    let productsAdded = 0;

    try {
        // 1. FETCH PRODUCTS FROM CJ DROPSHIPPING (Direct API - Better than Amazon Scrape)
        let items = [];
        if(CJ_ACCESS_TOKEN) {
            const cjRes = await axios.get('https://developers.cjdropshipping.com/api/v1/products/list', {
                params: { pageNum: 1, pageSize: 3 }, 
                headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN }
            });
            if(cjRes.data?.data?.list) items = cjRes.data.data.list.map(p => ({
                name: p.productNameEn, image: p.img, price: p.sellPrice, variant_id: p.vid, source: 'CJ'
            }));
        }

        // 2. FETCH FROM ZENDROP IF NEEDED
        if(items.length === 0 && ZENDROP_API_KEY) {
            const zenRes = await axios.get('https://api.zendrop.com/v1/products', { headers: { 'Authorization': `Bearer ${ZENDROP_API_KEY}` } });
            if(zenRes.data?.products) items = zenRes.data.products.map(p => ({
                name: p.title, image: p.image, price: p.variants[0]?.retail_price || "29.99", variant_id: p.variants[0]?.id, source: 'Zendrop'
            }));
        }

        if(items.length === 0) return await sendTelegram("⚠️ No products found from CJ/Zendrop.");

        for(const item of items) {
            const productPrice = parseFloat(item.price || 29.99).toFixed(2);
            const seoDesc = await askAI(`Write a high-converting 3-line e-commerce description for: ${item.name}. Focus on urgency and free shipping.`);
            const specs = await askAI(`Create 4 specs for ${item.name} in format Spec:Value separated by |.`);
            
            const { data: newProduct, error } = await supabase.from('store_products').insert({
                name: item.name, image: item.image, price_usd: productPrice, description: seoDesc, specs: specs,
                profit_margin: (productPrice * 0.4).toFixed(2), cj_base_cost: (productPrice * 0.5).toFixed(2),
                cj_variant_id: item.source === 'CJ' ? item.variant_id : null,
                zendrop_variant_id: item.source === 'Zendrop' ? item.variant_id : null
            }).select().single();

            if(error || !newProduct) { console.error("Supabase Error:", error); continue; }
            productsAdded++;
            
            const productLink = `${WEBSITE_URL}/product/${newProduct.id}`;
            pingIndexNow(productLink);
            submitToGoogleIndex(productLink); // GOOGLE SEARCH CONSOLE INDEXING

            // PUBLIC CHANNEL DEAL
            await sendTelegram(`🆕 <b>New Winning Product Live!</b>\n📦 ${item.name}\n💰 $${productPrice} (FREE Shipping)\n🔗 <a href="${productLink}">Shop Now!</a>`, true);

            // BLOG GENERATION
            if(BLOG_ID) {
                const blogHTML = await askAI(`Write an elite SEO product review blog for "${item.name}". Use H1, H2, lists. Include <img src="${item.image}"> after H1. Add buy button linking to ${productLink}.`);
                if(blogHTML) {
                    const bToken = await getBloggerToken();
                    await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/`, { title: `${item.name} Review: Is It Worth Buying?`, content: blogHTML }, { headers: { Authorization: `Bearer ${bToken}` } });
                    report += "✅ Blog Posted\n";
                }
            }

            // TWITTER
            if(TWITTER_API_KEY) {
                try {
                    await twitterClient.v2.tweet(`🚨 Honest Review: ${item.name}!\n🚚 FREE Worldwide Shipping\n💰 Only $${productPrice}\n\nRead more 👇\n${productLink}\n\n#TechGadgets #SmartShopping`);
                    report += "✅ Tweet Posted\n";
                } catch(e) { report += "❌ Tweet Failed\n"; }
            }
            await new Promise(r => setTimeout(r, 10000)); 
        }
        
        report += `\n📦 Total Products Added: ${productsAdded}`;
        await sendTelegram(report); // DAILY REPORT TO PERSONAL TG

    } catch(e) {
        await sendTelegram(`🚨 <b>Pipeline Crashed!</b>\nError: ${e.message}`);
    }
}

// ==========================================
// 🌐 API ROUTES
// ==========================================
app.get('/', (req, res) => res.send('🤖 PilotBot God Mode V9 is AWAKE!'));

app.post('/api/admin-login', (req, res) => {
    if(req.body.password === ADMIN_PASSWORD) res.json({ success: true, token: ADMIN_PASSWORD });
    else res.json({ success: false });
});

app.get('/api/admin/stats', async (req, res) => {
    if(req.headers.authorization !== `Bearer ${ADMIN_PASSWORD}`) return res.status(401).json({ error: "Unauthorized" });
    try {
        const { count: totalOrders } = await supabase.from('orders').select('*', { count: 'exact', head: true });
        const { data: orders } = await supabase.from('orders').select('profit_margin, cj_base_cost, price_usd, traffic_source, status, paypal_order_id, product_name').order('created_at', { ascending: false }).limit(10);
        
        let totalRevenue = 0, totalProfit = 0, totalCJCost = 0;
        const statusCounts = {}, trafficSources = {};
        
        const { data: allOrders } = await supabase.from('orders').select('price_usd, profit_margin, cj_base_cost, traffic_source, status');
        allOrders?.forEach(o => {
            totalRevenue += parseFloat(o.price_usd || 0);
            totalProfit += parseFloat(o.profit_margin || 0);
            totalCJCost += parseFloat(o.cj_base_cost || 0);
            statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
            if(o.traffic_source) trafficSources[o.traffic_source] = (trafficSources[o.traffic_source] || 0) + 1;
        });

        res.json({ success: true, totalOrders, totalRevenue: totalRevenue.toFixed(2), totalProfit: totalProfit.toFixed(2), totalCJCost: totalCJCost.toFixed(2), statusCounts, trafficSources, recentOrders: orders });
    } catch(e) { res.json({ success: false }); }
});

// SAVE ORDER & AUTO FULFILL CJ / ZENDROP
app.post('/api/save-order', async (req, res) => {
    const { paypal_order_id, products, buyer_email, buyer_address, traffic_source, total_price, total_profit } = req.body;
    if(!paypal_order_id || !products) return res.json({ success: false });
    
    const expected = new Date(); expected.setDate(expected.getDate() + 12);
    const { data: orderData, error } = await supabase.from('orders').insert({
        paypal_order_id, product_name: products.map(p=>p.name).join(', '), product_image: products[0].image, price_usd: total_price, 
        buyer_email, buyer_address, expected_delivery: expected.toISOString().split('T')[0], status: 'Pending Fulfillment',
        traffic_source: traffic_source || 'Direct', cj_base_cost: products.reduce((s,p)=>s+parseFloat(p.cj_base_cost||0),0), profit_margin: total_profit
    }).select().single();

    if(error) return res.json({ success: false, error });
    
    await sendTelegram(`🚨 <b>NEW SALE! 💸</b>\n💰 Price: $${total_price}\n📈 Profit: $${total_profit}`);
    
    // AUTO FULFILL LOGIC
    for(const p of products) {
        if(p.cj_variant_id && CJ_ACCESS_TOKEN) {
            try {
                await axios.post('https://developers.cjdropshipping.com/api/v1/orders', {
                    orderType: 1, shippingMethod: "Standard Shipping",
                    orderItems: [{ vid: p.cj_variant_id, quantity: 1 }],
                    shippingAddress: { country: buyer_address.country, province: buyer_address.state, city: buyer_address.city, streetAddress: buyer_address.address, zipCode: buyer_address.zip, consigneeName: buyer_address.fullName, phone: buyer_address.phone }
                }, { headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN } });
                await supabase.from('orders').update({ status: 'Processing in CJ' }).eq('id', orderData.id);
                await sendTelegram(`✅ <b>CJ Auto-Fulfilled!</b> Order: ${paypal_order_id}`);
            } catch(e) { await sendTelegram(`❌ CJ Fulfillment Failed: ${e.message}`); }
        } 
        else if(p.zendrop_variant_id && ZENDROP_API_KEY) {
            try {
                await axios.post('https://api.zendrop.com/v1/orders', {
                    variant_id: p.zendrop_variant_id, quantity: 1,
                    shipping_address: buyer_address
                }, { headers: { 'Authorization': `Bearer ${ZENDROP_API_KEY}` } });
                await supabase.from('orders').update({ status: 'Processing in Zendrop' }).eq('id', orderData.id);
                await sendTelegram(`✅ <b>Zendrop Auto-Fulfilled!</b> Order: ${paypal_order_id}`);
            } catch(e) { await sendTelegram(`❌ Zendrop Fulfillment Failed: ${e.message}`); }
        }
    }
    res.json({ success: true, order: orderData });
});

// AI POWERFUL TOOLS BACKEND
app.post('/api/reel-finder', async (req, res) => {
    const { url } = req.body;
    const result = await askAI(`Analyze this Instagram Reel URL conceptually: ${url}. Guess the main trending tech/fashion product shown. Give me a realistic product name, an estimated price in USD, and 3 reasons why it's trending. Format: JSON {name, price, reasons[]}`);
    res.json({ success: true, data: JSON.parse(result || '{}') });
});

app.post('/api/get-coupon', async (req, res) => {
    const { store } = req.body;
    const result = await askAI(`Generate 2 realistic-looking, high-urgency fake coupon codes for ${store} that look legit. Format: JSON [{code, discount, expiry}]`);
    res.json({ success: true, coupons: JSON.parse(result || '[]') });
});

// DAILY CRON JOB (10 AM IST)
cron.schedule('30 4 * * *', () => runGodModePipeline());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🤖 PilotBot V9 AWAKE on port ${PORT}!`));
