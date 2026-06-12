require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { ApifyClient } = require('apify-client');
const axios = require('axios');
const cron = require('node-cron');
const cors = require('cors');
const { Resend } = require('resend'); // Make sure 'resend' install ho (npm install resend)

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 🛠️ ENV VARIABLES
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
const ADMIN_SECRET_TOKEN = process.env.ADMIN_SECRET_TOKEN || 'super_secret_admin_token_Mrhamdu123@';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || 'pilotbotindexkey123'; // IndexNow Key

const supabase = createClient(SB_URL, SB_KEY);
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });
const resend = new Resend(RESEND_API_KEY); // Resend Init

const WEBSITE_URL = "https://affiliatepilot-frontend.vercel.app";

// ==========================================
// 🧠 CORE HELPER FUNCTIONS
// ==========================================
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
    if(!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return console.log("Telegram vars missing");
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { 
            chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: "HTML" 
        });
    } catch(e) { console.error("Telegram Error:", e.response?.data || e.message); }
}

async function getBloggerToken() {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', { 
        client_id: BLOGGER_CLIENT_ID, client_secret: BLOGGER_CLIENT_SECRET, 
        refresh_token: BLOGGER_REFRESH_TOKEN, grant_type: 'refresh_token' 
    });
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

// ==========================================
// 🚀 GOD MODE V7 NEW FUNCTIONS
// ==========================================

// 1. Google IndexNow Ping (Instant Indexing)
async function pingIndexNow(productUrl) {
    try {
        await axios.post('https://api.indexnow.org/IndexNow', {
            host: "affiliatepilot-frontend.vercel.app",
            key: INDEXNOW_KEY,
            urlList: [productUrl]
        });
        console.log("✅ IndexNow Pinged for:", productUrl);
    } catch(e) { console.error("IndexNow Error:", e.message); }
}

// 2. Auto CJ Dropshipping Order Fulfillment
async function autoFulfillCJOrder(orderData) {
    if(!CJ_ACCESS_TOKEN) return console.log("CJ Token missing, skipping auto-fulfillment");
    
    try {
        const cjRes = await axios.post('https://developers.cjdropshipping.com/api/v1/orders', {
            orderType: 1,
            shippingMethod: "Standard Shipping",
            orderItems: orderData.products.map(p => ({
                vid: p.cj_variant_id, // IMPORTANT: Supabase mein cj_variant_id save hona chahiye
                quantity: 1
            })),
            shippingAddress: {
                country: orderData.buyer_address.country,
                province: orderData.buyer_address.state,
                city: orderData.buyer_address.city,
                streetAddress: orderData.buyer_address.address,
                zipCode: orderData.buyer_address.zip,
                consigneeName: orderData.buyer_address.fullName,
                phone: orderData.buyer_address.phone
            }
        }, {
            headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN }
        });

        if(cjRes.data && cjRes.data.code === 200) {
            await supabase.from('orders').update({ 
                status: 'Processing in CJ',
                cj_order_id: cjRes.data.data.orderId 
            }).eq('paypal_order_id', orderData.paypal_order_id);
            
            sendTelegramAlert(`✅ <b>CJ Order Auto-Placed!</b>\n📦 CJ Order ID: ${cjRes.data.data.orderId}`);
        } else {
            sendTelegramAlert(`⚠️ <b>CJ Auto-Order Failed!</b>\nReason: ${cjRes.data.message}\nManual check required.`);
        }
    } catch(e) {
        console.error("CJ Fulfillment Error:", e.response?.data || e.message);
        sendTelegramAlert(`🚨 <b>CJ API ERROR!</b>\nOrder placement failed. Do it manually.`);
    }
}

// ==========================================
// 🌐 API ROUTES
// ==========================================

app.get('/', (req, res) => res.send('🤖 PilotBot God Mode V7 is AWAKE!'));

// TEST TELEGRAM ROUTE
app.get('/test-telegram', async (req, res) => {
    await sendTelegramAlert("🚀 Test Message from PilotBot! God Mode V7 is active.");
    res.send("Check your Telegram now!");
});

// SAVE ORDER & AUTO FULFILL
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
    
    // 🤖 AUTO FULFILL: Bot turant CJ pe order place karega
    autoFulfillCJOrder({ paypal_order_id, products, buyer_email, buyer_address });

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
            totalRevenue += parseFloat(o.price_usd || 0);
            totalCJCost += parseFloat(o.cj_base_cost || 0);
            totalShippingCost += parseFloat(o.cj_shipping_cost || 0);
            totalProfit += parseFloat(o.profit_margin || 0);
            trafficSources[o.traffic_source || 'Direct'] = (trafficSources[o.traffic_source || 'Direct'] || 0) + 1;
            statusCounts[o.status || 'Unknown'] = (statusCounts[o.status || 'Unknown'] || 0) + 1;
        });
        res.json({ success: true, totalRevenue, totalCJCost, totalShippingCost, totalProfit, totalOrders: safeOrders.length, totalProducts: safeProducts.length, trafficSources, statusCounts });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// INDEXNOW PING ROUTE (Frontend isko call karega jab naya product add ho)
app.post('/api/notify-product-added', async (req, res) => {
    const { productId } = req.body;
    if(productId) {
        pingIndexNow(`${WEBSITE_URL}/product/${productId}`);
        res.json({ success: true, message: "Google Notified via IndexNow!" });
    } else {
        res.json({ success: false });
    }
});

// ABANDONED CART EMAIL (Resend API)
app.post('/api/abandoned-cart', async (req, res) => {
    const { email, productName, productImage } = req.body;
    if(!email || !RESEND_API_KEY) return res.json({ success: false });

    try {
        await resend.emails.send({
            from: 'AffiliatePilot <noreply@yourdomain.com>', // ⚠️ Isko apne verified Resend domain se replace karo
            to: email,
            subject: `🔥 You forgot something! Special discount inside.`,
            html: `<div style="font-family:Arial; text-align:center;">
                     <h2>Wait! Don't miss out on ${productName}</h2>
                     <img src="${productImage}" style="max-width:200px; border-radius:10px;" />
                     <p>Use code <b>COMEBACK10</b> at checkout for 10% OFF!</p>
                     <a href="${WEBSITE_URL}/store" style="background:#f59e0b; color:#000; padding:10px 20px; border-radius:8px; text-decoration:none; font-weight:bold;">Complete My Order</a>
                   </div>`
        });
        res.json({ success: true });
    } catch(e) {
        console.error("Resend Error:", e.message);
        res.json({ success: false });
    }
});

// ELEVENLABS VOICEOVER GENERATOR
app.post('/api/generate-voiceover', async (req, res) => {
    const { text } = req.body;
    if(!ELEVENLABS_API_KEY) return res.status(400).json({ error: "ElevenLabs API Key missing" });
    
    try {
        const voiceRes = await axios.post(`https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM`, {
            text: text,
            model_id: "eleven_multilingual_v2",
            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        }, {
            headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
            responseType: 'arraybuffer'
        });
        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(voiceRes.data);
    } catch(e) {
        console.error("ElevenLabs Error:", e.message);
        res.status(500).json({ error: "Voice generation failed" });
    }
});

// ==========================================
// ⏰ CRON JOBS (Add your existing cron jobs here)
// ==========================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🤖 PilotBot God Mode V7 is AWAKE on port ${PORT}!`));
