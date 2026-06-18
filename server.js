require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cron = require('node-cron');
const cors = require('cors');

const app = express();
app.use(cors({ origin: ['https://affiliatepilot-frontend.vercel.app', 'http://localhost:3000'], credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
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

if (!SB_URL || !SB_KEY) console.warn('⚠️ Supabase not set');
if (!GROQ_KEY) console.warn('⚠️ GROQ_KEY not set');

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

async function askAI(prompt) {
    if (!GROQ_KEY) return null;
    try {
        const r = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 4000,
        }, { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' }, timeout: 45000 });
        let c = r.data.choices[0].message.content;
        c = c.replace(/```json\n?/g, '').replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
        return c;
    } catch (e) { console.error('AI Error:', e.message?.substring(0, 100)); return null; }
}

async function getBloggerToken(userToken) {
    const token = userToken || BLOGGER_REFRESH_TOKEN;
    if (!token || !BLOGGER_CLIENT_ID || !BLOGGER_CLIENT_SECRET) return null;
    try {
        const r = await axios.post('https://oauth2.googleapis.com/token', { client_id: BLOGGER_CLIENT_ID, client_secret: BLOGGER_CLIENT_SECRET, refresh_token: token, grant_type: 'refresh_token' }, { timeout: 10000 });
        return r.data.access_token;
    } catch (e) { console.error('Blogger Auth Error:', e.message?.substring(0, 80)); return null; }
}

async function pingIndexNow(url) {
    try { await axios.post('https://api.indexnow.org/IndexNow', { host: new URL(url).hostname, key: 'pilotbotindexkey123', urlList: [url] }, { timeout: 5000 }); } catch (e) {}
}

function ok(res, data) { res.status(200).json(data); }
function err(res, msg, code) { res.status(code || 500).json({ success: false, error: msg }); }

// ===== ROUTES =====
app.get('/', (req, res) => res.send('🤖 PilotStaff API LIVE'));
app.get('/api/health', (req, res) => ok(res, { success: true, uptime: process.uptime(), services: { supabase: !!supabase, groq: !!GROQ_KEY, blogger: !!BLOGGER_REFRESH_TOKEN } }));

app.get('/api/public-stats', async (req, res) => {
    if (!supabase) return ok(res, { success: true, activeUsers: '0', totalTasks: '0' });
    try {
        const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const fmt = n => !n ? '0' : n >= 1000 ? (n / 1000).toFixed(1) + 'K+' : n.toString();
        ok(res, { success: true, activeUsers: fmt(users), totalTasks: fmt((users || 0) * 7) });
    } catch (e) { ok(res, { success: true, activeUsers: '0', totalTasks: '0' }); }
});

app.get('/api/get-old-posts', async (req, res) => {
    if (!BLOGGER_REFRESH_TOKEN || !BLOG_ID) return err(res, 'Blogger not configured', 400);
    try {
        const token = await getBloggerToken(); if (!token) return err(res, 'Auth failed', 401);
        const { data } = await axios.get(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts?maxResults=10`, { headers: { Authorization: `Bearer ${token}` } });
        ok(res, { success: true, posts: (data.items || []).map(p => ({ id: p.id, title: p.title, url: p.url, published: p.published, image: p.images?.[0]?.url })) });
    } catch (e) { err(res, e.message, 500); }
});

app.post('/api/ai-chat', async (req, res) => {
    const { message, sessionId } = req.body; if (!message || !sessionId) return err(res, 'Missing data', 400);
    const cm = sanitizeStrict(message), cs = sanitizeStrict(sessionId).substring(0, 100);
    let memText = '';
    if (supabase) { try { const { data: mem } = await supabase.from('chat_memories').select('summary').eq('session_id', cs).single(); if (mem?.summary) memText = mem.summary; } catch(e){} }
    const result = await askAI(`You are PilotStaff AI. Be concise. ${memText ? `Context: ${memText}\n` : ''}User: ${cm}\n\nHTML response (<b>,<br>,<li>). Under 200 words.`);
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
    console.log(`💰 Payment: ${orderID} | ${plan} | ${payerEmail}`);
    if (supabase && payerEmail) {
        try { await supabase.from('users').upsert({ email: payerEmail, plan, upgraded_at: new Date().toISOString() }, { onConflict: 'email' }); } catch(e){}
    }
    await sendTelegram(`💰 <b>New Sale!</b>\nPlan: ${plan}\nPrice: ${price}\nEmail: ${payerEmail}`, true);
    ok(res, { success: true });
});

// ===== 25 AI TOOLS ROUTES =====
const toolRoutes = [
    { path: 'website-builder', prompt: (t) => `Create a complete, production-ready single-page website. TOPIC: "${t}". Use inline CSS only. Modern, responsive, $5000 quality landing page. OUTPUT ONLY HTML.` },
    { path: 'blog-writer-free', prompt: (t) => `Write a 1500+ word SEO blog about "${t}". Use H1, H2, short paragraphs, bullet points. Include link: <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;">free AI tools</a>. OUTPUT ONLY HTML.` },
    { path: 'image-generator', type: 'image' },
    { path: 'logo-maker', type: 'logo' },
    { path: 'business-name-generator', prompt: (t) => `Generate 20 business names for "${t}". OUTPUT STRICT JSON: {"names": ["Name1 - Tagline", ...]} No markdown.` },
    { path: 'meta-tag-generator', prompt: (t) => `Generate SEO meta tags for "${t}". OUTPUT STRICT JSON: {"title":"...","description":"...","keywords":["..."],"og_title":"...","og_description":"..."} No markdown.` },
    { path: 'privacy-policy-generator', prompt: (t) => `Write complete Privacy Policy for ${t}. 10 sections. H2 headings. OUTPUT ONLY HTML.` },
    { path: 'terms-generator', prompt: (t) => `Write complete Terms of Service for ${t}. 10 sections. H2 headings. OUTPUT ONLY HTML.` },
    { path: 'resume-builder', prompt: (t) => `Create ATS-friendly resume for ${t}. Header, summary, experience, skills, education. Inline CSS. OUTPUT ONLY HTML.` },
    { path: 'paragraph-rewriter', prompt: (t) => `Rewrite this paragraph professionally: "${t}". Keep exact meaning. OUTPUT ONLY TEXT.` },
    { path: 'ad-copy-generator', prompt: (t) => `Generate 5 ad copies for "${t}". OUTPUT STRICT JSON: {"copy": ["Ad1", "Ad2", ...]} No markdown.` },
    { path: 'email-writer', prompt: (t) => `Write 3 professional emails for: "${t}". OUTPUT STRICT JSON: {"emails": ["Subject: ...\n\nBody", ...]} No markdown.` },
    { path: 'hashtag-generator', prompt: (t) => `Generate 1 caption and 20 hashtags for "${t}". OUTPUT STRICT JSON: {"caption":"...","hashtags":["#tag1",...]} No markdown.` },
    { path: 'youtube-seo', prompt: (t) => `Generate 5 YouTube titles and 10 tags for "${t}". OUTPUT STRICT JSON: {"titles":["..."],"tags":["..."]} No markdown.` },
    { path: 'invoice-generator', prompt: (t) => `Create invoice HTML for "${t}". INV-${Math.floor(Math.random()*9000)+1000}. Date: ${new Date().toLocaleDateString()}. Table, subtotal, tax 10%, total. Inline CSS. OUTPUT ONLY HTML.` },
    { path: 'social-bio-generator', prompt: (t) => `Generate bios for "${t}". OUTPUT STRICT JSON: {"platforms": [{"platform":"Instagram","bio":"..."},{"platform":"Twitter","bio":"..."}]} No markdown.` },
    { path: 'product-description', prompt: (t) => `Write 3 product descriptions for "${t}". OUTPUT STRICT JSON: {"descriptions": [{"headline":"...","body":"..."}]} No markdown.` },
    { path: 'startup-ideas', prompt: (t) => `Generate 5 startup ideas for "${t}". OUTPUT STRICT JSON: {"ideas": [{"name":"...","problem":"...","market":"...","revenue":"...","cost":"...","steps":["1.","2."]}]} No markdown.` },
    { path: 'content-repurposer', prompt: (t) => `Repurpose "${t}" into 5 formats. OUTPUT STRICT JSON: {"formats": [{"type":"Twitter","content":"..."},{"type":"LinkedIn","content":"..."}]} No markdown.` },
    { path: 'website-auditor', prompt: (t) => `Audit website: "${t}". Technical, Content, On-page SEO. Give fixes. OUTPUT CLEAN TEXT. No markdown.` },
    { path: 'landing-page-copywriter', prompt: (t) => `Write 3 landing page copy variations for "${t}". OUTPUT STRICT JSON: {"copy": ["Var1...", "Var2...", "Var3..."]} No markdown.` },
    { path: 'competitor-analyzer', prompt: (t) => `Analyze competitor: "${t}". Keyword gaps, content gaps, traffic sources. OUTPUT CLEAN TEXT. No markdown.` },
    { path: 'schema-generator', prompt: (t) => `Generate JSON-LD schemas for "${t}" (Article, Product, FAQ, Org). OUTPUT STRICT JSON: {"schemas": [{...}]} No markdown.` },
    { path: 'content-calendar', prompt: (t) => `30-day content calendar for "${t}". OUTPUT STRICT JSON: {"calendar": [{"day":1,"topic":"...","keyword":"...","type":"Blog","platform":"..."}]} No markdown.` },
    { path: 'review-response-generator', prompt: (t) => `Write review responses for "${t}". OUTPUT STRICT JSON: {"responses": [{"stars":5,"response":"..."}]} No markdown.` },
];

toolRoutes.forEach(route => {
    app.post(`/api/tool/${route.path}`, async (req, res) => {
        const input = sanitizeStrict(req.body.topic || req.body.prompt);
        if (!input) return err(res, 'Prompt required', 400);

        // Image Generators
        if (route.type === 'image') {
            const seed = Math.floor(Math.random() * 999999);
            return ok(res, { success: true, imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(input)}?width=1024&height=1024&nologo=true&seed=${seed}` });
        }
        if (route.type === 'logo') {
            const seed = Math.floor(Math.random() * 999999);
            const prompts = [`minimal flat icon logo for "${input}", white bg, no text`, `gradient badge logo text "${input}"`, `monogram of "${input}" luxury serif`, `icon + text logo "${input}" modern`];
            return ok(res, { success: true, imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompts[Math.floor(Math.random() * prompts.length)])}?width=1024&height=1024&nologo=true&seed=${seed}` });
        }

        const result = await askAI(route.prompt(input));
        if (!result) return err(res, 'AI generation failed', 503);

        try {
            if (result.startsWith('{') || result.startsWith('[')) {
                return ok(res, { success: true, data: JSON.parse(result) });
            }
            return ok(res, { success: true, article: result });
        } catch (e) {
            return ok(res, { success: true, text: result });
        }
    });
});

// ===== SEO BLOG AGENT (Direct Function, No localhost) =====
async function publishSEOBlog(topic, blogId, userBloggerToken) {
    const ct = sanitizeStrict(topic), cb = sanitizeStrict(blogId);
    const blogHTML = await askAI(`Write a 1500+ word SEO blog about: "${ct}". H1, H2, short paragraphs. Include link: <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;">free AI tools</a>. OUTPUT ONLY HTML.`);
    if (!blogHTML) throw new Error('AI failed');
    const titleMatch = blogHTML.match(/<h1[^>]*>(.*?)<\/h1>/i);
    const postTitle = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').substring(0, 100) : `${ct} - Guide ${new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;
    const token = await getBloggerToken(userBloggerToken); if (!token) throw new Error('Blogger auth failed');
    await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${cb}/posts/`, { kind: 'blogger#post', title: postTitle, content: blogHTML, labels: [ct, 'AI Generated', 'Guide', '2025'] }, { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 });
    pingIndexNow(`https://${cb}.blogspot.com`);
    await sendTelegram(`📝 <b>Blog Published!</b>\n📐 ${postTitle.substring(0, 80)}`, true);
}

app.post('/api/seo-blog-agent', async (req, res) => {
    const { topic, blogId, userBloggerToken } = req.body; if (!topic || !blogId) return err(res, 'Missing data', 400);
    try { await publishSEOBlog(topic, blogId, userBloggerToken); ok(res, { success: true, message: 'Published!' }); }
    catch (e) { err(res, e.message, 500); }
});

// ===== CRON JOBS =====
cron.schedule('0 4 * * *', async () => {
    if (!BLOGGER_REFRESH_TOKEN || !BLOG_ID) return;
    const topics = ['20 Free AI Tools That Save 100+ Hours', 'How to Hire AI Employees', 'AI Website Builder vs Developer', 'Free AI Blog Writer Guide', 'Best AI Logo Maker'];
    try { await publishSEOBlog(topics[Math.floor(Math.random() * topics.length)], BLOG_ID); } catch(e){}
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🤖 PilotStaff API on ${PORT}`));
