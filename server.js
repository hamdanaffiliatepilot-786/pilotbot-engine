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

const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

const supabase = createClient(SB_URL, SB_KEY);
const resend = new Resend(RESEND_API_KEY);
let twitterClient;

if(TWITTER_API_KEY && TWITTER_API_SECRET && TWITTER_ACCESS_TOKEN && TWITTER_ACCESS_SECRET) {
    twitterClient = new TwitterApi({ appKey: TWITTER_API_KEY, appSecret: TWITTER_API_SECRET, accessToken: TWITTER_ACCESS_TOKEN, accessSecret: TWITTER_ACCESS_SECRET });
}

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
    if(!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) return;
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
// 🚀 GOD MODE V10 AUTOMATION PIPELINE
// ==========================================
async function runGodModePipeline() {
    await sendTelegram("🤖 <b>God Mode V10 Activated!</b>\n🔍 Fetching winning products from CJ/Zendrop...");
    let report = "📊 <b>Daily V10 Report:</b>\n\n";
    let addedProducts = [];

    try {
        // 1. FETCH PRODUCTS FROM CJ DROPSHIPPING
        let items = [];
        if(CJ_ACCESS_TOKEN) {
            try {
                const cjRes = await axios.post('https://developers.cjdropshipping.com/api/v1.1/product/listProducts', {
                    pageNum: 1, pageSize: 3
                }, { 
                    headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN, 'Content-Type': 'application/json' } 
                });
                
                if(cjRes.data?.data?.list) {
                    items = cjRes.data.data.list.map(p => ({
                        name: p.productNameEn, 
                        image: p.productImage?.[0] || '', 
                        price: p.productVariants?.[0]?.sellPrice || "29.99", 
                        variant_id: p.productVariants?.[0]?.vid || '', 
                        source: 'CJ'
                    })).filter(p => p.variant_id);
                } else {
                    await sendTelegram(`⚠️ <b>CJ Data Empty:</b> ${JSON.stringify(cjRes.data?.message || cjRes.data?.msg || "No list found")}`);
                }
            } catch(e) { 
                const errorMsg = e.response?.data?.message || e.response?.data?.msg || e.message;
                await sendTelegram(`❌ <b>CJ API Error:</b> ${errorMsg}`);
                report += "❌ CJ API Failed\n"; 
            }
        }

        // 2. FETCH FROM ZENDROP IF CJ EMPTY
        if(items.length === 0 && ZENDROP_API_KEY) {
            try {
                const zenRes = await axios.get('https://api.zendrop.com/v2/products', { 
                    params: { limit: 3 },
                    headers: { 'Authorization': `Bearer ${ZENDROP_API_KEY}` } 
                });
                if(zenRes.data?.products) {
                    items = zenRes.data.products.map(p => ({
                        name: p.title, image: p.images?.[0] || '', price: p.variants?.[0]?.retail_price || "29.99", variant_id: p.variants?.[0]?.id, source: 'Zendrop'
                    }));
                } else {
                    await sendTelegram(`⚠️ <b>Zendrop Data Empty:</b> ${JSON.stringify(zenRes.data)}`);
                }
            } catch(e) { 
                const errorMsg = e.response?.data?.message || e.response?.data?.detail || e.message;
                await sendTelegram(`❌ <b>Zendrop API Error:</b> ${errorMsg}`);
                report += "❌ Zendrop API Failed\n"; 
            }
        }

        if(items.length === 0) {
            await sendTelegram("🛑 <b>Pipeline Stopped:</b> No products fetched. Read the API errors above!");
            return;
        }

        for(const item of items) {
            const productPrice = parseFloat(item.price || 29.99).toFixed(2);
            
            // AI SEO TITLE & MARKET PRICE FOR DISCOUNT
            const seoTitle = await askAI(`Rewrite this product name into a highly SEO optimized, clickbaity e-commerce title under 60 characters: ${item.name}. Output ONLY the title.`);
            const marketPrice = (productPrice * 1.8).toFixed(2); // Fake MRP for 50% off illusion
            
            const seoDesc = await askAI(`Write a high-converting 3-line e-commerce description for: ${item.name}. Focus on urgency, problem-solving, and free shipping.`);
            const specs = await askAI(`Create 4 specs for ${item.name} in format Spec:Value separated by |.`);
            
            const { data: newProduct, error } = await supabase.from('store_products').insert({
                name: seoTitle || item.name, image: item.image, price_usd: productPrice, 
                compare_at_price: marketPrice, 
                description: seoDesc, specs: specs,
                profit_margin: (productPrice * 0.4).toFixed(2), cj_base_cost: (productPrice * 0.5).toFixed(2),
                cj_variant_id: item.source === 'CJ' ? item.variant_id : null,
                zendrop_variant_id: item.source === 'Zendrop' ? item.variant_id : null
            }).select().single();

            if(error || !newProduct) { console.error("Supabase Error:", error); continue; }
            
            addedProducts.push(newProduct);
            const productLink = `${WEBSITE_URL}/product/${newProduct.id}`;
            pingIndexNow(productLink);
            submitToGoogleIndex(productLink); 

            // PUBLIC CHANNEL DEAL
            await sendTelegram(`🆕 <b>New Winning Product Live!</b>\n📦 ${newProduct.name}\n💰 $${productPrice} (FREE Shipping)\n🔗 <a href="${productLink}">Shop Now!</a>`, true);

            // SINGLE PRODUCT BLOG
            if(BLOG_ID) {
                const blogPrompt = `You are an elite SEO content writer for 'Affiliate Pilot'. Write a highly engaging, SEO-optimized blog post about: "${newProduct.name}" (Price: $${productPrice}).

STRICT HTML STRUCTURE RULES (Output ONLY valid HTML, no markdown, no \`\`\`):
1. <h1>${newProduct.name} Review: Is It Worth Buying in 2024?</h1>
2. <p><i>Looking for the best deal on ${newProduct.name}? Read our honest review and get FREE Worldwide Shipping today!</i></p>
3. <img src="${item.image}" alt="${newProduct.name} Honest Review" style="width:100%;max-width:600px;border-radius:8px;margin:15px 0;">
4. <h2>What is ${newProduct.name}?</h2><p>Write 100 words explaining the product and the problem it solves.</p>
5. <h2>Key Features & Benefits</h2><ul><li>Feature 1: Benefit</li><li>Feature 2: Benefit</li></ul>
6. <h2>Pros and Cons</h2><h3>Pros</h3><ul><li>Pro 1</li></ul><h3>Cons</h3><ul><li>Con 1</li></ul>
7. <h2>Why Buy from Affiliate Pilot?</h2><p>Highlight FREE Worldwide Shipping, Buyer Protection, and Fast Delivery.</p>
8. <div style="text-align:center; margin:30px 0; padding:20px; background:#fff3cd; border-radius:12px; border:2px solid #ffc107;"><h3>🔥 Grab Yours Today!</h3><a href="${productLink}" style="background-color:#f59e0b; color:#000; padding:15px 30px; border-radius:8px; text-decoration:none; font-weight:bold; font-size:18px; display:inline-block;">Buy Now with FREE Shipping →</a></div>

RULES: Use unique wording. No fluff. Must sound like a real human review. 400 words long.`;

                const blogHTML = await askAI(blogPrompt);
                if(blogHTML) {
                    const bToken = await getBloggerToken();
                    await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/`, {
                        kind: 'blogger#post', title: `${newProduct.name} Review: Pros & Cons`, content: blogHTML, labels: ["Review", "Best Deals", "Tech Gadgets"]
                    }, { headers: { Authorization: `Bearer ${bToken}` } });
                    report += "✅ Product Blog Posted\n";
                }
            }

            // TWITTER
            if(twitterClient) {
                try {
                    await twitterClient.v2.tweet(`🚨 Honest Review: ${newProduct.name}!\n🚚 FREE Worldwide Shipping\n💰 Only $${productPrice}\n\nRead more 👇\n${productLink}\n\n#TechGadgets #SmartShopping`);
                    report += "✅ Tweet Posted\n";
                } catch(e) { report += "❌ Tweet Failed\n"; }
            }
            
            await new Promise(r => setTimeout(r, 15000)); 
        }
        
        // DAILY "TOP PRODUCTS" LISTICLE BLOG 
        if(BLOG_ID && addedProducts.length > 0) {
            await sendTelegram("📝 Generating SEO Nuclear Listicle Blog...");
            let listHTML = `<h1>Top ${addedProducts.length} Trending Tech Gadgets You Must Buy in 2024</h1><p>If you are looking for the best tech gadgets with <b>FREE Worldwide Shipping</b>, you are in the right place! Our AI has handpicked these winning products for you today.</p>`;
            
            addedProducts.forEach((p, i) => {
                listHTML += `<h2>${i+1}. ${p.name}</h2><img src="${p.image}" alt="${p.name}" style="width:100%;max-width:400px;border-radius:8px;margin:10px 0;"><p><b>Price:</b> $${p.price_usd} (Huge Discount!). ${p.description}</p><div style="text-align:center;margin:20px 0;"><a href="${WEBSITE_URL}/product/${p.id}" style="background:#f59e0b;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Buy ${p.name} Now →</a></div><hr>`;
            });

            const bToken = await getBloggerToken();
            await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/`, {
                kind: 'blogger#post', title: `Top ${addedProducts.length} Trending Tech Gadgets in 2024 (Best Deals)`, content: listHTML, labels: ["Top 5", "Listicle", "Gadgets", "Best Deals"]
            }, { headers: { Authorization: `Bearer ${bToken}` } });
            report += "✅ LISTICLE Blog Posted (SEO Power!)\n";
        }

        report += `\n📦 Total Products Added: ${addedProducts.length}`;
        await sendTelegram(report); 

    } catch(e) {
        await sendTelegram(`🚨 <b>Pipeline Crashed!</b>\nError: ${e.message}`);
    }
}

// ==========================================
// 🌐 API ROUTES
// ==========================================
app.get('/', (req, res) => res.send('🤖 PilotBot God Mode V10 is AWAKE!'));

app.get('/run-pipeline', async (req, res) => {
    res.send("🚀 God Mode V10 Pipeline Triggered! Check Telegram for updates.");
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
    
    for(const p of products) {
        if(p.cj_variant_id && CJ_ACCESS_TOKEN) {
            try {
                await axios.post('https://developers.cjdropshipping.com/api/v1.0/order/createOrder', {
                    orderType: 1, shippingMethod: "Standard Shipping",
                    orderItems: [{ vid: p.cj_variant_id, quantity: 1 }],
                    shippingAddress: { country: buyer_address.country, province: buyer_address.state, city: buyer_address.city, streetAddress: buyer_address.address, zipCode: buyer_address.zip, consigneeName: buyer_address.fullName, phone: buyer_address.phone }
                }, { headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN, 'Content-Type': 'application/json' } });
                await supabase.from('orders').update({ status: 'Processing in CJ' }).eq('id', orderData.id);
                await sendTelegram(`✅ <b>CJ Auto-Fulfilled!</b>`);
            } catch(e) { await sendTelegram(`❌ CJ Fulfillment Failed`); }
        } 
        else if(p.zendrop_variant_id && ZENDROP_API_KEY) {
            try {
                await axios.post('https://api.zendrop.com/v1/orders', { variant_id: p.zendrop_variant_id, quantity: 1, shipping_address: buyer_address }, { headers: { 'Authorization': `Bearer ${ZENDROP_API_KEY}` } });
                await supabase.from('orders').update({ status: 'Processing in Zendrop' }).eq('id', orderData.id);
                await sendTelegram(`✅ <b>Zendrop Auto-Fulfilled!</b>`);
            } catch(e) { await sendTelegram(`❌ Zendrop Fulfillment Failed`); }
        }
    }
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

// ==========================================
// ⏰ DAILY CRON JOB (10:30 AM IST = 05:00 AM UTC)
// ==========================================
cron.schedule('0 5 * * *', () => {
    console.log("⏰ Running Daily God Mode V10 Pipeline...");
    runGodModePipeline();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🤖 PilotBot V10 AWAKE on port ${PORT}!`));
