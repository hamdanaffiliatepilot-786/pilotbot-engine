require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cron = require('node-cron');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '10mb' }));

const SB_URL = process.env.SB_URL;
const SB_KEY = process.env.SB_KEY;
const GROQ_KEY = process.env.GROQ_KEY;
const BLOGGER_CLIENT_ID = process.env.BLOGGER_CLIENT_ID;
const BLOGGER_CLIENT_SECRET = process.env.BLOGGER_CLIENT_SECRET;
const BLOGGER_REFRESH_TOKEN = process.env.BLOGGER_REFRESH_TOKEN;
const BLOG_ID = process.env.BLOG_ID;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const WEBSITE_URL = process.env.WEBSITE_URL || 'https://affiliatepilot-frontend.vercel.app';
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!SB_URL || !SB_KEY) console.warn('⚠️ Supabase not set');
if (!GROQ_KEY) console.warn('⚠️ GROQ_KEY not set');

const supabase = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY) : null;

function sanitize(input) {
    if (typeof input !== 'string') return input;
    return input.replace(/[<>'";&]/g, '').trim().substring(0, 2000);
}

async function sendTelegram(message, isChannel = false) {
    const chatId = isChannel ? TELEGRAM_CHANNEL_ID : TELEGRAM_CHAT_ID;
    if (!TELEGRAM_BOT_TOKEN || !chatId) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true
        });
    } catch (e) { console.error('TG:', e.message?.substring(0, 80)); }
}

async function askAI(prompt) {
    if (!GROQ_KEY) return null;
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 4000,
        }, {
            headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
            timeout: 45000
        });
        let content = response.data.choices[0].message.content;
        content = content.replace(/```json\n?/g, '').replace(/```html\n?/g, '').replace(/```javascript\n?/g, '').replace(/```\n?/g, '').trim();
        return content;
    } catch (e) {
        console.error('AI:', e.message?.substring(0, 80));
        return null;
    }
}

async function getBloggerToken(userToken) {
    const token = userToken || BLOGGER_REFRESH_TOKEN;
    if (!token || !BLOGGER_CLIENT_ID || !BLOGGER_CLIENT_SECRET) return null;
    try {
        const res = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: BLOGGER_CLIENT_ID, client_secret: BLOGGER_CLIENT_SECRET,
            refresh_token: token, grant_type: 'refresh_token'
        });
        return res.data.access_token;
    } catch (e) { console.error('Blogger:', e.message?.substring(0, 80)); return null; }
}

async function submitToGoogleIndex(url) {
    if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY || !url) return;
    try {
        const auth = new google.auth.JWT({ email: GOOGLE_CLIENT_EMAIL, privateKey: GOOGLE_PRIVATE_KEY, scopes: ['https://www.googleapis.com/auth/indexing'] });
        const indexing = google.indexing({ version: 'v3', auth });
        await indexing.urlNotifications.publish({ requestBody: { type: 'URL_UPDATED', url: url } });
    } catch (e) { console.error('Index:', e.message?.substring(0, 80)); }
}

async function pingIndexNow(url) {
    try { await axios.post('https://api.indexnow.org/IndexNow', { host: new URL(url).hostname, key: 'pilotbotindexkey123', urlList: [url] }); } catch (e) {}
}

function ok(res, data) { res.status(200).json(data); }
function err(res, msg, code = 500) { res.status(code).json({ success: false, error: msg }); }

// ===== HEALTH =====
app.get('/', (req, res) => res.send('🤖 PilotStaff API LIVE'));
app.get('/api/health', (req, res) => {
    ok(res, { success: true, uptime: process.uptime(), services: { supabase: !!supabase, groq: !!GROQ_KEY, blogger: !!BLOGGER_REFRESH_TOKEN, telegram: !!TELEGRAM_BOT_TOKEN } });
});

// ===== PUBLIC STATS =====
app.get('/api/public-stats', async (req, res) => {
    if (!supabase) return ok(res, { success: true, activeUsers: '0', totalTasks: '0' });
    try {
        const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const { count: leads } = await supabase.from('leads').select('*', { count: 'exact', head: true });
        const fmt = (n) => { if (!n) return '0'; if (n >= 1000) return (n / 1000).toFixed(1) + 'K+'; return n.toString(); };
        ok(res, { success: true, activeUsers: fmt(users), totalTasks: fmt((users || 0) * 7 + (leads || 0) * 3) });
    } catch (e) { ok(res, { success: true, activeUsers: '0', totalTasks: '0' }); }
});

// ===== BLOG POSTS =====
app.get('/api/get-old-posts', async (req, res) => {
    if (!BLOGGER_REFRESH_TOKEN || !BLOG_ID) return err(res, 'Blogger not configured', 200);
    try {
        const token = await getBloggerToken();
        if (!token) return err(res, 'Blogger auth failed', 200);
        const { data } = await axios.get(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts?maxResults=10`, { headers: { Authorization: `Bearer ${token}` } });
        const posts = (data.items || []).map(p => ({ id: p.id, title: p.title, url: p.url, published: p.published, image: p.images?.[0]?.url || null }));
        ok(res, { success: true, posts });
    } catch (e) { err(res, e.message, 200); }
});

// ===== AI CHAT =====
app.post('/api/ai-chat', async (req, res) => {
    const { message, sessionId } = req.body;
    if (!message || !sessionId) return err(res, 'Message and session ID required');
    const cleanMsg = sanitize(message);
    const cleanSession = sanitize(sessionId).substring(0, 100);
    let memText = '';
    if (supabase) {
        try { const { data: mem } = await supabase.from('chat_memories').select('summary').eq('session_id', cleanSession).single(); if (mem?.summary) memText = mem.summary; } catch (e) {}
    }
    const prompt = `You are a helpful AI assistant for PilotStaff, a platform with AI tools and AI employee agents. Be concise. ${memText ? `Previous context: ${memText}\n\n` : ''}User: ${cleanMsg}\n\nRespond in HTML format (use <b>, <br>, <ul>, <li>). Under 200 words. On a NEW LINE output: [MEMORY: brief 1-sentence summary]`;
    const result = await askAI(prompt);
    if (!result) return err(res, 'AI failed');
    const memMatch = result.match(/\[MEMORY:\s*(.+?)\]$/i);
    let reply = result, memUpdate = memMatch ? memMatch[1] : null;
    if (memMatch) reply = result.replace(/\[MEMORY:\s*.+?\]$/i, '').trim();
    if (supabase && memUpdate) { try { await supabase.from('chat_memories').upsert({ session_id: cleanSession, summary: sanitize(memUpdate), updated_at: new Date().toISOString() }, { onConflict: 'session_id' }); } catch (e) {} }
    ok(res, { success: true, reply });
});

// ===== CRM =====
app.get('/api/crm/leads', async (req, res) => {
    if (!supabase) return ok(res, { success: true, leads: [] });
    try { const { data: leads } = await supabase.from('leads').select('*').order('created_at', { ascending: false }); ok(res, { success: true, leads: leads || [] }); } catch (e) { ok(res, { success: true, leads: [] }); }
});

app.post('/api/crm/leads', async (req, res) => {
    if (!supabase) return err(res, 'Database not configured');
    const { name, email, phone, status, value } = req.body;
    const { data, error } = await supabase.from('leads').insert({ name: sanitize(name), email: sanitize(email), phone: sanitize(phone), status: sanitize(status) || 'new', value: sanitize(value) }).select().single();
    if (error) return err(res, error.message);
    ok(res, { success: true, lead: data });
});

// ===== AUTH =====
app.post('/api/auth', async (req, res) => {
    if (!supabase) return err(res, 'Database not configured');
    const { email } = req.body;
    if (!email) return err(res, 'Email required');
    const { data: user } = await supabase.from('users').select('*').eq('email', sanitize(email)).single();
    if (user) return ok(res, { success: true, user });
    const { data: newUser, error } = await supabase.from('users').insert({ email: sanitize(email) }).select().single();
    if (error) return err(res, error.message);
    ok(res, { success: true, user: newUser });
});

// ===== ADMIN =====
app.post('/api/admin-login', (req, res) => {
    if (!ADMIN_PASSWORD) return err(res, 'Admin not configured');
    ok(res, { success: req.body.password === ADMIN_PASSWORD });
});

app.get('/api/admin/stats', async (req, res) => {
    if (!supabase) return err(res, 'No database');
    try {
        const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const { count: leads } = await supabase.from('leads').select('*', { count: 'exact', head: true });
        ok(res, { success: true, totalUsers: users || 0, totalLeads: leads || 0, totalRevenue: '0', totalProfit: '0', totalCJCost: '0', totalOrders: 0, trafficSources: { Direct: '40%', Google: '35%', Social: '15%', Other: '10%' }, statusCounts: { Active: users || 0, New: leads || 0 } });
    } catch (e) { err(res, e.message); }
});

// ============================================
// 20 FREE AI TOOLS
// ============================================

app.post('/api/tool/website-builder', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Prompt required');
    const code = await askAI(`Generate a COMPLETE single-page HTML website about: "${input}". Use inline CSS. Modern, responsive, mobile-friendly. Use https://placehold.co/600x400/EEE/31343C?text=Image for images. Include nav, hero, features, about, footer. Output ONLY valid HTML. No markdown.`);
    if (code) ok(res, { success: true, code }); else err(res, 'AI failed');
});

app.post('/api/tool/blog-writer-free', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Topic required');
    const article = await askAI(`Write a 1500-word SEO article about: "${input}". Use H1, H2, H3. Short paragraphs. Bullet points. Conclusion. Output ONLY clean HTML. No html/body/head tags. No markdown.`);
    if (article) ok(res, { success: true, article }); else err(res, 'AI failed');
});

app.post('/api/tool/image-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Prompt required');
    const seed = Math.floor(Math.random() * 999999);
    ok(res, { success: true, imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(input)}?width=1024&height=1024&nologo=true&seed=${seed}` });
});

app.post('/api/tool/logo-maker', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Description required');
    const seed = Math.floor(Math.random() * 999999);
    ok(res, { success: true, imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent('Professional minimalist logo ' + input + ', clean vector, white background, no text, modern flat design')}?width=1024&height=1024&nologo=true&seed=${seed}` });
});

app.post('/api/tool/business-name-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Topic required');
    const result = await askAI(`Generate 20 creative business names for: "${input}". Output STRICT JSON: {"names": ["Name1 - description", "Name2 - description"]} No markdown.`);
    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed to generate'); }
});

app.post('/api/tool/meta-tag-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Topic required');
    const result = await askAI(`Generate SEO meta tags for: "${input}". Output STRICT JSON: {"title": "under 60 chars", "description": "under 160 chars", "keywords": ["kw1","kw2","kw3","kw4","kw5"], "og_title": "OG title", "og_description": "OG desc"} No markdown.`);
    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

app.post('/api/tool/privacy-policy-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Description required');
    const html = await askAI(`Write a complete Privacy Policy for: ${input}. Sections: Information We Collect, How We Use Data, Cookies, Third Parties, Data Security, Your Rights, Changes, Contact. H2 headings. Output HTML only. No html/body tags. No markdown.`);
    if (html) ok(res, { success: true, article: html }); else err(res, 'Failed');
});

app.post('/api/tool/terms-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Description required');
    const html = await askAI(`Write complete Terms & Conditions for: ${input}. Sections: Acceptance, Services, User Responsibilities, Payments, IP, Liability, Governing Law, Contact. H2 headings. Output HTML only. No html/body tags. No markdown.`);
    if (html) ok(res, { success: true, article: html }); else err(res, 'Failed');
});

app.post('/api/tool/resume-builder', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Details required');
    const html = await askAI(`Create a professional ATS-friendly resume for: "${input}". Include Header, Summary, Experience, Skills, Education. Inline CSS, light bg, dark text. Output HTML only. No html/body tags. No markdown.`);
    if (html) ok(res, { success: true, article: html }); else err(res, 'Failed');
});

app.post('/api/tool/paragraph-rewriter', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Text required');
    const result = await askAI(`Rewrite this paragraph with different words but same meaning. Professional and natural. Output ONLY the rewritten paragraph:\n\n"${input}"`);
    if (result) ok(res, { success: true, text: result }); else err(res, 'Failed');
});

app.post('/api/tool/ad-copy-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Product required');
    const result = await askAI(`Generate 5 ad copies for: "${input}". Facebook, Instagram, Google styles. Output STRICT JSON: {"copy": ["Ad 1 with headline and body", "Ad 2", "Ad 3", "Ad 4", "Ad 5"]} No markdown.`);
    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

app.post('/api/tool/email-writer', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Context required');
    const result = await askAI(`Write 3 professional emails for: "${input}". Each with subject and body. Output STRICT JSON: {"emails": ["Subject: ...\n\nBody", "Subject: ...\n\nBody", "Subject: ...\n\nBody"]} No markdown.`);
    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

app.post('/api/tool/hashtag-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Topic required');
    const result = await askAI(`Give 1 engaging Instagram caption and 20 viral hashtags for: "${input}". Output STRICT JSON: {"caption": "caption here", "hashtags": ["tag1","tag2"]} No markdown.`);
    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

app.post('/api/tool/youtube-seo', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Topic required');
    const result = await askAI(`Give 5 viral YouTube titles and 10 SEO tags for: "${input}". Output STRICT JSON: {"titles": ["T1","T2"],"tags": ["tag1","tag2"]} No markdown.`);
    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

app.post('/api/tool/invoice-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Details required');
    const html = await askAI(`Create a professional invoice for: "${input}". Include INVOICE header, INV-001, date, Bill To, table with Description/Hours/Rate/Amount, Subtotal, Tax 10%, Total, Due 30 days, Thank you. Inline CSS. Output HTML only. No html/body tags. No markdown.`);
    if (html) ok(res, { success: true, article: html }); else err(res, 'Failed');
});

app.post('/api/tool/social-bio-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Description required');
    const result = await askAI(`Generate 4 social media bios for: "${input}". Output STRICT JSON: {"platforms": [{"platform": "Instagram", "bio": "bio with emojis"}, {"platform": "Twitter", "bio": "..."}, {"platform": "LinkedIn", "bio": "..."}, {"platform": "TikTok", "bio": "..."}]} No markdown.`);
    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

app.post('/api/tool/product-description', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Product details required');
    const result = await askAI(`Write 3 e-commerce product descriptions for: "${input}". Each with headline, features, CTA. Output STRICT JSON: {"descriptions": [{"headline": "...", "body": "...", "features": ["...","..."], "cta": "..."}]} No markdown.`);
    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

app.post('/api/tool/startup-ideas', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Industry required');
    const result = await askAI(`Generate 5 startup ideas for: "${input}". Each with name, problem, market, revenue model, cost. Output STRICT JSON: {"ideas": [{"name": "...", "problem": "...", "market": "...", "revenue": "...", "cost": "..."}]} No markdown.`);
    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

app.post('/api/tool/content-repurposer', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Content required');
    const result = await askAI(`Repurpose into 5 formats: "${input}". Output STRICT JSON: {"formats": [{"type": "Twitter Thread", "content": "..."}, {"type": "LinkedIn Post", "content": "..."}, {"type": "Email", "content": "..."}, {"type": "Instagram Caption", "content": "..."}, {"type": "YouTube Hook", "content": "..."}]} No markdown.`);
    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

app.post('/api/tool/website-auditor', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Description required');
    const result = await askAI(`As an SEO expert, audit this: "${input}". Give title analysis, meta description, heading structure, content tips, technical SEO, internal linking, keywords, priority fixes. Clear text with sections and bullets. No markdown.`);
    if (result) ok(res, { success: true, text: result }); else err(res, 'Failed');
});

app.post('/api/tool/social-manager', async (req, res) => {
    const { niche, count = 5 } = req.body;
    const input = sanitize(niche);
    if (!input) return err(res, 'Niche required');
    const result = await askAI(`Generate ${count} viral tweets about: "${input}". Output STRICT JSON array: ["tweet1","tweet2"] No markdown.`);
    try { let tweets = JSON.parse(result); if (!Array.isArray(tweets)) tweets = [tweets]; ok(res, { success: true, tweets }); }
    catch (e) { ok(res, { success: true, tweets: [`Just discovered ${input}! 🤯 #Trending`, `${input} is changing the game! 🚀`, `Stop sleeping on ${input}! 🔥 #Viral`, `POV: You understand ${input} 💡`, `${input} tip nobody shares 🤫 #Secret`] }); }
});

app.post('/api/tool/viral-blueprint', async (req, res) => {
    const input = sanitize(req.body.niche);
    if (!input) return err(res, 'Niche required');
    const result = await askAI(`Create a viral content blueprint for faceless channel: "${input}". Output STRICT JSON: {"scripts": [{"hook": "...", "body": "...", "cta": "..."}], "thumbnails": ["idea1","idea2"], "blogs": ["title1","title2"], "threads": ["outline"]} No markdown.`);
    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

// ===== AUTO-BLOG =====
app.post('/api/trigger-auto-blog', async (req, res) => {
    const { niche, blogId, userBloggerToken } = req.body;
    if (!niche || !blogId) return err(res, 'Niche and Blog ID required');
    const cn = sanitize(niche), cb = sanitize(blogId);
    try {
        const articleHTML = await askAI(`Write 1500-word SEO article about: "${cn}". H1,H2,H3. Short paragraphs. Bullets. Output HTML only. No html/body. No markdown.`);
        if (!articleHTML) return err(res, 'AI failed');
        const token = await getBloggerToken(userBloggerToken);
        if (!token) return err(res, 'Blogger auth failed');
        const img = `https://image.pollinations.ai/prompt/${encodeURIComponent(cn + ' blog')}?width=1200&height=630&nologo=true&seed=${Math.floor(Math.random()*1000)}`;
        const finalHTML = `<img src="${img}" style="width:100%;border-radius:8px;margin-bottom:20px;" alt="${cn}" /> ${articleHTML}`;
        await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${cb}/posts/`, { kind: 'blogger#post', title: `${cn} - Guide (${new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })})`, content: finalHTML, labels: [cn, 'AI Generated'] }, { headers: { Authorization: `Bearer ${token}` } });
        pingIndexNow(`https://${cb}.blogspot.com`);
        ok(res, { success: true, message: 'Article posted!' });
        await sendTelegram(`📝 <b>Blog Published!</b>\n📐 ${cn}\n🔗 https://${cb}.blogspot.com`, true);
    } catch (e) { err(res, e.message); }
});

// ===== SEO BLOG AGENT =====
app.post('/api/seo-blog-agent', async (req, res) => {
    const { topic, blogId, userBloggerToken } = req.body;
    if (!topic || !blogId) return err(res, 'Topic and Blog ID required');
    const ct = sanitize(topic), cb = sanitize(blogId);
    const img1 = `https://image.pollinations.ai/prompt/${encodeURIComponent(ct + ' professional banner')}?width=1200&height=630&nologo=true&seed=${Math.floor(Math.random()*9999)}`;
    const img2 = `https://image.pollinations.ai/prompt/${encodeURIComponent(ct + ' infographic')}?width=800&height=500&nologo=true&seed=${Math.floor(Math.random()*9999)}`;
    const img3 = `https://image.pollinations.ai/prompt/${encodeURIComponent(ct + ' concept art')}?width=800&height=500&nologo=true&seed=${Math.floor(Math.random()*9999)}`;
    const blogHTML = await askAI(`You are an expert SEO writer. Write a 1500+ word SEO blog about: "${ct}"

TITLE: SEO-optimized, under 60 chars, keyword near start.
INTRO: First 150 chars compelling (meta description). Keyword in first sentence.
STRUCTURE: H2 and H3 subheadings. 5-6 H2 sections minimum. Each H2 has keyword variation.
IMAGES: Place these 3 images naturally:
- After intro: <img src="${img1}" alt="${ct} - complete guide" style="width:100%;border-radius:12px;margin:20px 0;" />
- Middle: <img src="${img2}" alt="${ct} tips" style="width:100%;border-radius:12px;margin:20px 0;" />
- Before conclusion: <img src="${img3}" alt="${ct} best practices" style="width:100%;border-radius:12px;margin:20px 0;" />
INTERNAL LINKS: Include these naturally in sentences:
<a href="https://affiliatepilot-frontend.vercel.app/tools/ai-website-builder" style="color:#2563eb;font-weight:600;">free AI website builder</a>
<a href="https://affiliatepilot-frontend.vercel.app/agents" style="color:#2563eb;font-weight:600;">hire AI employees</a>
<a href="https://affiliatepilot-frontend.vercel.app/tools" style="color:#2563eb;font-weight:600;">free AI tools</a>
CTA at end:
<div style="background:linear-gradient(135deg,#2563eb,#7c3aed);padding:24px;border-radius:12px;text-align:center;margin:30px 0;">
<p style="color:white;font-size:20px;font-weight:bold;margin-bottom:8px;">Want to Automate Your Business?</p>
<p style="color:rgba(255,255,255,0.8);margin-bottom:16px;">Try 20+ Free AI Tools or Hire AI Employees from $29/month</p>
<a href="https://affiliatepilot-frontend.vercel.app" style="background:white;color:#2563eb;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;display:inline-block;">Get Started Free</a>
</div>
CONCLUSION: Summarize, include keyword once more.
OUTPUT: HTML only. H1 title, H2/H3 sections. No html/body/head. No markdown.`);
    if (!blogHTML) return err(res, 'AI failed');
    try {
        const token = await getBloggerToken(userBloggerToken);
        if (!token) return err(res, 'Blogger auth failed');
        const titleMatch = blogHTML.match(/<h1[^>]*>(.*?)<\/h1>/i);
        const postTitle = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').substring(0, 100) : `${ct} - Guide ${new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;
        await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${cb}/posts/`, { kind: 'blogger#post', title: postTitle, content: blogHTML, labels: [ct, 'AI Tools', 'Guide', '2025', 'PilotStaff'] }, { headers: { Authorization: `Bearer ${token}` } });
        pingIndexNow(`https://${cb}.blogspot.com`);
        await sendTelegram(`📝 <b>SEO Blog Published!</b>\n📐 ${postTitle.substring(0, 80)}\n🔗 https://${cb}.blogspot.com`, true);
        ok(res, { success: true, message: `Published: "${postTitle.substring(0, 60)}..."` });
    } catch (e) { err(res, e.message); }
});

// ===== PAYPAL WEBHOOK =====
app.post('/api/paypal-webhook', async (req, res) => {
    const { orderID, plan, price, payerEmail } = req.body;
    await sendTelegram(`💰 <b>NEW PAYMENT!</b>\n📋 Plan: ${plan || '?'}\n💵 Amount: ${price || '?'}\n🆔 Order: ${orderID || '?'}\n👤 Email: ${payerEmail || '?'}\n🕐 ${new Date().toLocaleString('en-IN')}`, true);
    if (supabase && orderID) { try { await supabase.from('payments').insert({ order_id: orderID, plan, amount: price, payer_email: payerEmail, status: 'completed', created_at: new Date().toISOString() }); } catch (e) {} }
    ok(res, { success: true });
});

// ===== CRON JOBS =====
cron.schedule('0 4 * * *', async () => {
    if (!TELEGRAM_CHANNEL_ID) return;
    const tip = await askAI('Give one short actionable business or marketing tip (1-2 sentences). Specific and practical. No fluff.');
    if (tip) await sendTelegram(`💡 <b>Daily Business Tip</b>\n\n${tip}\n\n🤖 by PilotStaff\n🔗 ${WEBSITE_URL}\n\n#BusinessTips #AI`, true);
});

cron.schedule('0 5 * * *', async () => {
    if (!BLOGGER_REFRESH_TOKEN || !BLOG_ID) return;
    const topics = ['20 Free AI Tools That Save 100+ Hours Weekly', 'How to Hire AI Employees in 2025', 'AI Website Builder vs Hiring a Developer', 'Free AI Blog Writer: 1500 Words in 10 Seconds', 'Best AI Logo Maker Without Design Skills', 'AI SEO Tools: Rank #1 Without an Agency', 'Small Business Automation: 6 AI Agents Replace Teams', 'Free AI Image Generator Without Photoshop', 'Start an AI Business with Zero Investment', 'AI Content Writing vs Human Writers in 2025'];
    const t = topics[Math.floor(Math.random() * topics.length)];
    try {
        await axios.post(`http://localhost:${process.env.PORT || 3000}/api/seo-blog-agent`, { topic: t, blogId: BLOG_ID });
        console.log('✅ Auto-blog:', t.substring(0, 40));
    } catch (e) { console.error('❌ Auto-blog:', e.message); }
});

cron.schedule('*/25 * * * *', () => { console.log(`💓 ${new Date().toLocaleTimeString()}`); });

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🤖 PilotStaff API on ${PORT}`));
