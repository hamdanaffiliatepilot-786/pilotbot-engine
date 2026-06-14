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

const SB_URL = process.env.SB_URL;
const SB_KEY = process.env.SB_KEY;
const GROQ_KEY = process.env.GROQ_KEY; 
const PRINTIFY_API_KEY = process.env.PRINTIFY_API_KEY;
const BLOGGER_CLIENT_ID = process.env.BLOGGER_CLIENT_ID;
const BLOGGER_CLIENT_SECRET = process.env.BLOGGER_CLIENT_SECRET;
const BLOGGER_REFRESH_TOKEN = process.env.BLOGGER_REFRESH_TOKEN;
const BLOG_ID = process.env.BLOG_ID;
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
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

const supabase = createClient(SB_URL, SB_KEY);
const resend = new Resend(RESEND_API_KEY);

let twitterClient;
if(TWITTER_API_KEY && TWITTER_API_SECRET && TWITTER_ACCESS_TOKEN && TWITTER_ACCESS_SECRET) {
    twitterClient = new TwitterApi({ appKey: TWITTER_API_KEY, appSecret: TWITTER_API_SECRET, accessToken: TWITTER_ACCESS_TOKEN, accessSecret: TWITTER_ACCESS_SECRET });
}

async function askAI(prompt) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], temperature: 0.8,
        }, { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } });
        return response.data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
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
    if(!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) return;
    try {
        const auth = new google.auth.JWT(GOOGLE_CLIENT_EMAIL, null, GOOGLE_PRIVATE_KEY, ['https://www.googleapis.com/auth/indexing']);
        const indexing = google.indexing({ version: 'v3', auth });
        await indexing.urlNotifications.publish({ requestBody: { type: 'URL_UPDATED', url: url } });
    } catch(e) { console.error("Google Index Error:", e.message); }
}

async function pingIndexNow(productUrl) {
    try { await axios.post('https://api.indexnow.org/IndexNow', { host: "affiliatepilot-frontend.vercel.app", key: "pilotbotindexkey123", urlList: [productUrl] }); } catch(e) {}
}

async function runGodModePipeline() {
    await sendTelegram("🤖 <b>God Mode Activated!</b>\n🔍 Generating viral trending products...");
    let report = "📊 <b>Daily Report:</b>\n\n";
    let addedProducts = [];

    try {
        let items = [];

        // 1. PRINTIFY CATALOG (If Key is available)
        if(PRINTIFY_API_KEY) {
            try {
                const catalogRes = await axios.get('https://api.printify.com/v1/catalog/blueprints.json', { 
                    params: { limit: 2 }, 
                    headers: { 'Authorization': `Bearer ${PRINTIFY_API_KEY}` } 
                });
                const blueprints = catalogRes.data?.data || catalogRes.data;
                if(blueprints && blueprints.length > 0) {
                    items = blueprints.slice(0, 2).map(p => ({
                        name: p.title + " (Premium Print)", image: p.images?.[0]?.src || 'https://via.placeholder.com/400x400?text=T-Shirt', price: "29.99", 
                        source: 'Printify', source_url: 'https://printify.com/app/dashboard/orders'
                    }));
                    report += "✅ Printify Catalog Found\n";
                }
            } catch(e) { 
                const errorDetail = e.response?.data?.message || e.response?.data?.error || e.message;
                await sendTelegram(`⚠️ <b>Printify Error:</b> ${errorDetail}. Using AI Fallback.`);
                report += "⚠️ Printify Failed. Using AI.\n"; 
            }
        }

        // 2. AI PRODUCT GENERATOR (No API Key Needed, 100% Real Trending Products)
        if(items.length === 0) {
            const aiProducts = await askAI(`Give me 2 highly trending, cheap viral tech gadgets or fashion items under $30 that people buy impulsively in 2024. 
            Give generic but real product names like 'Wireless Earbuds' or 'RGB Desk Lamp'. 
            Give output STRICTLY in JSON array format: 
            [{ "name": "Product Name", "price": "19.99" }]
            Output ONLY the JSON array, nothing else.`);
            
            if(aiProducts) {
                try {
                    const parsed = JSON.parse(aiProducts);
                    if(Array.isArray(parsed)) {
                        parsed.forEach(p => {
                            items.push({ 
                                name: p.name, 
                                image: `https://via.placeholder.com/400x400?text=${encodeURIComponent(p.name.substring(0,15))}`, 
                                price: p.price, 
                                source: 'AliExpress', 
                                source_url: `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(p.name)}` 
                            });
                        });
                        report += "✅ AI Generated Real Products\n";
                    }
                } catch(e) { await sendTelegram("❌ AI JSON Parse Error."); }
            }
        }

        if(items.length === 0) {
            await sendTelegram("🛑 Pipeline Stopped. No products generated.");
            return;
        }

        for(const item of items) {
            const productPrice = parseFloat(String(item.price).replace(/[^0-9.]/g, '') || 29.99).toFixed(2);
            
            const seoDesc = await askAI(`Write a high-converting 3-line e-commerce description for: ${item.name}. Focus on urgency and free shipping.`);
            const specs = await askAI(`Create 4 specs for ${item.name} in format Spec:Value separated by |.`);
            const marketPrice = (productPrice * 1.8).toFixed(2);

            const { data: newProduct, error } = await supabase.from('store_products').insert({
                name: item.name, image: item.image, price_usd: productPrice, 
                compare_at_price: marketPrice, description: seoDesc, specs: specs, 
                profit_margin: (productPrice * 0.4).toFixed(2), 
                cj_base_cost: (productPrice * 0.5).toFixed(2),
                source: item.source,
                source_url: item.source_url
            }).select().single();

            if(error || !newProduct) { console.error("Supabase Error:", error); continue; }
            
            addedProducts.push(newProduct);
            const productLink = `${WEBSITE_URL}/product/${newProduct.id}`;
            pingIndexNow(productLink);
            submitToGoogleIndex(productLink); 

            await sendTelegram(`🆕 <b>New Product Live!</b>\n📦 ${item.name}\n💰 $${productPrice}\n🔗 <a href="${productLink}">Shop Now!</a>`, true);

            if(BLOG_ID) {
                const blogHTML = await askAI(`Write elite SEO blog for "${item.name}" ($${productPrice}). HTML only. H1 title, image ${item.image}, H2 features, Pros/Cons, H2 Why Buy (Free shipping), and a yellow Buy Now button linking to ${productLink}. 400 words.`);
                if(blogHTML) {
                    const bToken = await getBloggerToken();
                    await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/`, {
                        kind: 'blogger#post', title: `${item.name} Review: Best Deal?`, content: blogHTML, labels: ["Review", "Deal"]
                    }, { headers: { Authorization: `Bearer ${bToken}` } });
                    report += "✅ Blog Posted\n";
                }
            }

            if(twitterClient) {
                try {
                    await twitterClient.v2.tweet(`🔥 Deal: ${item.name}!\n🚚 FREE Shipping\n💰 Only $${productPrice}\n\nGrab it 👇\n${productLink}\n\n#TechDeals`);
                    report += "✅ Tweet Posted\n";
                } catch(e) { report += "❌ Tweet Failed\n"; }
            }
            await new Promise(r => setTimeout(r, 15000)); 
        }
        
        report += `\n📦 Total Added: ${addedProducts.length}`;
        await sendTelegram(report); 

    } catch(e) {
        await sendTelegram(`🚨 <b>Pipeline Crashed!</b>\nError: ${e.message}`);
    }
}

app.get('/', (req, res) => res.send('🤖 PilotBot is AWAKE!'));

app.get('/run-pipeline', async (req, res) => {
    res.send("🚀 Pipeline Triggered! Check Telegram.");
    runGodModePipeline();
});

app.post('/api/admin-login', (req, res) => {
    if(req.body.password === ADMIN_PASSWORD) res.json({ success: true, token: ADMIN_PASSWORD });
    else res.json({ success: false });
});

app.get('/api/admin-stats', async (req, res) => {
    if(req.headers.authorization !== `Bearer ${ADMIN_PASSWORD}`) return res.status(401).json({ error: "Unauthorized" });
    try {
        const { count: totalOrders } = await supabase.from('orders').select('*', { count: 'exact', head: true });
        const { data: orders } = await supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(10);
        let totalRevenue = 0, totalProfit = 0;
        const { data: allOrders } = await supabase.from('orders').select('price_usd, profit_margin, traffic_source, status');
        const statusCounts = {}, trafficSources = {};
        allOrders?.forEach(o => {
            totalRevenue += parseFloat(o.price_usd || 0);
            totalProfit += parseFloat(o.profit_margin || 0);
            statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
            if(o.traffic_source) trafficSources[o.traffic_source] = (trafficSources[o.traffic_source] || 0) + 1;
        });
        res.json({ success: true, totalOrders, totalRevenue: totalRevenue.toFixed(2), totalProfit: totalProfit.toFixed(2), statusCounts, trafficSources, recentOrders: orders });
    } catch(e) { res.json({ success: false }); }
});

// 🔥 SMART ORDER ROUTE WITH DIRECT BUY LINKS
app.post('/api/save-order', async (req, res) => {
    const { paypal_order_id, products, buyer_email, buyer_address, traffic_source, total_price, total_profit } = req.body;
    if(!paypal_order_id || !products) return res.json({ success: false });
    const expected = new Date(); expected.setDate(expected.getDate() + 12);
    const { data: orderData, error } = await supabase.from('orders').insert({
        paypal_order_id, product_name: products.map(p=>p.name).join(', '), product_image: products[0].image, price_usd: total_price, 
        buyer_email, buyer_address, expected_delivery: expected.toISOString().split('T')[0], status: 'Manual Fulfillment Required',
        traffic_source: traffic_source || 'Direct', profit_margin: total_profit
    }).select().single();

    if(error) return res.json({ success: false, error });
    
    const productDetails = products.map(p => {
        let buyLinkMsg = '';
        if(p.source === 'Printify') {
            buyLinkMsg = `🛒 <b>Fulfill via Printify:</b> <a href="https://printify.com/app/dashboard/orders">Go to Dashboard</a>`;
        } else {
            // For AI/AliExpress/Amazon products, give direct search links
            const aliLink = p.source_url || `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(p.name)}`;
            const amazonLink = `https://www.amazon.com/s?k=${encodeURIComponent(p.name)}`;
            buyLinkMsg = `🛒 <b>Buy on AliExpress:</b> <a href="${aliLink}">Click Here</a>\n🛒 <b>Buy on Amazon:</b> <a href="${amazonLink}">Click Here</a>`;
        }
        return `📦 <b>Product:</b> ${p.name}\n💵 <b>Buy Price:</b> $${p.cj_base_cost || (parseFloat(p.price_usd) * 0.5).toFixed(2)}\n${buyLinkMsg}`;
    }).join('\n');

    const manualMsg = `🚨 <b>NEW MANUAL ORDER! 💸</b>\n\n${productDetails}\n\n💰 <b>Customer Paid:</b> $${total_price}\n📈 <b>Your Profit:</b> $${total_profit}\n\n🏠 <b>Ship To:</b>\n👤 ${buyer_address.fullName || 'N/A'}\n📍 ${buyer_address.address || 'N/A'}, ${buyer_address.city || 'N/A'}\n🗺️ ${buyer_address.state || 'N/A'}, ${buyer_address.zip || 'N/A'}\n🌍 ${buyer_address.country || 'N/A'}\n📞 ${buyer_address.phone || 'N/A'}\n✉️ ${buyer_email || 'N/A'}`;
    
    await sendTelegram(manualMsg.trim());
    res.json({ success: true, order: orderData });
});

app.post('/api/reel-finder', async (req, res) => {
    const { url } = req.body;
    const result = await askAI(`Analyze this Instagram Reel concept: ${url}. Guess the trending product. Give JSON {name, price, reasons[]}`);
    res.json({ success: true, data: JSON.parse(result || '{}') });
});

app.post('/api/get-coupon', async (req, res) => {
    const { store } = req.body;
    const result = await askAI(`Generate 2 realistic fake coupon codes for ${store}. Format: JSON [{code, discount, expiry}]`);
    res.json({ success: true, coupons: JSON.parse(result || '[]') });
});

cron.schedule('0 5 * * *', () => runGodModePipeline());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🤖 PilotBot AWAKE on port ${PORT}!`));
