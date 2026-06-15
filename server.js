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
app.use(express.json());

const SB_URL = process.env.SB_URL;
const SB_KEY = process.env.SB_KEY;
const GROQ_KEY = process.env.GROQ_KEY; 
const APIFY_TOKEN = process.env.APIFY_TOKEN;
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
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

let twitterClient;
if(TWITTER_API_KEY && TWITTER_API_SECRET && TWITTER_ACCESS_TOKEN && TWITTER_ACCESS_SECRET) {
    twitterClient = new TwitterApi({ appKey: TWITTER_API_KEY, appSecret: TWITTER_API_SECRET, accessToken: TWITTER_ACCESS_TOKEN, accessSecret: TWITTER_ACCESS_SECRET });
}

async function askAI(prompt) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], temperature: 0.7,
        }, { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } });
        return response.data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').replace(/```html/g, '').replace(/```/g, '').trim();
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

// 🖼️ IMAGE FIXER FUNCTION (Guaranteed to show images)
function getBestImage(printifyImage, productName, category) {
    // If Printify gives a valid HTTPS image, use it
    if(printifyImage && printifyImage.startsWith('https')) return printifyImage;
    // Fallback: High Quality Auto-Generated Image based on category and name (100% works on Next.js)
    const searchQuery = encodeURIComponent(`${category} ${productName} fashion`);
    return `https://loremflickr.com/800/800/${searchQuery}`;
}

async function runGodModePipeline() {
    await sendTelegram("🏭 <b>Printify Beast V17 Activated!</b>\n📦 Importing categorized products with fixed images...");
    let report = "📊 <b>Daily Report:</b>\n\n";
    let addedProducts = [];

    try {
        if(!PRINTIFY_API_KEY) {
            await sendTelegram("🛑 PRINTIFY_API_KEY missing in Render!");
            return;
        }

        const catalogRes = await axios.get('https://api.printify.com/v1/catalog/blueprints.json', { 
            params: { limit: 20 }, 
            headers: { 'Authorization': `Bearer ${PRINTIFY_API_KEY}` } 
        });
        const blueprints = catalogRes.data?.data || catalogRes.data;

        if(!blueprints || blueprints.length === 0) {
            await sendTelegram("🛑 Printify catalog empty or API error.");
            return;
        }

        for(const p of blueprints) {
            const productName = p.title;
            const productId = p.id.toString();

            // DUPLICATE CHECK
            const { data: existing } = await supabase.from('store_products').select('id').eq('source_id', productId).single();
            if(existing) {
                report += `⚠️ Skipped Duplicate: ${productName}\n`;
                continue; 
            }

            // AI CATEGORIZER & PRICING
            const aiDetails = await askAI(`For the Printify product "${productName}", give me:
1. Catchy SEO title (under 60 chars).
2. High-margin selling price USD (T-shirts: 29.99, Hoodies: 44.99, Mugs: 18.99, Phone Cases: 24.99). ONLY number.
3. Category (Men, Women, Kids, Home, Accessories).
4. 2-line description about premium quality and free shipping.
Output STRICTLY JSON: { "title": "...", "price": "...", "category": "...", "desc": "..." }`);
            
            if(!aiDetails) continue;
            
            try {
                const parsed = JSON.parse(aiDetails);
                const productPrice = parseFloat(parsed.price || 29.99).toFixed(2);
                const category = parsed.category || 'Accessories';
                const seoTitle = parsed.title || productName;
                const seoDesc = parsed.desc || 'Premium quality with FREE Worldwide Shipping.';
                const marketPrice = (productPrice * 1.8).toFixed(2); 
                
                // 🖼️ IMAGE FIX APPLIED HERE
                const rawImage = p.images?.[0]?.src || '';
                const finalImage = getBestImage(rawImage, productName, category);

                const { data: newProduct, error } = await supabase.from('store_products').insert({
                    name: seoTitle, image: finalImage, price_usd: productPrice, 
                    compare_at_price: marketPrice, description: seoDesc, 
                    specs: "Material:Premium|Print:High-Resolution|Quality:Guaranteed|Shipping:FREE", 
                    profit_margin: (productPrice * 0.6).toFixed(2), 
                    cj_base_cost: (productPrice * 0.4).toFixed(2),
                    source: 'Printify', 
                    source_url: 'https://printify.com/app/dashboard/orders',
                    source_id: productId,
                    category: category
                }).select().single();

                if(error || !newProduct) { console.error("Supabase Error:", error); continue; }
                
                addedProducts.push(newProduct);
                const productLink = `${WEBSITE_URL}/product/${newProduct.id}`;
                pingIndexNow(productLink);
                submitToGoogleIndex(productLink); 

                // SEO BLOG
                if(BLOG_ID) {
                    const blogHTML = await askAI(`Write viral SEO blog "Top 5 ${seoTitle} Gifts in 2024". Feature #1 product with image ${finalImage}. Add yellow buy button: <a href="${productLink}" style="background:#f59e0b;color:#000;padding:15px 30px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:18px;display:inline-block;">Buy Now →</a>. HTML only, 400 words.`);
                    if(blogHTML) {
                        const bToken = await getBloggerToken();
                        await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/`, {
                            kind: 'blogger#post', title: `Top 5 ${seoTitle} Gifts (2024)`, content: blogHTML, labels: [category, "Gift Guide"]
                        }, { headers: { Authorization: `Bearer ${bToken}` } });
                        report += "✅ Blog Posted\n";
                    }
                }

                // 🎯 PINTEREST TRAFFIC HACK (Manual but 100% effective)
                const pinterestMsg = `📌 <b>Pinterest Traffic Hack!</b>\n📦 Product: ${seoTitle}\n\n📝 <b>Title:</b> Best ${seoTitle} Gift Idea\n✍️ <b>Description:</b> Looking for the perfect ${category} gift? Get this premium ${seoTitle} with FREE Shipping! 🎁✨\n🔗 <b>Link:</b> ${productLink}\n\n<i>Copy this and post it on your Pinterest board!</i>`;
                await sendTelegram(pinterestMsg);

                if(twitterClient) {
                    try {
                        await twitterClient.v2.tweet(`🎁 Gift Idea: ${seoTitle}!\n🚚 FREE Shipping\n💰 $${productPrice}\n\nShop 👇\n${productLink}\n\n#Gifts #Trending`);
                        report += "✅ Tweet Posted\n";
                    } catch(e) { report += "❌ Tweet Failed\n"; }
                }

                await new Promise(r => setTimeout(r, 5000)); 
            } catch(e) { console.error("Parse Error:", e); }
        }
        
        if(addedProducts.length > 0) {
            await sendTelegram(`🆕 <b>${addedProducts.length} New Products Live!</b>`, true);
        }
        
        report += `\n📦 Total Added: ${addedProducts.length}`;
        await sendTelegram(report); 

    } catch(e) {
        await sendTelegram(`🚨 <b>Pipeline Crashed!</b>\nError: ${e.message}`);
    }
}

app.get('/', (req, res) => res.send('🏭 Printify Beast V17 is AWAKE!'));

app.get('/run-pipeline', async (req, res) => {
    res.send("🚀 V17 Triggered! Check Telegram.");
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
    
    const manualMsg = `🚨 <b>NEW ORDER! 💸</b>\n\n📦 <b>Product:</b> ${products.map(p=>p.name).join(', ')}\n🛒 <b>Fulfill via Printify:</b> <a href="https://printify.com/app/dashboard/orders">Dashboard</a>\n\n💰 <b>Paid:</b> $${total_price}\n📈 <b>Profit:</b> $${total_profit}\n\n🏠 <b>Ship To:</b>\n👤 ${buyer_address.fullName || 'N/A'}\n📍 ${buyer_address.address || 'N/A'}, ${buyer_address.city || 'N/A'}\n🗺️ ${buyer_address.state || 'N/A'}, ${buyer_address.zip || 'N/A'}\n🌍 ${buyer_address.country || 'N/A'}\n📞 ${buyer_address.phone || 'N/A'}\n✉️ ${buyer_email || 'N/A'}`;
    
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
cron.schedule('0 11 * * *', () => runGodModePipeline());
cron.schedule('0 17 * * *', () => runGodModePipeline());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🏭 Printify Beast V17 AWAKE on port ${PORT}!`));
