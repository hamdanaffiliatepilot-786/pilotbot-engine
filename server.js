require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { ApifyClient } = require('apify-client');
const axios = require('axios');
const cron = require('node-cron');
const cors = require('cors');
const { Resend } = require('resend');
const { TwitterApi } = require('twitter-api-v2'); // New Twitter Package

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
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN; // Needed for posting
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET; // Needed for posting
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || 'pilotbotindexkey123';

const supabase = createClient(SB_URL, SB_KEY);
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });
const resend = new Resend(process.env.RESEND_API_KEY);
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
            temperature: 0.7,
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
        console.log("✅ IndexNow Pinged for:", productUrl);
    } catch(e) { console.error("IndexNow Error:", e.message); }
}

// ==========================================
// 🚀 GOD MODE AUTOMATION PIPELINE
// ==========================================

async function runGodModePipeline() {
    sendTelegramAlert("🤖 <b>God Mode Activated!</b>\n🔍 Searching for winning products...");
    
    try {
        // 1. Scrape Winning Products (Amazon Best Sellers Example)
        const run = await apifyClient.actor("apify/amazon-best-sellers").call({ maxItems: 3 });
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        
        if(!items || items.length === 0) return sendTelegramAlert("⚠️ No products found today.");

        for(const item of items) {
            const productName = item.title;
            const productImage = item.imageUrl || item.mainImage;
            const productPrice = item.price || "29.99";
            
            // 2. Generate AI Description & Specs
            const aiDesc = await askAI(`Write a short, viral 2-line e-commerce description for: ${productName}. Output plain text only.`);
            
            // 3. Save to Supabase
            const { data: newProduct, error } = await supabase.from('store_products').insert({
                name: productName, image: productImage, price_usd: productPrice,
                description: aiDesc, specs: "Quality:Premium|Shipping:FREE", profit_margin: (productPrice * 0.4).toFixed(2), cj_base_cost: (productPrice * 0.5).toFixed(2), cj_shipping_cost: 0
            }).select().single();

            if(error || !newProduct) continue;
            
            const productLink = `${WEBSITE_URL}/product/${newProduct.id}`;
            pingIndexNow(productLink); // Instant Google Indexing

            // 4. Post to Blogger
            if(BLOG_ID) {
                const blogHTML = await askAI(`Write a viral, SEO-optimized 500-word tech blog post about: ${productName}. Include this affiliate link naturally: <a href="${productLink}">Buy Now</a>. Output STRICT HTML.`);
                if(blogHTML) {
                    const bToken = await getBloggerToken();
                    await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/`, {
                        kind: 'blogger#post', title: `${productName} - Best Deal & Review!`, content: blogHTML
                    }, { headers: { Authorization: `Bearer ${bToken}` } });
                }
            }

            // 5. Post to Pinterest
            if(PINTEREST_TOKEN && PINTEREST_BOARD_ID) {
                await axios.post(`https://api.pinterest.com/v5/pins`, {
                    board_id: PINTEREST_BOARD_ID, title: productName, 
                    description: `${productName} - Best Price!`, link: productLink,
                    media_source: { source_type: "image_url", url: productImage }
                }, { headers: { Authorization: `Bearer ${PINTEREST_TOKEN}`, 'Content-Type': 'application/json' } });
            }

            // 6. Post to Twitter
            if(TWITTER_API_KEY) {
                try {
                    await twitterClient.v2.tweet(`🔥 Just found an insane deal! ${productName} for just $${productPrice}. Grab it before it's gone! 👇\n${productLink}`);
                } catch(twitErr) { console.error("Twitter Error:", twitErr.message); }
            }

            // 7. Telegram Channel Alert
            await sendTelegramAlert(`🆕 <b>New Winning Product Added!</b>\n📦 ${productName}\n💰 $${productPrice} (FREE Shipping)\n🔗 <a href="${productLink}">View Product</a>`);

            // Delay to avoid API rate limits
            await new Promise(r => setTimeout(r, 5000)); 
        }
    } catch(e) {
        console.error("Pipeline Error:", e);
        sendTelegramAlert(`🚨 <b>Pipeline Crashed!</b>\nError: ${e.message}`);
    }
}

// ==========================================
// 🌐 TEST & API ROUTES
// ==========================================

app.get('/', (req, res) => res.send('🤖 PilotBot God Mode V7 is AWAKE!'));

app.get('/test-telegram', async (req, res) => {
    if(!TELEGRAM_BOT_TOKEN) return res.send("❌ TELEGRAM_BOT_TOKEN missing");
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: "🚀 PilotBot Test: Telegram is working!" });
        res.send("✅ Telegram Message Sent!");
    } catch(e) { res.send(`❌ Error: ${e.response?.data?.description}`); }
});

app.get('/test-twitter', async (req, res) => {
    if(!TWITTER_API_KEY) return res.send("❌ TWITTER_API_KEY missing");
    try {
        await twitterClient.v2.tweet("🤖 PilotBot Test: Twitter integration is working perfectly! #Tech");
        res.send("✅ Tweet Posted Successfully!");
    } catch(e) { res.send(`❌ Error: ${e.message}`); }
});

app.get('/test-pinterest', async (req, res) => {
    if(!PINTEREST_TOKEN) return res.send("❌ PINTEREST_TOKEN missing");
    res.send("✅ Pinterest Token Loaded. Will pin during daily automation.");
});

// Manual Trigger for Pipeline Testing
app.get('/run-pipeline', async (req, res) => {
    res.send("🚀 God Mode Pipeline Triggered! Check Telegram for updates.");
    runGodModePipeline();
});

// ==========================================
// ⏰ CRON JOB (Daily 9:30 AM IST)
// ==========================================
// Cron format: Minute Hour Day Month DayOfWeek
// 30 4 = 4:30 AM UTC = 10:00 AM IST (Adjust as needed)
cron.schedule('30 4 * * *', () => {
    console.log("⏰ Running Daily God Mode Pipeline...");
    runGodModePipeline();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🤖 PilotBot God Mode V7 is AWAKE on port ${PORT}!`));
