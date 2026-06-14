require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { ApifyClient } = require('apify-client');
const axios = require('axios');
const cron = require('node-cron');
const cors = require('cors');
const { Resend } = require('resend');
const { TwitterApi } = require('twitter-api-v2');
const { google } = require('googleapis');

const app = express();
app.use(cors());
app.use(express.json()));

const SB_URL = process.env.SB_URL;
const SB_KEY = process.env.SB_KEY;
const GROQ_KEY = process.env.GROQ_KEY; 
const APIFY_TOKEN = process.env.APIFY_TOKEN;
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
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

let twitterClient;
if(TWITTER_API_KEY && TWITTER_API_SECRET && TWITTER_ACCESS_TOKEN && TWITTER_ACCESS_SECRET) {
    twitterClient = new TwitterApi({ appKey: TWITTER_API_KEY, appSecret: TWITTER_API_SECRET, accessToken: TWITTER_ACCESS_TOKEN, accessSecret: TWITTER_ACCESS_SECRET });
}

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
    await sendTelegram("🤖 <b>God Mode Activated!</b>\n🔍 Fetching viral products...");
    let report = "📊 <b>Daily Report:</b>\n\n";
    let addedProducts = [];

    try {
        let items = [];

        // 1. APITY SCRAPER (Amazon)
        if(APIFY_TOKEN) {
            try {
                const run = await apifyClient.actor("caoczia~amazon-search").call({ 
                    queries: "trending tech gadgets", maxItems: 2 
                });
                const { items: apifyItems } = await apifyClient.dataset(run.defaultDatasetId).listItems();
                if(apifyItems && apifyItems.length > 0) {
                    items = apifyItems.map(p => ({
                        name: p.title, image: p.imageUrl || p.mainImage, price: p.price || "29.99", 
                        source: 'Amazon', source_url: p.url || `https://www.amazon.com/s?k=${encodeURIComponent(p.title)}`
                    }));
                    report += "✅ Apify Amazon Products Found\n";
                }
            } catch(e) { 
                await sendTelegram("⚠️ Apify failed. Using Free API Backup...");
                report += "⚠️ Apify Failed. Using Backup...\n";
            }
        }

        // 2. FREE API BACKUP (100% Uptime Guarantee)
        if(items.length === 0) {
            try {
                const randomSkip = Math.floor(Math.random() * 50);
                const freeRes = await axios.get(`https://dummyjson.com/products?limit=2&skip=${randomSkip}`);
                if(freeRes.data?.products) {
                    items = freeRes.data.products.map(p => ({
                        name: p.title, image: p.images?.[0] || '', price: p.price || "19.99", 
                        source: 'FreeAPI', source_url: `https://www.amazon.com/s?k=${encodeURIComponent(p.title)}`
                    }));
                    report += "✅ Free API Products Found (Backup)\n";
                }
            } catch(e2) { 
                await sendTelegram("❌ Free API also failed!"); 
            }
        }

        if(items.length === 0) {
            await sendTelegram("🛑 No products found from any source today.");
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

// ==========================================
// 🌐 API ROUTES
// ==========================================
app.get('/', (req, res) => res.send('🤖 PilotBot is AWAKE!'));

app.get('/run-pipeline', async (req, res) => {
    res.send("🚀 Pipeline Triggered! Check Telegram.");
    runGodModePipeline();
});

app.post('/api/admin-login', (req, res) => {
    if(req.body.password === ADMIN_PASSWORD) res.json({ success: true, token: ADMIN_PASSWORD });
    else res.json({ success: false });
});

app.get('/api/admin/stats', async (req, res) => {
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
    
    // Generate Smart Buy Links for Telegram
    const productDetails = products.map(p => {
        const amazonLink = p.source_url || `https://www.amazon.com/s?k=${encodeURIComponent(p.name)}`;
        const aliExpressLink = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(p.name)}`;
        return `
📦 <b>Product:</b> ${p.name}
💵 <b>Buy Price (Approx):</b> $${p.cj_base_cost || (parseFloat(p.price_usd) * 0.5).toFixed(2)}
🛒 <b>Buy on Amazon:</b> <a href="${amazonLink}">Click Here to Buy</a>
🛒 <b>Buy on AliExpress (Cheaper):</b> <a href="${aliExpressLink}">Click Here to Buy</a>
        `;
    }).join('\n');

    const manualMsg = `
🚨 <b>NEW MANUAL ORDER! 💸</b>

 ${productDetails}

💰 <b>Customer Paid You:</b> $${total_price}
📈 <b>Your Profit:</b> $${total_profit}

🏠 <b>Ship To (Copy-Paste this address):</b>
👤 ${buyer_address.fullName || 'N/A'}
📍 ${buyer_address.address || 'N/A'}, ${buyer_address.city || 'N/A'}
🗺️ ${buyer_address.state || 'N/A'}, ${buyer_address.zip || 'N/A'}
🌍 ${buyer_address.country || 'N/A'}
📞 ${buyer_address.phone || 'N/A'}
✉️ ${buyer_email || 'N/A'}

<i>💡 Tip: Click the Buy links above, add to cart, and paste the Ship To address!</i>
    `;
    
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
