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
            model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], temperature: 0.9,
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

// ==========================================
// 🎨 AI DESIGNER AGENT
// ==========================================
async function runDesignerAgent() {
    await sendTelegram("🎨 <b>AI Designer Agent Activated!</b>\n✨ Generating viral Print-on-Demand design...");
    
    try {
        // STEP 1: AI Viral Concept & Image Prompt
        const concept = await askAI(`Give me 1 viral Print-on-Demand t-shirt design concept for today. It should be funny, trending, or aesthetic.
        Output STRICTLY in JSON: { "title": "Product Title (e.g., Funny Cat T-Shirt)", "image_prompt": "A detailed image prompt for AI to generate the design (flat vector, white background, bold text if any)", "category": "Men or Women or Kids" }`);
        if(!concept) return await sendTelegram("🛑 AI Concept generation failed.");

        const parsed = JSON.parse(concept);
        const productTitle = parsed.title;
        const imagePrompt = parsed.image_prompt;
        const category = parsed.category || 'Men';

        // STEP 2: Generate Image using Free Pollinations AI
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}?width=1024&height=1024&nologo=true`;
        await sendTelegram(`🖼️ Design Generated! <a href="${imageUrl}">Click to Preview</a>. Uploading to Printify...`);

        // STEP 3: Upload to Printify (Get Shop ID)
        let printifyProductId = null;
        if(PRINTIFY_API_KEY) {
            try {
                const shopRes = await axios.get('https://api.printify.com/v1/shops.json', { headers: { 'Authorization': `Bearer ${PRINTIFY_API_KEY}` } });
                const shopId = shopRes.data?.data?.[0]?.id || shopRes.data?.[0]?.id;
                
                if(shopId) {
                    // Upload Image to Printify
                    const uploadRes = await axios.post('https://api.printify.com/v1/uploads/images.json', {
                        file_name: `${productTitle.replace(/[^a-z0-9]/gi, '_')}.png`,
                        url: imageUrl
                    }, { headers: { 'Authorization': `Bearer ${PRINTIFY_API_KEY}` } });
                    
                    const printifyImageId = uploadRes.data?.id;
                    
                    if(printifyImageId) {
                        // Create Product in Printify (Blueprint 6 = Unisex T-Shirt)
                        // Note: Variant IDs change based on provider. We use a standard default.
                        await axios.post(`https://api.printify.com/v1/shops/${shopId}/products.json`, {
                            title: productTitle,
                            description: `Premium ${productTitle}. Made with love, shipped worldwide!`,
                            blueprint_id: 6, // 6 is Standard T-Shirt
                            print_provider_id: 1, // 1 is usually default
                            variants: [
                                { id: 17824, price: 2999, is_enabled: true }, // Default Black S
                                { id: 17825, price: 2999, is_enabled: true }, // Default Black M
                                { id: 17826, price: 2999, is_enabled: true }  // Default Black L
                            ],
                            print_areas: [
                                {
                                    variant_ids: [17824, 17825, 17826],
                                    placeholders: [
                                        {
                                            position: "front",
                                            images: [{ id: printifyImageId, x: 0.5, y: 0.5, scale: 1 }]
                                        }
                                    ]
                                }
                            ]
                        }, { headers: { 'Authorization': `Bearer ${PRINTIFY_API_KEY}` } });
                        
                        printifyProductId = "Uploaded";
                        await sendTelegram("✅ <b>Product Created on Printify!</b> Go to dashboard to publish it.");
                    }
                }
            } catch(e) {
                const errMsg = e.response?.data?.message || e.message;
                await sendTelegram(`⚠️ <b>Printify Auto-Upload Failed:</b> ${errMsg}.\n\n🛠️ <b>Manual Fix:</b> Download the image and upload it yourself.`);
            }
        }

        // STEP 4: Add to Website (Supabase)
        const productPrice = "29.99";
        const marketPrice = "54.99";

        const { data: newProduct, error } = await supabase.from('store_products').insert({
            name: productTitle, image: imageUrl, price_usd: productPrice, 
            compare_at_price: marketPrice, 
            description: `Exclusive AI-Generated Design! Premium quality ${productTitle} with FREE Worldwide Shipping. Limited Edition!`, 
            specs: "Material:Premium Cotton|Print:AI Generated|Quality:Exclusive|Shipping:FREE", 
            profit_margin: "18.00", 
            cj_base_cost: "12.00",
            source: 'Printify (AI Design)', 
            source_url: 'https://printify.com/app/dashboard/orders',
            source_id: `ai_${Date.now()}`,
            category: category
        }).select().single();

        if(error) { console.error("Supabase Error:", error); return; }
        
        const productLink = `${WEBSITE_URL}/product/${newProduct.id}`;
        pingIndexNow(productLink);
        submitToGoogleIndex(productLink); 

        await sendTelegram(`🆕 <b>New AI Design Live on Website!</b>\n📦 ${productTitle}\n💰 $${productPrice}\n🔗 <a href="${productLink}">Shop Now!</a>`, true);

        // SEO Blog
        if(BLOG_ID) {
            const blogHTML = await askAI(`Write viral SEO blog "Why ${productTitle} is Trending in 2024". Feature product with image ${imageUrl}. Add yellow buy button: <a href="${productLink}" style="background:#f59e0b;color:#000;padding:15px 30px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:18px;display:inline-block;">Buy Exclusive Design →</a>. HTML only, 400 words.`);
            if(blogHTML) {
                const bToken = await getBloggerToken();
                await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/`, {
                    kind: 'blogger#post', title: `${productTitle} - The Viral Design of 2024`, content: blogHTML, labels: [category, "AI Design", "Trending"]
                }, { headers: { Authorization: `Bearer ${bToken}` } });
            }
        }

        if(twitterClient) {
            try {
                await twitterClient.v2.tweet(`🎨 Exclusive Design Drop: ${productTitle}!\n🚚 FREE Shipping\n💰 $${productPrice}\n\nGet it 👇\n${productLink}\n\n#AI #Design #Trending`);
            } catch(e) {}
        }

    } catch(e) {
        await sendTelegram(`🚨 <b>Designer Agent Crashed!</b>\nError: ${e.message}`);
    }
}

// ==========================================
// 🌐 API ROUTES
// ==========================================
app.get('/', (req, res) => res.send('🎨 AI Designer Agent is AWAKE!'));

app.get('/run-pipeline', async (req, res) => {
    res.send("🚀 Designer Agent Triggered! Check Telegram.");
    runDesignerAgent();
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

// Runs Daily at 10:30 AM IST
cron.schedule('30 4 * * *', () => runDesignerAgent());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎨 AI Designer Agent AWAKE on port ${PORT}!`));
