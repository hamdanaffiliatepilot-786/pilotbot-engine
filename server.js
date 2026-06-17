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
app.use(express.json({ limit: '10mb' }));

const SB_URL = process.env.SB_URL;
const SB_KEY = process.env.SB_KEY;
const GROQ_KEY = process.env.GROQ_KEY;
const PRINTIFY_API_KEY = process.env.PRINTIFY_API_KEY;
const BLOGGER_CLIENT_ID = process.env.BLOGGER_CLIENT_ID;
const BLOGGER_CLIENT_SECRET = process.env.BLOGGER_CLIENT_SECRET;
const BLOGGER_REFRESH_TOKEN = process.env.BLOGGER_CLIENT_ID ? process.env.BLOGGER_REFRESH_TOKEN : process.env.BLOGGER_REFRESH_TOKEN;
const BLOGGER_REFRESH_TOKEN_REAL = process.env.BLOGGER_REFRESH_TOKEN;
const BLOG_ID = process.env.BLOG_ID;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_CHANNEL_ID = process.env.TLOGGER_CHANNEL_ID;
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Mrhamdu123@";
const WEBSITE_URL = "https://affiliatepilot-frontend.vercel.app";
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@pilotstaff.com";

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
        return response.data.choices[0].message.content.replace(/```json/g, '').replace(/```html/g, '').replace(/```/g, '').trim();
    } catch(e) { console.error("AI Error:", e.message); return null; }
}

async function sendTelegram(message, isChannel = false) {
    const chatId = isChannel ? TELEGRAM_CHANNEL_ID : TELEGRAM_CHAT_ID;
    if(!TELEGRAM_BOT_TOKEN || !chatId) return;
    try { await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: chatId, text: message, parse_mode: "HTML" }); } catch(e) { console.error("TG Error:", e.message); }
}

async function getBloggerToken(userRefreshToken) {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', { 
        client_id: BLOGGER_CLIENT_ID, 
        client_secret: BLOGGER_CLIENT_SECRET, 
        refresh_token: userRefreshToken || BLOGGER_REFRESH_TOKEN_REAL, 
        grant_type: 'refresh_token' 
    });
    return tokenRes.data.access_token;
}

async function submitToGoogleIndex(url) {
    if(!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) return;
    try {
        const auth = new google.auth.JWT({ email: GOOGLE_CLIENT_EMAIL, privateKey: GOOGLE_PRIVATE_KEY, scope: ['https://www.googleapis.com/auth/indexing'] });
        const indexing = google.indexing({ version: 'v3', auth });
        await indexing.urlNotifications.publish({ requestBody: { type: 'URL_UPDATED', url: url } });
    } catch(e) { console.error("Google Index Error:", e.message); }
}

async function pingIndexNow(productUrl) {
    try { 
        await axios.post('https://api.indexnow.org/IndexNow', { 
            host: "affiliatepilot-0qkzi.vercel.app", 
            key: "pilotbotindexkey123", 
            urlList: [productUrl] 
        }); 
    } catch(e) { console.error("IndexNow Error:", e.message); }
}

// ==========================================
// 🎨 AI DESIGNER AGENT
// ==========================================
async function runDesignerAgent() {
    await sendTelegram("🎨 <b>AI Designer Agent Activated!</b>\n✨ Generating viral Print-on-Demand design...");
    
    try {
        const concept = await askAI(`Give me 1 viral Print-on-Demand t-shirt design concept for today. It should be funny, trending, or aesthetic. Output STRICTLY in JSON: { "title": "Product Title (e.g., Funny Cat T-Shirt)", "image_prompt": "A detailed image prompt for AI to generate the design (flat vector, white background, bold text if any)", "category": "Men or Women or Kids" }`);
        if(!concept) return await sendTelegram("🛑 AI Concept generation failed.");

        const parsed = JSON.parse(concept);
        const productTitle = parsed.title;
        const imagePrompt = parsed.image_prompt;
        const category = parsed.category || 'Men';

        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}?width=1024&height=1024&nologo=true`;
        await sendTelegram(`🖼️ Design Generated! <a href="${imageUrl}">Preview</a>. Uploading to Printify...`);

        let printifyProductId = null;
        if(PRINTIFY_API_KEY) {
            try {
                const shopRes = await axios.get('https://api.printify.com/v1/shops.json', { headers: { 'Authorization': `Bearer ${PRINTIFY_API_KEY}` } });
                const shopId = shopRes.data?.data?.[0]?.id || shopRes.data?.[0]?.id;
                
                if(shopId) {
                    const uploadRes = await axios.post('https://api.printify.com/v1/uploads/images.json', { file_name: `${productTitle.replace(/[^a-z0-9]/gi, '_')}.png`, url: imageUrl }, { headers: { 'Authorization': `Bearer ${PRINTIFY_API_KEY` } });
                    const printifyImageId = uploadRes.data?.id;
                    
                    if(printifyImageId) {
                        await axios.post(`https://api.printify.com/v1/shops/${shopId}/products.json`, {
                            title: productTitle, 
                            description: `Premium ${productTitle}. Made with love, shipped worldwide!`, 
                            blueprint_id: 6, 
                            print_provider_id: 1, 
                            variants: [ 
                                { id: 17824, price: 2999, is_enabled: true }, 
                                { id: 17825, price: 2999, is_enabled: true }, 
                                { id: 17826, price: 99, is_enabled: true } 
                            ], 
                            print_areas: [ 
                                { 
                                    variant_ids: [17824, 17825, 17826], 
                                    placeholders: [ 
                                        { 
                                            position: "front", 
                                            images: [{ id: printifyImageId, x: 0.5, y: 0.5, scale: 1 } 
                                        } 
                                    ] 
                                } 
                            ] 
                        }, { headers: { 'Authorization': `Bearer ${PRINTIFY_API_KEY}` } });
                        await sendTelegram("✅ <b>Product Created on Printify!</b> Go to dashboard to publish it.");
                    }
                }
            } catch(e) {
                const errMsg = e.response?.data?.message || e.message;
                await sendTelegram(`⚠️ <b>Printify Failed:</b> ${errMsg}. Download the image and upload it yourself.`);
            }
        }
        const productPrice = "29.99";
        const marketPrice = "54.99";

        const { data: newProduct, error } = await supabase.from('store_products').insert({
            name: productTitle, image: imageUrl, price_usd: productPrice, compare_at_price: marketPrice, 
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

        await sendTelegram(`🆕 <b>New AI Design Live on Website!</b>\n📦 ${productTitle}\n💰 $${productPrice} (Was $${marketPrice})\n🔗 <a href="${productLink}">Shop Now!</a>`, true);

        // SEO Blog
        if(BLOG_ID) {
            const blogHTML = await askAI(`Write viral SEO blog "Why ${productTitle} is Trending in 2024". Feature product with image ${imageUrl}. Add yellow buy button: <a href="${productLink}" style="background:#f59e0b;color:#000;padding:15px 30px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:18px;display:inline-block;">Buy Exclusive Design →</a>. HTML only, 400 words.`);
            if(blogHTML) {
                const bToken = await getBloggerToken(null);
                await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/`, {
                    kind: 'blogger#post', title: `${productTitle} - The Viral Design of 2024`, content: blogHTML, labels: [category, "AI Design", "Trending"]
                }, { headers: { Authorization: `Bearer ${bToken}` } });
            }
        }
        if(twitterClient) {
            try { await twitterClient.v2.tweet(`🎨 Exclusive Drop: ${productTitle}!\n🚚 FREE Shipping\n💰 $${productPrice}\n🔗 Get it 👇\n${productLink}\n\n#AI #Design #Trending`);
            } catch(e) {}
        }
    } catch(e) { sendTelegram(`🚨 Designer Agent Crashed! Error: ${e.message}`); }
}

// ==========================================
// 🌐 GLOBAL API ROUTES
// ==========================================
app.get('/', (req, res) => res.send('🎨 AI Designer Agent is AWAKE!'));

app.post('/api/admin-login', (req, res) => { 
    if(req.body.password === ADMIN_PASSWORD) res.json({ success: true }); 
    else res.json({ success: false }); 
});

app.post('/api/auth', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.json({ success: false });
    let { data: user } = await supabase.from('users').select('*').eq('email', email).single();
    if (!user) { const { data: newUser } = await supabase.from('users').insert({ email }).select().single(); return res.json({ success: true, user: newUser }); }
    res.json({ success: true, user });
});

// ---------------------------------------------------------
// 🛠️ FREE TOOLS
// ---------------------------------------------------------
app.post('/api/tool/website-builder', async (req, res) => {
    const { prompt } = req.body;
    const code = await askAI(`Generate a COMPLETE, single-page HTML website about: "${prompt}". Return ONLY valid HTML. Use inline CSS. Make it modern, responsive. Use https://placehold.co/600x400/EEE/31343C?text=Image for images. No markdown.`);
    if (code) res.json({ success: true, code: code });
    else res.json({ success: false });
});

app.post('/api/tool/blog-writer-free', async (req, res) => {
    const { topic } = req.body;
    const article = await askAI(`Write a highly SEO optimized, 1500-word article about "${topic}". Use H1, H2, H3 tags. Output ONLY clean HTML. Do not include html/body tags.`);
    if (article) res.json({ success: true, article: article });
    else res.json({ success: false });
});

app.post('/api/tool/image-generator', async (req, res) => {
    const { prompt } = req.body;
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;
    res.json({ success: true, imageUrl });
});

app.post('/api/tool/hashtag-generator', async (req, res) => {
    const { topic } = req.body;
    const result = await askAI(`Give 1 highly engaging Instagram caption and 20 viral hashtags for a post about "${topic}". Output STRICT JSON: {"caption": "...", "hashtags": ["tag1", "tag2"]}`);
    try { res.json({ success: true, data: JSON.parse(result.replace(/```json/g, '').replace(/```/g, '').trim()) }); }
    catch(e) { res.json({ success: false }); }
});

app.post('/api/tool/youtube-seo', async (req, res) => {
    const { topic } = req.body;
    const result = await askAI(`Give 5 viral YouTube video titles and 10 SEO tags for a video about "${topic}". Output STRICT JSON: {"titles": ["t1"], "tags": ["tag1"]}`);
    try { res.json({ success: true, data: JSON.parse(result.replace(/```json/g, '').replace(/```/g, '').trim()) }); }
    catch(e) { res.json({ success: false }); }
});

app.post('/api/tool/viral-blueprint', async (req, res) => {
    const { niche } = req.body;
    const prompt = `You are a viral content strategist. Give me a complete blueprint for a Faceless YouTube/Instagram channel in the niche: "${niche}". Output STRICTLY in JSON: {"scripts": [{"hook": "Opening line", "body": "Main points", "cta": "Ending line"}], "thumbnails": ["Idea 1", "Idea 2"], "blogs": ["SEO title 1", "SEO title 2"], "threads": ["Thread outline"]}`;
    const result = await askAI(prompt);
    try { res.json({ success: true, data: JSON.parse(result.replace(/```json/g, '').replace(/```/g, '').trim()) }); }
    catch(e) { res.json({ success: false }); }
});

// ---------------------------------------------------------
// 🦠️ VIRAL BLUEPRINT ENGINE
// ---------------------------------------------------------
app.post('/api/trigger-auto-blog', async (req, res) => {
    const { niche, blogId, userBloggerToken } = req.body;
    if (!niche || !blogId) return res.json({ success: false, error: "Niche and Blog ID required" });
    try {
        const articleHTML = await askAI(`Write a highly engaging, 1500-word SEO article about "${niche}". Use H1, H2, H3 tags. Use short paragraphs. Add bullet points. Make it feel human-written. Output ONLY clean HTML.`);
        if (!articleHTML) return res.json({ success: false, error: "AI failed to write" });

        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(`Blog feature image about ${niche}`)}?width=1200&height=630&nologo=true&seed=${Math.floor(Math.random() * 1000)}`;
        const finalHTML = `<img src="${imageUrl}" style="width:100%;border-radius:8px;margin-bottom:20px;" /> ${articleHTML}`;

        const token = await getBloggerToken(userBloggerToken || BLOGGER_REFRESH_TOKEN_REAL);
        await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts/`, {
            kind: 'blogger#post',
            title: `${niche} - Ultimate Guide (${new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })})`,
            content: finalHTML,
            labels: [niche, "AI Generated", "Guide"]
        }, { headers: { Authorization: `Bearer ${token}` } });

        await axios.post('https://api.indexnow.org/IndexNow', { 
            host: new URL(`https://${blogId}.blogspot.com`).hostname, 
            key: "pilotbotindexkey123", 
            urlList: [`https://${blogId}.blogspot.com`] 
        });

        res.json({ success: true, message: `Article posted on ${new URL(`https://${blogId}.blogspot.com`).hostname}!` });
    } catch (error) { res.json({ success: false, error: error.message }); }
});

app.get('/api/get-old-posts', async (req, res) => {
    try {
        const token = await getBloggerToken(BLOGGER_REFRESH_TOKEN_REAL);
        const blogId = BLOG_ID;
        if(!blogId) return res.json({ success: false, error: "BLOG_ID missing in .env" });
        const { data } = await axios.get(`https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts?maxResults=10`, { headers: { Authorization: `Bearer ${token}` } });
        const posts = data.items.map(post => ({ id: post.id, title: post.title, url: post.url, published: post.published, image: post.images?.[0]?.url });
        res.json({ success: true, posts });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// ---------------------------------------------------------
// 🤖 AI CHATBOT WITH MEMORY
// ---------------------------------------------------------
app.post('/api/ai-chat', async (req, res) => {
    const { message, sessionId } = req.body;
    if (!message || !sessionId) return res.json({ success: false });
    
    let { data: memory } = await supabase.from('chat_memories').select('summary').eq('session_id', sessionId).single();
    let contextPrompt = "You are a highly professional AI Sales Agent for PilotStaff. Help the user, answer questions about our AI tools, and try to qualify them as a lead.";
    if (memory && memory.summary) contextPrompt += `\n\nYou have spoken to this user before. Here is what you remember:\n${memory.summary}`;

    const prompt = `${contextPrompt}\n\nUser: ${message}\n\nRespond in a helpful, concise way. Also, at the very end of your response, output a JSON block: {"reply": "Your actual response to user", "memory_update": "Brief summary of what happened"}`;
    const result = await askAI(prompt);
    
    try {
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.memory_update) {
                await supabase.from('chat_memories').upsert({ session_id: sessionId, summary: parsed.memory_update, updated_at: new Date().toISOString() }, { onConflict: 'session_id' });
            }
            res.json({ success: true, reply: parsed.reply });
        } else { res.json({ success: true, reply: result }); }
    } catch(e) { res.json({ success: true, reply: result }); }
});

// ---------------------------------------------------------
// 📊 CRM ROUTES
// ---------------------------------------------------------
app.get('/api/crm/leads', async (req, res) => {
    const { data: leads, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error });
    res.json({ success: true, leads });
});

app.post('/api/crm/leads', async (req, res) => {
    const { name, email, phone, status, value } = req.body;
    const { data, error } = await supabase.from('leads').insert({ name, email, { phone, status, value }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, lead: data });
});

app.patch('/api/crm/leads/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const { data, error } = await supabase.from('leads').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, lead: data });
});

// ---------------------------------------------------------
// 💳 PAYPAL WEBHOOK
// ---------------------------------------------------------
app.post('/api/paypal-webhook', async (req, res) => {
    console.log("✅ Webhook hit:", req.body);
    res.status(200).send('OK');
});

// ==========================================
// 🚀 START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 PilotStaff LIVE on ${PORT}`));
