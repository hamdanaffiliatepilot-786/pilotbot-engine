require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cron = require('node-cron');
const cors = require('cors');

const app = express();
app.use(cors({ origin: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '10mb' }));

// ===== FIXED ENV VARIABLE CLEANING =====
function env(key) {
    let val = process.env[key];
    if (!val) return '';
    // Remove surrounding quotes (single or double) and spaces
    val = val.replace(/^['"`\s]+|['"`\s]+$/g, '').trim();
    return val;
}

const SB_URL = env('SB_URL');
const SB_KEY = env('SB_KEY');
const GROQ_KEY = env('GROQ_KEY');
const BLOGGER_CLIENT_ID = env('BLOGGER_CLIENT_ID');
const BLOGGER_CLIENT_SECRET = env('BLOGGER_CLIENT_SECRET');
const BLOGGER_REFRESH_TOKEN = env('BLOGGER_REFRESH_TOKEN');
const BLOG_ID = env('BLOG_ID');
const TELEGRAM_BOT_TOKEN = env('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = env('TELEGRAM_CHAT_ID');
const TELEGRAM_CHANNEL_ID = env('TELEGRAM_CHANNEL_ID');
const ADMIN_PASSWORD = env('ADMIN_PASSWORD');
const WEBSITE_URL = env('WEBSITE_URL') || 'https://affiliatepilot-frontend.vercel.app';

// ===== STARTUP LOG - Check what's loaded =====
console.log('=== ENV CHECK ===');
console.log('SB_URL:', SB_URL ? '✅ Set' : '❌ Missing');
console.log('GROQ_KEY:', GROQ_KEY ? '✅ Set (' + GROQ_KEY.substring(0, 8) + '...)' : '❌ Missing');
console.log('BLOGGER_CLIENT_ID:', BLOGGER_CLIENT_ID ? '✅ Set' : '❌ Missing');
console.log('BLOGGER_CLIENT_SECRET:', BLOGGER_CLIENT_SECRET ? '✅ Set' : '❌ Missing');
console.log('BLOGGER_REFRESH_TOKEN:', BLOGGER_REFRESH_TOKEN ? '✅ Set (' + BLOGGER_REFRESH_TOKEN.substring(0, 10) + '...)' : '❌ Missing');
console.log('BLOG_ID:', BLOG_ID ? '✅ Set (' + BLOG_ID + ')' : '❌ Missing');
console.log('TELEGRAM_BOT_TOKEN:', TELEGRAM_BOT_TOKEN ? '✅ Set' : '❌ Missing');
console.log('WEBSITE_URL:', WEBSITE_URL);
console.log('================');

const supabase = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY) : null;

function sanitize(input) {
    if (typeof input !== 'string') return input;
    return input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '').replace(/on\w+="[^"]*"/gi, '').replace(/javascript:/gi, '').trim().substring(0, 5000);
}

function sanitizeStrict(input) {
    if (typeof input !== 'string') return input;
    return input.replace(/[<>'";&]/g, '').trim().substring(0, 2000);
}

async function sendTelegram(message, isChannel = false) {
    const chatId = isChannel ? TELEGRAM_CHANNEL_ID : TELEGRAM_CHAT_ID;
    if (!TELEGRAM_BOT_TOKEN || !chatId) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true }, { timeout: 10000 });
    } catch (e) { console.error('TG Error:', e.message?.substring(0, 80)); }
}

async function askAI(prompt, retries = 2) {
    if (!GROQ_KEY) return null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const r = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 4000,
            }, { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' }, timeout: 60000 });
            let c = r.data.choices[0].message.content;
            c = c.replace(/```json\n?/g, '').replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
            return c;
        } catch (e) {
            console.error(`AI Error (attempt ${attempt + 1}):`, e.message?.substring(0, 100));
            if (attempt === retries) return null;
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    return null;
}

async function getBloggerToken(userToken) {
    const token = userToken || BLOGGER_REFRESH_TOKEN;
    if (!token || !BLOGGER_CLIENT_ID || !BLOGGER_CLIENT_SECRET) {
        console.error('Blogger auth missing:', { hasToken: !!token, hasClientId: !!BLOGGER_CLIENT_ID, hasClientSecret: !!BLOGGER_CLIENT_SECRET });
        return null;
    }
    try {
        const r = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: BLOGGER_CLIENT_ID, client_secret: BLOGGER_CLIENT_SECRET, refresh_token: token, grant_type: 'refresh_token'
        }, { timeout: 15000 });
        return r.data.access_token;
    } catch (e) {
        console.error('Blogger Token Error:', e.response?.data?.error || e.message);
        return null;
    }
}

async function pingIndexNow(url) {
    try { await axios.post('https://api.indexnow.org/IndexNow', { host: new URL(url).hostname, key: 'pilotbotindexkey123', urlList: [url] }, { timeout: 5000 }); } catch (e) {}
}

function ok(res, data) { res.status(200).json(data); }
function err(res, msg, code) { res.status(code || 500).json({ success: false, error: msg }); }

// ===== BASIC ROUTES =====
app.get('/', (req, res) => res.send('🤖 PilotStaff API LIVE'));

app.get('/api/health', (req, res) => ok(res, {
    success: true, uptime: process.uptime(), memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    env: {
        supabase: !!supabase, groq: !!GROQ_KEY,
        bloggerToken: !!BLOGGER_REFRESH_TOKEN, blogId: !!BLOG_ID,
        bloggerClientId: !!BLOGGER_CLIENT_ID, bloggerClientSecret: !!BLOGGER_CLIENT_SECRET,
        telegram: !!TELEGRAM_BOT_TOKEN
    }
}));

// Debug endpoint to check env without exposing secrets
app.get('/api/debug-env', (req, res) => {
    const isAdmin = req.headers['x-admin'] === ADMIN_PASSWORD;
    ok(res, {
        bloggerReady: !!(BLOGGER_REFRESH_TOKEN && BLOGGER_CLIENT_ID && BLOGGER_CLIENT_SECRET && BLOG_ID),
        hasToken: !!BLOGGER_REFRESH_TOKEN,
        hasClientId: !!BLOGGER_CLIENT_ID,
        hasSecret: !!BLOGGER_CLIENT_SECRET,
        hasBlogId: !!BLOG_ID,
        blogIdValue: BLOGGER_REFRESH_TOKEN && BLOG_ID ? BLOG_ID : 'NOT SET',
        tokenPreview: BLOGGER_REFRESH_TOKEN ? BLOGGER_REFRESH_TOKEN.substring(0, 15) + '...' : 'NOT SET',
        clientIdPreview: BLOGGER_CLIENT_ID ? BLOGGER_CLIENT_ID.substring(0, 10) + '...' : 'NOT SET',
        allEnvKeys: Object.keys(process.env).filter(k => !k.includes('SECRET') && !k.includes('KEY') && !k.includes('TOKEN') && !k.includes('PASSWORD')),
    });
});

app.get('/api/public-stats', async (req, res) => {
    if (!supabase) return ok(res, { success: true, activeUsers: '2.1K+', totalTasks: '15K+' });
    try {
        const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const fmt = n => !n ? '0' : n >= 1000 ? (n / 1000).toFixed(1) + 'K+' : n.toString();
        ok(res, { success: true, activeUsers: fmt(users), totalTasks: fmt((users || 0) * 7) });
    } catch (e) { ok(res, { success: true, activeUsers: '2.1K+', totalTasks: '15K+' }); }
});

app.get('/api/get-old-posts', async (req, res) => {
    if (!BLOGGER_REFRESH_TOKEN || !BLOG_ID) {
        return err(res, 'Blogger not configured. Set BLOGGER_REFRESH_TOKEN, BLOGGER_CLIENT_ID, BLOGGER_CLIENT_SECRET, and BLOG_ID in Render environment variables.', 400);
    }
    try {
        const token = await getBloggerToken();
        if (!token) return err(res, 'Blogger authentication failed. Your REFRESH_TOKEN may be expired. Generate a new one.', 401);
        const { data } = await axios.get(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts?maxResults=10`, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
        const posts = (data.items || []).map(p => ({ id: p.id, title: p.title, url: p.url, published: p.published, image: p.images?.[0]?.url }));
        ok(res, { success: true, posts, total: data.totalItems || 0 });
    } catch (e) { err(res, 'Failed to fetch posts: ' + (e.response?.data?.error?.message || e.message), 500); }
});

app.post('/api/ai-chat', async (req, res) => {
    const { message, sessionId } = req.body;
    if (!message || !sessionId) return err(res, 'Missing data', 400);
    const cm = sanitizeStrict(message), cs = sanitizeStrict(sessionId).substring(0, 100);
    let memText = '';
    if (supabase) { try { const { data: mem } = await supabase.from('chat_memories').select('summary').eq('session_id', cs).single(); if (mem?.summary) memText = mem.summary; } catch(e){} }
    const result = await askAI(`You are PilotStaff AI assistant. Helpful, concise, professional. You help with AI tools, business growth, SEO, and content creation. ${memText ? `Previous context: ${memText}\n` : ''}User: ${cm}\n\nRespond in HTML (<b>,<br>,<ul>,<li>). Under 200 words.`);
    if (!result) return err(res, 'AI failed', 503);
    ok(res, { success: true, reply: result });
});

app.post('/api/auth', async (req, res) => {
    if (!supabase) return err(res, 'DB not configured', 500);
    const { email } = req.body; if (!email) return err(res, 'Email required', 400);
    const { data: user } = await supabase.from('users').select('*').eq('email', sanitizeStrict(email)).single();
    if (user) return ok(res, { success: true, user });
    const { data: newUser, error } = await supabase.from('users').insert({ email: sanitizeStrict(email) }).select().single();
    if (error) return err(res, error.message, 400);
    ok(res, { success: true, user: newUser });
});

app.post('/api/admin-login', (req, res) => {
    if (!ADMIN_PASSWORD) return err(res, 'Not configured', 500);
    ok(res, { success: req.body.password === ADMIN_PASSWORD });
});

app.get('/api/admin/stats', async (req, res) => {
    if (!supabase) return err(res, 'No database', 500);
    const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { count: leads } = await supabase.from('leads').select('*', { count: 'exact', head: true });
    ok(res, { success: true, totalUsers: users || 0, totalLeads: leads || 0 });
});

app.post('/api/paypal-webhook', async (req, res) => {
    const { orderID, plan, price, payerEmail } = req.body;
    console.log(`💰 Payment: ${orderID} | ${plan} | ${price} | ${payerEmail}`);
    if (supabase && payerEmail) {
        try { await supabase.from('users').upsert({ email: payerEmail, plan, upgraded_at: new Date().toISOString() }, { onConflict: 'email' }); } catch(e){}
    }
    await sendTelegram(`💰 <b>New Sale!</b>\nPlan: ${plan}\nPrice: ${price}\nEmail: ${payerEmail}`, true);
    ok(res, { success: true });
});

// ===== 25 AI TOOLS (Same as before - keeping short for space) =====
const toolRoutes = [
    { path: 'website-builder', prompt: (t) => `Create complete single-page website for "${t}". Inline CSS. Modern design with navbar, hero, features, pricing, testimonials, footer. OUTPUT ONLY HTML.` },
    { path: 'blog-writer-free', prompt: (t) => `Write 1500+ word SEO blog about "${t}". H1, H2 sections, bullet points. Include links: <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;">free AI tools</a> and <a href="${WEBSITE_URL}/tools/ai-blog-writer" style="color:#2563eb;font-weight:600;">AI blog writer</a>. OUTPUT ONLY HTML.` },
    { path: 'image-generator', type: 'image' },
    { path: 'logo-maker', type: 'logo' },
    { path: 'business-name-generator', prompt: (t) => `Generate 20 business names for "${t}". OUTPUT JSON: {"names":["Name — Tagline | domain.com", ...]} No markdown.` },
    { path: 'meta-tag-generator', prompt: (t) => `Generate SEO meta tags for "${t}". OUTPUT JSON: {"title":"...","description":"...","keywords":["..."],"og_title":"...","og_description":"..."} No markdown.` },
    { path: 'privacy-policy-generator', prompt: (t) => `Write Privacy Policy for ${t}. 10 sections with H2. OUTPUT ONLY HTML.` },
    { path: 'terms-generator', prompt: (t) => `Write Terms of Service for ${t}. 10 sections with H2. OUTPUT ONLY HTML.` },
    { path: 'resume-builder', prompt: (t) => `Create ATS resume for ${t}. Header, summary, experience, skills, education. Inline CSS. OUTPUT ONLY HTML.` },
    { path: 'paragraph-rewriter', prompt: (t) => `Rewrite professionally: "${t}". Keep exact meaning. OUTPUT ONLY TEXT.` },
    { path: 'ad-copy-generator', prompt: (t) => `Generate 5 ad copies for "${t}". OUTPUT JSON: {"copy":["Ad1","Ad2",...]} No markdown.` },
    { path: 'email-writer', prompt: (t) => `Write 3 emails for "${t}". OUTPUT JSON: {"emails":["Subject: ...\n\nBody",...]} No markdown.` },
    { path: 'hashtag-generator', prompt: (t) => `Generate caption and 20 hashtags for "${t}". OUTPUT JSON: {"caption":"...","hashtags":["#tag",...]} No markdown.` },
    { path: 'youtube-seo', prompt: (t) => `Generate 5 YouTube titles and 10 tags for "${t}". OUTPUT JSON: {"titles":["..."],"tags":["..."]} No markdown.` },
    { path: 'invoice-generator', prompt: (t) => `Create invoice HTML for "${t}". INV-${Math.floor(Math.random()*9000)+1000}. Table, subtotal, tax 10%. Inline CSS. OUTPUT ONLY HTML.` },
    { path: 'social-bio-generator', prompt: (t) => `Generate bios for "${t}". OUTPUT JSON: {"platforms":[{"platform":"Instagram","bio":"..."},...]} No markdown.` },
    { path: 'product-description', prompt: (t) => `Write 3 product descriptions for "${t}". OUTPUT JSON: {"descriptions":[{"headline":"...","body":"..."}]} No markdown.` },
    { path: 'startup-ideas', prompt: (t) => `Generate 5 startup ideas for "${t}". OUTPUT JSON: {"ideas":[{"name":"...","problem":"...","market":"...","revenue":"...","cost":"...","steps":["1.","2.","3."]}]} No markdown.` },
    { path: 'content-repurposer', prompt: (t) => `Repurpose "${t}" into 5 formats. OUTPUT JSON: {"formats":[{"type":"Twitter","content":"..."},...]} No markdown.` },
    { path: 'website-auditor', prompt: (t) => `Audit website: "${t}". Technical, Content, On-page SEO with fixes. OUTPUT CLEAN TEXT. No markdown.` },
    { path: 'landing-page-copywriter', prompt: (t) => `Write 3 landing page copies for "${t}". OUTPUT JSON: {"copy":["Var1","Var2","Var3"]} No markdown.` },
    { path: 'competitor-analyzer', prompt: (t) => `Analyze competitor: "${t}". Keyword gaps, content gaps, traffic. OUTPUT CLEAN TEXT. No markdown.` },
    { path: 'schema-generator', prompt: (t) => `Generate JSON-LD schemas for "${t}" (Article, Product, FAQ, Org). OUTPUT JSON: {"schemas":[{...}]} No markdown.` },
    { path: 'content-calendar', prompt: (t) => `30-day content calendar for "${t}". OUTPUT JSON: {"calendar":[{"day":1,"topic":"...","keyword":"...","type":"Blog","platform":"..."}]} No markdown.` },
    { path: 'review-response-generator', prompt: (t) => `Write review responses for "${t}". OUTPUT JSON: {"responses":[{"stars":5,"response":"..."}]} No markdown.` },
];

toolRoutes.forEach(route => {
    app.post(`/api/tool/${route.path}`, async (req, res) => {
        const input = sanitizeStrict(req.body.topic || req.body.prompt);
        if (!input) return err(res, 'Prompt required', 400);
        if (route.type === 'image') {
            const seed = Math.floor(Math.random() * 999999);
            return ok(res, { success: true, imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(input)}?width=1024&height=1024&nologo=true&seed=${seed}` });
        }
        if (route.type === 'logo') {
            const seed = Math.floor(Math.random() * 999999);
            const prompts = [`minimal flat logo for "${input}", white bg`, `gradient badge logo "${input}"`, `monogram "${input}" luxury`, `icon+text logo "${input}" modern`];
            return ok(res, { success: true, imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompts[Math.floor(Math.random() * prompts.length)])}?width=1024&height=1024&nologo=true&seed=${seed}` });
        }
        const result = await askAI(route.prompt(input));
        if (!result) return err(res, 'AI generation failed', 503);
        try {
            if (result.trim().startsWith('{') || result.trim().startsWith('[')) return ok(res, { success: true, data: JSON.parse(result) });
            return ok(res, { success: true, article: result });
        } catch (e) { return ok(res, { success: true, text: result }); }
    });
});

// ==========================================
// POWERFUL AI AGENTS - ACTUALLY WORKING
// ==========================================

// AGENT 1: Content Writer - Writes AND Publishes
app.post('/api/agent/content-writer', async (req, res) => {
    const { topic, count = 1 } = req.body;
    if (!topic) return err(res, 'Topic required', 400);
    
    const results = [];
    for (let i = 0; i < Math.min(count, 5); i++) {
        const html = await askAI(`Write a 1500+ word SEO blog about: "${topic}". H1, 5-6 H2 sections, bullet points. Include link: <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;">free AI tools</a>. Professional tone. OUTPUT ONLY HTML.`);
        if (html) {
            const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
            results.push({ title: titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '') : topic, content: html, wordCount: html.split(/\s+/).length });
        }
    }
    
    // If blogger is connected, also publish
    let published = false;
    if (BLOGGER_REFRESH_TOKEN && BLOG_ID && results.length > 0) {
        try {
            const token = await getBloggerToken();
            if (token) {
                const title = results[0].title;
                await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/`, {
                    kind: 'blogger#post', title, content: results[0].content, labels: [topic.split(' ').slice(0, 3).join(' '), 'AI Generated', 'PilotStaff']
                }, { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 });
                pingIndexNow(`https://${BLOG_ID}.blogspot.com`);
                published = true;
                await sendTelegram(`✍️ <b>Content Writer Agent</b>\n📝 Published: ${title.substring(0, 60)}\n🔗 ${WEBSITE_URL}/blog`, true);
            }
        } catch (e) { console.log('Publish skipped:', e.message); }
    }
    
    ok(res, { success: true, articles: results, published, message: `Generated ${results.length} articles${published ? ' and published 1 to blog' : ''}` });
});

// AGENT 2: SEO Expert - Full Audit + Keywords + Fix Plan
app.post('/api/agent/seo-expert', async (req, res) => {
    const { url, niche } = req.body;
    if (!url && !niche) return err(res, 'URL or niche required', 400);
    const target = url || niche;
    
    const audit = await askAI(`You are a senior SEO consultant with 15 years experience. Perform a COMPLETE SEO analysis for: "${target}"

Provide:

1. TOP 20 KEYWORDS TO TARGET
- Mix of: 5 high-volume (1000+ searches/mo), 10 medium (100-1000), 5 long-tail (<100)
- For each: keyword, estimated difficulty (Low/Medium/High), search intent

2. ON-PAGE SEO CHECKLIST
- Check: Title tag, Meta description, H1, H2 hierarchy, Internal links, Image alt tags, URL structure, Schema markup, Page speed, Mobile responsive
- For each: Status (✅/❌), Priority (Critical/High/Medium), Specific fix

3. CONTENT STRATEGY
- 10 blog post titles that would rank for this niche
- Content gaps to fill
- Recommended content length and format

4. TECHNICAL SEO
- Core Web Vitals recommendations
- Schema markup needed
- Crawlability issues

5. BACKLINK STRATEGY
- 10 types of sites to get backlinks from
- Outreach email template

OUTPUT CLEAN TEXT. Use ✅ and ❌ for status. Number all items.`);

    if (!audit) return err(res, 'AI failed', 503);
    ok(res, { success: true, audit, target, timestamp: new Date().toISOString() });
});

// AGENT 3: Social Media Manager - 7 Days of Content
app.post('/api/agent/social-manager', async (req, res) => {
    const { niche, platforms = ['instagram', 'twitter', 'linkedin'], days = 7 } = req.body;
    if (!niche) return err(res, 'Niche required', 400);
    
    const content = await askAI(`You are a viral social media manager. Create ${days} days of content for: "${niche}"

Platforms: ${platforms.join(', ')}

For EACH day create:
- Hook (attention-grabbing first line)
- Post content (platform-optimized)
- Hashtags (platform-specific)
- Best posting time
- Expected engagement type

RULES:
- Instagram: Visual-focused, emoji-rich, story angles, reels ideas
- Twitter: Concise, thread-worthy, controversial takes, data points
- LinkedIn: Professional, personal story, lesson learned, actionable advice
- Mix content types: tips, stories, questions, polls, behind-scenes, results, motivation

OUTPUT STRICT JSON:
{"days":[{"day":1,"posts":[{"platform":"instagram","hook":"...","content":"...","hashtags":["#..."],"time":"9:00 AM","engagement":"saves"},{"platform":"twitter","hook":"...","content":"...","hashtags":["#..."],"time":"12:00 PM","engagement":"retweets"},{"platform":"linkedin","hook":"...","content":"...","hashtags":["#..."],"time":"8:00 AM","engagement":"comments"}]},{"day":2,"posts":[...]}]}
No markdown. No code blocks.`);

    if (!content) return err(res, 'AI failed', 503);
    try { ok(res, { success: true, data: JSON.parse(content), niche, platforms, days }); }
    catch (e) { ok(res, { success: true, text: content }); }
});

// AGENT 4: Email Marketer - Complete Funnel
app.post('/api/agent/email-marketer', async (req, res) => {
    const { product, audience, goal = 'sale' } = req.body;
    if (!product) return err(res, 'Product/service required', 400);
    
    const funnel = await askAI(`You are a $50K/month email marketing expert. Create a complete email funnel for: "${product}"
Target audience: ${audience || 'General'}
Goal: ${goal}

Create these emails:

EMAIL 1 - WELCOME (Send immediately)
Subject: Personalized, creates curiosity
Body: Quick win, set expectations, soft CTA

EMAIL 2 - VALUE (Day 2)
Subject: Promise specific result
Body: Teach one thing, build trust, resource link

EMAIL 3 - STORY (Day 4)
Subject: Emotional hook
Body: Before/after story, relatable problem, tease solution

EMAIL 4 - SOCIAL PROOF (Day 6)
Subject: Result/number focused
Body: Testimonial, case study, stats, urgency hint

EMAIL 5 - OFFER (Day 7)
Subject: Direct benefit
Body: Clear offer, bonuses, scarcity, strong CTA, P.S.

EMAIL 6 - LAST CHANCE (Day 8)
Subject: Urgency/fear of missing out
Body: Reminder, FAQ objection handling, final CTA

Each email: Subject (6-10 words), Preview text, Body (3-4 short paragraphs), P.S. line

OUTPUT STRICT JSON:
{"funnel":[{"day":0,"type":"welcome","subject":"...","preview":"...","body":"...","ps":"..."},{"day":2,"type":"value","subject":"...","preview":"...","body":"...","ps":"..."},{"day":4,"type":"story","subject":"...","preview":"...","body":"...","ps":"..."},{"day":6,"type":"proof","subject":"...","preview":"...","body":"...","ps":"..."},{"day":7,"type":"offer","subject":"...","preview":"...","body":"...","ps":"..."},{"day":8,"type":"lastchance","subject":"...","preview":"...","body":"...","ps":"..."}]}
No markdown. No code blocks.`);

    if (!funnel) return err(res, 'AI failed', 503);
    try { ok(res, { success: true, data: JSON.parse(funnel) }); }
    catch (e) { ok(res, { success: true, text: funnel }); }
});

// AGENT 5: Support Agent - Smart Customer Support
app.post('/api/agent/support-agent', async (req, res) => {
    const { question, context = 'PilotStaff AI Tools platform' } = req.body;
    if (!question) return err(res, 'Question required', 400);
    
    const answer = await askAI(`You are a friendly, helpful customer support agent for ${context}.

Customer question: "${question}"

Respond with:
1. Direct answer to their question
2. Step-by-step solution if applicable
3. Helpful tip related to their question
4. Offer further help

Tone: Warm, professional, patient. Never say "I'm an AI". Speak as a real support agent.
Use HTML for formatting (<b>, <br>, <ol>, <li>).
Keep under 200 words.`);

    if (!answer) return err(res, 'AI failed', 503);
    ok(res, { success: true, answer });
});

// AGENT 6: Video Scriptwriter - YouTube/Reels Scripts
app.post('/api/agent/video-scriptwriter', async (req, res) => {
    const { topic, platform = 'youtube', duration = '10 minutes' } = req.body;
    if (!topic) return err(res, 'Topic required', 400);
    
    const script = await askAI(`You are a viral video scriptwriter with 1M+ subscribers experience. Write a ${duration} ${platform} script about: "${topic}"

 ${platform === 'youtube' ? `
YOUTUBE SCRIPT FORMAT:
- HOOK (0-10 sec): Shocking statement, question, or bold claim that stops scroll
- INTRO (10-30 sec): Who you are, what this video covers, why they should watch
- MAIN CONTENT: 5-7 sections with clear transitions
  - Each section: Explain concept, give example, share insight
  - Include: B-roll suggestions, text overlays, sound effect cues
- ENGAGEMENT: Ask viewers to comment specific question
- CTA: Subscribe + mention next video
- OUTRO: Summary + final CTA

Include these cues in [BRACKETS]:
[CUT TO B-ROLL: ...]
[TEXT OVERLAY: ...]
[SOUND EFFECT: ...]
[TRANSITION: ...]
[MUSIC: ...]
[ZOOM IN/OUT]` : `
SHORT-FORM SCRIPT FORMAT (Reels/TikTok/Shorts):
- HOOK (0-3 sec): Visual + text that stops scroll
- SETUP (3-8 sec): Quick context
- PAYOFF (8-25 sec): Main value/reveal
- CTA (25-30 sec): Follow for more

Include:
[TEXT ON SCREEN: ...]
[CAPTION: ...]
[SOUND: ...]`}

Keep it conversational, energetic, and authentic. No robotic language.`);

    if (!script) return err(res, 'AI failed', 503);
    ok(res, { success: true, script, topic, platform, duration });
});

// ===== BLOG SYSTEM (Same as before but with fixed env) =====
const TRENDING_TOPICS = [
    'How to Use AI Tools to Save 10 Hours Every Day in 2025',
    '15 Free AI Websites That Replace Expensive Software',
    'AI Website Builder vs Hiring a Developer: Cost Comparison',
    'How Small Businesses Replace Employees with AI Agents',
    'Free AI Blog Writer That Writes Better Than Paid Tools',
    'Best AI Logo Makers in 2025: Tested and Compared',
    'How to Generate Meta Tags That Rank on Google',
    'AI Content Writing vs Human Writing: What Google Wants',
    '10 AI Tools Every Freelancer Needs to Double Income',
    'How to Start an AI Business with Zero Investment',
    'Free AI Image Generators That Actually Work in 2025',
    'How to Write ATS-Friendly Resume Using AI',
    'AI Social Media Manager: Post Daily Without Effort',
    'Complete Guide to AI SEO Tools for Beginners',
    'How to Create Business Names That Stand Out',
    'Free Invoice Generator: Professional Invoices in Seconds',
    'AI Email Writer: Emails That Get Replies Every Time',
    'How to Build Content Calendar Using AI in 15 Minutes',
    'YouTube SEO 2025: AI Tools for More Views',
    'Why Every Website Needs Privacy Policy in 2025',
    'AI Ad Copy Generators: Do They Actually Convert?',
    'How to Repurpose Content Into 5 Formats with AI',
    'Free Schema Generator: Boost Google Rankings',
    'Startup Ideas 2025: AI Opportunities Under $1000',
    'Competitor Analysis Using AI: Find Their Weaknesses',
    'Landing Page Copy That Converts: AI Formulas',
    'Hashtag Strategy 2025: Go Viral on Instagram',
    'AI Resume Builder vs Traditional Resume Services',
    'Product Description Writing with AI: Sales Booster',
    'Review Responses That Turn Angry Customers to Fans',
];

async function publishSEOBlog(topic, blogId) {
    const ct = sanitizeStrict(topic);
    const cb = sanitizeStrict(blogId);
    
    const blogHTML = await askAI(`Write a 1800+ word SEO blog about: "${ct}"
Date: ${new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'})}

REQUIREMENTS:
- H1 with primary keyword near start (under 60 chars)
- First 155 chars = meta description with keyword
- 5-6 H2 sections with secondary keywords
- Short paragraphs (3-4 sentences)
- Bullet lists in each section
- Include ALL these links naturally:
  * <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;">free AI tools</a>
  * <a href="${WEBSITE_URL}/tools/ai-blog-writer" style="color:#2563eb;font-weight:600;">AI blog writer</a>
  * <a href="${WEBSITE_URL}/agents" style="color:#2563eb;font-weight:600;">AI employees</a>
  * <a href="${WEBSITE_URL}/pricing" style="color:#2563eb;font-weight:600;">affordable AI plans</a>
- Conclusion: Summary + CTA to visit ${WEBSITE_URL}

OUTPUT ONLY HTML. No html/body/head. No markdown.`);

    if (!blogHTML) throw new Error('AI failed');
    const titleMatch = blogHTML.match(/<h1[^>]*>(.*?)<\/h1>/i);
    const postTitle = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').substring(0, 100) : ct;

    const token = await getBloggerToken();
    if (!token) throw new Error('Blogger auth failed');

    await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${cb}/posts/`, {
        kind: 'blogger#post', title: postTitle, content: blogHTML,
        labels: [ct.split(' ').slice(0, 3).join(' '), 'AI Tools', 'Free Tools', '2025', 'Guide', 'PilotStaff'],
    }, { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 });

    pingIndexNow(`https://${cb}.blogspot.com`);
    await sendTelegram(`📝 <b>Blog Published!</b>\n📐 ${postTitle.substring(0, 80)}\n🔗 https://${cb}.blogspot.com`, true);
    console.log(`✅ Published: ${postTitle.substring(0, 50)}...`);
    return postTitle;
}

app.post('/api/seo-blog-agent', async (req, res) => {
    const { topic, blogId } = req.body;
    if (!topic || !blogId) return err(res, 'Topic and Blog ID required', 400);
    try { const title = await publishSEOBlog(topic, blogId); ok(res, { success: true, message: `Published: "${title}"` }); }
    catch (e) { err(res, e.message, 500); }
});

app.post('/api/trigger-blog', async (req, res) => {
    if (!BLOG_ID) return err(res, 'BLOG_ID not set in Render env', 400);
    const topic = TRENDING_TOPICS[Math.floor(Math.random() * TRENDING_TOPICS.length)];
    try { const title = await publishSEOBlog(topic, BLOG_ID); ok(res, { success: true, message: `Published: "${title}"`, topic }); }
    catch (e) { err(res, e.message, 500); }
});

app.post('/api/trigger-bulk-blogs', async (req, res) => {
    const { count = 3 } = req.body;
    if (!BLOG_ID) return err(res, 'BLOG_ID not set', 400);
    const results = [];
    const shuffled = [...TRENDING_TOPICS].sort(() => Math.random() - 0.5).slice(0, Math.min(count, 10));
    for (const topic of shuffled) {
        try { const title = await publishSEOBlog(topic, BLOG_ID); results.push({ topic, title, success: true }); }
        catch (e) { results.push({ topic, error: e.message, success: false }); }
    }
    ok(res, { success: true, results });
});

app.get('/api/blog-status', async (req, res) => {
    try {
        const token = await getBloggerToken();
        if (!token) return ok(res, { connected: false, error: 'Auth failed. Check BLOGGER_REFRESH_TOKEN in Render env', debug: { hasToken: !!BLOGGER_REFRESH_TOKEN, hasClientId: !!BLOGGER_CLIENT_ID, hasSecret: !!BLOGGER_CLIENT_SECRET, hasBlogId: !!BLOG_ID } });
        const { data } = await axios.get(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts?maxResults=1`, { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 });
        ok(res, { connected: true, totalPosts: data.totalItems || 0, lastPost: data.items?.[0]?.title || 'No posts', blogUrl: `https://${BLOG_ID}.blogspot.com` });
    } catch (e) {
        ok(res, { connected: false, error: e.response?.data?.error?.message || e.message, debug: { hasToken: !!BLOGGER_REFRESH_TOKEN, hasClientId: !!BLOGGER_CLIENT_ID, hasSecret: !!BLOGGER_CLIENT_SECRET, hasBlogId: !!BLOG_ID } });
    }
});

// ===== AUTO-TRAFFIC ENGINE =====
app.post('/api/auto-traffic/trigger', async (req, res) => {
    const results = { blog: null, social: null, seo: null };
    
    // 1. Publish blog
    if (BLOG_ID) {
        try {
            const topic = TRENDING_TOPICS[Math.floor(Math.random() * TRENDING_TOPICS.length)];
            results.blog = await publishSEOBlog(topic, BLOG_ID);
        } catch (e) { results.blog = 'Failed: ' + e.message; }
    }
    
    // 2. Generate social content
    try {
        const social = await askAI('Generate 3 viral tweets about AI tools saving time for businesses. Each under 280 chars. OUTPUT JSON: {"tweets":["...","...","..."]}');
        results.social = social ? '3 tweets generated' : 'Failed';
    } catch (e) { results.social = 'Failed'; }
    
    ok(res, { success: true, results, timestamp: new Date().toISOString() });
});

// ===== CRON JOBS =====
cron.schedule('0 4 * * *', async () => {
    if (!BLOG_ID || !BLOGGER_REFRESH_TOKEN) return;
    const topic = TRENDING_TOPICS[Math.floor(Math.random() * TRENDING_TOPICS.length)];
    try { await publishSEOBlog(topic, BLOG_ID); console.log('✅ Auto-blog:', topic.substring(0, 40)); }
    catch (e) { console.error('❌ Auto-blog:', e.message); }
});

cron.schedule('*/30 * * * *', () => { console.log(`💓 ${new Date().toLocaleTimeString()} | Mem: ${Math.round(process.memoryUsage().heapUsed/1024/1024)}MB`); });

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { console.error('Unhandled:', err.message); res.status(500).json({ error: 'Internal error' }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🤖 PilotStaff API on ${PORT}`));
