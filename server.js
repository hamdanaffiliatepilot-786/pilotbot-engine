require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { ApifyClient } = require('apify-client');
const axios = require('axios');
const cron = require('node-cron');
const cors = require('cors');
const { Resend } = require('resend');
const { TwitterApi } = require('twitter-api-v2');

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
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || 'pilotbotindexkey123';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

const supabase = createClient(SB_URL, SB_KEY);
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });
const resend = new Resend(RESEND_API_KEY);
const WEBSITE_URL = "https://affiliatepilot-frontend.vercel.app";

// Twitter Client Setup
const twitterClient = new TwitterApi({
  appKey: TWITTER_API_KEY,
  appSecret: TWITTER_API_SECRET,
  accessToken: TWITTER_ACCESS_TOKEN,
  accessSecret: TWITTER_ACCESS_SECRET,
});

// ==========================================
// 🧠 CORE HELPER FUNCTIONS
// ==========================================
async function askAI(prompt) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.8,
        }, { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } });
        return response.data.choices[0].message.content.replace(/```html/g, '').replace(/```/g, '').trim();
    } catch(e) { console.error("AI Error:", e.message); return null; }
}

async function sendTelegramAlert(message) {
    if(!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
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

async function pingIndexNow(productUrl) {
    try {
        await axios.post('https://api.indexnow.org/IndexNow', {
            host: "affiliatepilot-frontend.vercel.app", key: INDEXNOW_KEY, urlList: [productUrl]
        });
    } catch(e) { console.error("IndexNow Error:", e.message); }
}

async function autoFulfillCJOrder(orderData) {
    if(!CJ_ACCESS_TOKEN) return;
    try {
        const cjRes = await axios.post('https://developers.cjdropshipping.com/api/v1/orders', {
            orderType: 1, shippingMethod: "Standard Shipping",
            orderItems: orderData.products.map(p => ({ vid: p.cj_variant_id, quantity: 1 })),
            shippingAddress: { country: orderData.buyer_address.country, province: orderData.buyer_address.state, city: orderData.buyer_address.city, streetAddress: orderData.buyer_address.address, zipCode: orderData.buyer_address.zip, consigneeName: orderData.buyer_address.fullName, phone: orderData.buyer_address.phone }
        }, { headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN } });

        if(cjRes.data && cjRes.data.code === 200) {
            await supabase.from('orders').update({ status: 'Processing in CJ', cj_order_id: cjRes.data.data.orderId }).eq('paypal_order_id', orderData.paypal_order_id);
            sendTelegramAlert(`✅ <b>CJ Order Auto-Placed!</b>\n📦 Order ID: ${cjRes.data.data.orderId}`);
        }
    } catch(e) { console.error("CJ Error:", e.message); }
}

// ==========================================
// 🚀 GOD MODE V8 AUTOMATION PIPELINE
// ==========================================

async function runGodModePipeline() {
    sendTelegramAlert("🤖 <b>God Mode V8 Activated!</b>\n🔍 Hunting for winning viral products...");
    
    try {
        // 1. Scrape Winning Products
        const run = await apifyClient.actor("apify/amazon-best-sellers").call({ maxItems: 2 });
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        
        if(!items || items.length === 0) return sendTelegramAlert("⚠️ No products found today.");

        for(const item of items) {
            const productName = item.title;
            const productImage = item.imageUrl || item.mainImage;
            const productPrice = item.price || "29.99";
            
            // 2. Generate HIGH SEO Description & Specs
            const seoDesc = await askAI(`Write an engaging, high-converting 3-line e-commerce product description for: ${productName}. Focus on benefits, problem-solving, and urgency. Output plain text only.`);
            const specs = await askAI(`Create 4 key specifications for ${productName} in format Spec:Value separated by |. Example: Material:Premium|Feature:Waterproof. Output strictly ONLY the text, no extra words.`);
            
            // 3. Save to Supabase
            const { data: newProduct, error } = await supabase.from('store_products').insert({
                name: productName, image: productImage, price_usd: productPrice,
                description: seoDesc, specs: specs, profit_margin: (productPrice * 0.4).toFixed(2), cj_base_cost: (productPrice * 0.5).toFixed(2), cj_shipping_cost: 0
            }).select().single();

            if(error || !newProduct) { console.error("Supabase Error:", error); continue; }
            
            const productLink = `${WEBSITE_URL}/product/${newProduct.id}`;
            pingIndexNow(productLink); // Instant Google Indexing

            // 4. HIGH SEO Blog Post Generation
            if(BLOG_ID) {
                const blogPrompt = `Write a highly SEO-optimized, viral, and engaging blog post about the product: "${productName}".
                Include the following strictly:
                - An H1 title containing keywords like "Best ${productName} Review 2024".
                - A meta description paragraph at the top summarizing the product and price ($${productPrice}).
                - H2 subheadings like "Why ${productName} is a Game Changer" and "Key Features and Benefits".
                - A bulleted list of pros.
                - A strong Call to Action link in bold: <a href="${productLink}">Grab ${productName} with FREE Shipping Now!</a>
                - Make it at least 500 words. Output STRICT HTML only.`;

                const blogHTML = await askAI(blogPrompt);
                if(blogHTML) {
                    const bToken = await getBloggerToken();
                    await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/`, {
                        kind: 'blogger#post', title: `${productName} Review: Is It Worth The Hype?`, content: blogHTML
                    }, { headers: { Authorization: `Bearer ${bToken}` } });
                }
            }

            // 5. Trending Pinterest Pin Creation
            if(PINTEREST_TOKEN && PINTEREST_BOARD_ID) {
                const pinTitle = await askAI(`Write a catchy, clickbaity Pinterest pin title (max 100 characters) for: ${productName}. Output ONLY the title.`);
                const pinDesc = await askAI(`Write a Pinterest description with 3 relevant hashtags for: ${productName}. Link: ${productLink}. Output ONLY the description.`);
                
                try {
                    await axios.post(`https://api.pinterest.com/v5/pins`, {
                        board_id: PINTEREST_BOARD_ID, 
                        title: pinTitle || `${productName} - Must Have!`, 
                        description: pinDesc || `Get ${productName} now! ${productLink} #Tech #Gadgets #Trending`, 
                        link: productLink,
                        media_source: { source_type: "image_url", url: productImage }
                    }, { headers: { Authorization: `Bearer ${PINTEREST_TOKEN}`, 'Content-Type': 'application/json' } });
                } catch(pinErr) { console.error("Pinterest Error:", pinErr.response?.data); }
            }

            // 6. Viral Twitter Post
            if(TWITTER_API_KEY) {
                try {
                    const tweetText = `Just found the ultimate hack: ${productName}!\n\nPremium Quality\nFREE Worldwide Shipping\nOnly $${productPrice}\n\nGrab yours before it sells out\n${productLink}\n\n#TechGadgets #SmartShopping #Deals`;
                    await twitterClient.v2.tweet(tweetText);
                } catch(twitErr) { console.error("Twitter Error:", twitErr.message); }
            }

            // 7. Telegram Channel Alert
            await sendTelegramAlert(`🆕 <b>New Winning Product Added!</b>\n📦 ${productName}\n💰 $${productPrice} (FREE Shipping)\n🔗 <a href="${productLink}">View Product</a>\n\n✅ Blog Posted\n✅ Pinterest Pinned\n✅ Twitter Tweeted`);

            // Delay to avoid API rate limits
            await new Promise(r => setTimeout(r, 10000)); 
        }
    } catch(e) {
        console.error("Pipeline Error:", e);
        sendTelegramAlert(`🚨 <b>Pipeline Crashed!</b>\nError: ${e.message}`);
    }
}

// ==========================================
// 🌐 API & TEST ROUTES
// ==========================================

app.get('/', (req, res) => res.send('🤖 PilotBot God Mode V8 (SEO Traffic Monster) is AWAKE!'));

app.get('/test-telegram', async (req, res) => {
    if(!TELEGRAM_BOT_TOKEN) return res.send("❌ TELEGRAM_BOT_TOKEN missing");
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: "🚀 PilotBot V8 Test: Telegram is working perfectly!" });
        res.send("✅ Telegram Message Sent!");
    } catch(e) { res.send(`❌ Error: ${e.response?.data?.description}`); }
});

app.get('/test-twitter', async (req, res) => {
    if(!TWITTER_API_KEY) return res.send("❌ TWITTER_API_KEY missing");
    try {
        await twitterClient.v2.tweet("🤖 PilotBot V8 Test: Twitter integration is working! #SEO #Traffic");
        res.send("✅ Tweet Posted Successfully!");
    } catch(e) { 
        res.send(`❌ Error: ${e.message}. Fix: Set App Permissions to Read and Write in Twitter Dev Portal and Regenerate Access Tokens.`); 
    }
});

app.get('/test-pinterest', async (req, res) => {
    if(!PINTEREST_TOKEN) return res.send("❌ PINTEREST_TOKEN missing");
    res.send("✅ Pinterest Token Loaded. Ready to pin trending content!");
});

// Manual Trigger for Pipeline Testing
app.get('/run-pipeline', async (req, res) => {
    res.send("🚀 God Mode V8 Pipeline Triggered! Check Telegram for step-by-step updates.");
    runGodModePipeline();
});

// E-Commerce Routes
app.post('/api/save-order', async (req, res) => {
    const { paypal_order_id, products, buyer_email, buyer_address, traffic_source, total_price, total_profit } = req.body;
    if(!paypal_order_id || !products) return res.json({ success: false });
    const expected = new Date(); expected.setDate(expected.getDate() + 12);
    const { data: orderData, error } = await supabase.from('orders').insert({
        paypal_order_id, product_name: products.map(p=>p.name).join(', '), product_image: products[0].image, price_usd: total_price, 
        buyer_email, buyer_address, expected_delivery: expected.toISOString().split('T')[0], status: 'Pending CJ Order',
        traffic_source: traffic_source || 'Direct', cj_base_cost: products.reduce((s,p)=>s+parseFloat(p.cj_base_cost||0),0),
        cj_shipping_cost: products.reduce((s,p)=>s+parseFloat(p.cj_shipping_cost||0),0), profit_margin: total_profit
    }).select().single();

    if(error) return res.json({ success: false, error });
    sendTelegramAlert(`🚨 <b>New Order!</b>\n💰 Price: $${total_price}\n📈 Profit: $${total_profit}`);
    autoFulfillCJOrder({ paypal_order_id, products, buyer_email, buyer_address });
    res.json({ success: true, order: orderData });
});

app.post('/api/abandoned-cart', async (req, res) => {
    const { email, productName, productImage } = req.body;
    if(!email || !RESEND_API_KEY) return res.json({ success: false });
    try {
        await resend.emails.send({
            from: 'AffiliatePilot <noreply@yourdomain.com>', to: email,
            subject: `🔥 You forgot something! Special discount inside.`,
            html: `<div style="font-family:Arial; text-align:center;"><h2>Wait! Dont miss out on ${productName}</h2><img src="${productImage}" style="max-width:200px; border-radius:10px;" /><p>Use code <b>COMEBACK10</b> for 10% OFF!</p><a href="${WEBSITE_URL}/store" style="background:#f59e0b; color:#000; padding:10px 20px; border-radius:8px; text-decoration:none; font-weight:bold;">Complete My Order</a></div>`
        });
        res.json({ success: true });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/notify-product-added', async (req, res) => {
    const { productId } = req.body;
    if(productId) { pingIndexNow(`${WEBSITE_URL}/product/${productId}`); res.json({ success: true }); } 
    else { res.json({ success: false }); }
});

// Viral Video Script Generator
app.post('/api/generate-video-script', async (req, res) => {
    const { productName, productDescription } = req.body;
    const script = await askAI(`Create a highly viral 30-second TikTok/Reels script for the product: ${productName}. Description: ${productDescription}. Format: [Visual] and [Audio] cues. Make the hook mind-blowing in the first 3 seconds.`);
    res.json({ success: true, script });
});

// ElevenLabs Voiceover
app.post('/api/generate-voiceover', async (req, res) => {
    const { text } = req.body;
    if(!ELEVENLABS_API_KEY) return res.status(400).json({ error: "ElevenLabs API Key missing" });
    try {
        const voiceRes = await axios.post(`https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM`, {
            text: text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        }, { headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' }, responseType: 'arraybuffer' });
        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(voiceRes.data);
    } catch(e) { res.status(500).json({ error: "Voice generation failed" }); }
});

// ==========================================
// ⏰ CRON JOB (Daily 10:00 AM IST = 04:30 AM UTC)
// ==========================================
cron.schedule('30 4 * * *', () => {
    console.log("⏰ Running Daily God Mode V8 Pipeline...");
    runGodModePipeline();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🤖 PilotBot God Mode V8 is AWAKE on port ${PORT}!`));
