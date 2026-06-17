require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ==========================================
// ⚙️ CONFIGURATION
// ==========================================
const SB_URL = process.env.SB_URL;
const SB_KEY = process.env.SB_KEY;
const GROQ_KEY = process.env.GROQ_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Mrhamdu123@";
const BLOGGER_CLIENT_ID = process.env.BLOGGER_CLIENT_ID;
const BLOGGER_CLIENT_SECRET = process.env.BLOGGER_CLIENT_SECRET;
const BLOGGER_REFRESH_TOKEN = process.env.BLOGGER_REFRESH_TOKEN;

const supabase = createClient(SB_URL, SB_KEY);

// ==========================================
// 🧠 AI BRAIN (GROQ - Llama 3)
// ==========================================
async function askAI(prompt) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
        }, { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } });
        return response.data.choices[0].message.content;
    } catch (e) {
        console.error("AI Error:", e.message);
        return null;
    }
}

async function getBloggerToken(userToken) {
    const res = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: BLOGGER_CLIENT_ID, client_secret: BLOGGER_CLIENT_SECRET,
        refresh_token: userToken || BLOGGER_REFRESH_TOKEN, grant_type: 'refresh_token'
    });
    return res.data.access_token;
}

// ==========================================
// 🚀 API ROUTES
// ==========================================
app.get('/', (req, res) => res.send('🤖 PilotStaff Engine Live'));

// ---------------------------------------------------------
// 🔐 USER AUTH
// ---------------------------------------------------------
app.post('/api/auth', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.json({ success: false });
    let { data: user } = await supabase.from('users').select('*').eq('email', email).single();
    if (!user) { const { data: newUser } = await supabase.from('users').insert({ email }).select().single(); return res.json({ success: true, user: newUser }); }
    res.json({ success: true, user });
});

// ---------------------------------------------------------
// 🛠️ TOOL 1: AI Website Builder
// ---------------------------------------------------------
app.post('/api/tool/website-builder', async (req, res) => {
    const { prompt } = req.body;
    const code = await askAI(`Generate a COMPLETE, single-page HTML website about: "${prompt}". Return ONLY valid HTML. Use inline CSS. Make it modern, responsive. Use https://placehold.co/600x400/EEE/31343C?text=Image for images. No markdown.`);
    if (code) res.json({ success: true, code: code.replace(/```html/g, '').replace(/```/g, '') });
    else res.json({ success: false });
});

// ---------------------------------------------------------
// 🛠️ TOOL 2: AI Blog Writer (Free Text)
// ---------------------------------------------------------
app.post('/api/tool/blog-writer-free', async (req, res) => {
    const { topic } = req.body;
    const article = await askAI(`Write a highly SEO optimized, 1500-word article about "${topic}". Use H1, H2, H3 tags properly. Include bullet points. Write in a conversational yet authoritative tone. Output ONLY clean HTML.`);
    if (article) res.json({ success: true, article: article.replace(/```html/g, '').replace(/```/g, '') });
    else res.json({ success: false });
});

// ---------------------------------------------------------
// 🛠️ TOOL 3: AI Image Generator
// ---------------------------------------------------------
app.post('/api/tool/image-generator', async (req, res) => {
    const { prompt } = req.body;
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;
    res.json({ success: true, imageUrl });
});

// ---------------------------------------------------------
// 🛠️ TOOL 4: Instagram/TikTok Hashtag Generator
// ---------------------------------------------------------
app.post('/api/tool/hashtag-generator', async (req, res) => {
    const { topic } = req.body;
    const result = await askAI(`Give 1 highly engaging Instagram caption and 20 viral hashtags for a post about "${topic}". Output STRICT JSON: {"caption": "...", "hashtags": ["tag1", "tag2"]}`);
    try { res.json({ success: true, data: JSON.parse(result.replace(/```json/g, '').replace(/```/g, '').trim()) }); }
    catch(e) { res.json({ success: false }); }
});

// ---------------------------------------------------------
// 🛠️ TOOL 5: YouTube Title & Tag Generator
// ---------------------------------------------------------
app.post('/api/tool/youtube-seo', async (req, res) => {
    const { topic } = req.body;
    const result = await askAI(`Give 5 viral YouTube video titles and 10 SEO tags for a video about "${topic}". Output STRICT JSON: {"titles": ["t1", "t2"], "tags": ["tag1", "tag2"]}`);
    try { res.json({ success: true, data: JSON.parse(result.replace(/```json/g, '').replace(/```/g, '').trim()) }); }
    catch(e) { res.json({ success: false }); }
});

// ---------------------------------------------------------
// 🛠️ TOOL 6: AI Social Media Manager
// ---------------------------------------------------------
app.post('/api/tool/social-manager', async (req, res) => {
    const { niche, count } = req.body;
    const result = await askAI(`Give ${count || 3} viral tweets about "${niche}". Output STRICT JSON array: ["tweet1", "tweet2"]`);
    try { res.json({ success: true, tweets: JSON.parse(result.replace(/```json/g, '').replace(/```/g, '').trim()) }); }
    catch(e) { res.json({ success: false }); }
});

// ---------------------------------------------------------
// 🛠️ TOOL 7: Faceless Video Asset Factory
// ---------------------------------------------------------
app.post('/api/tool/video-assets', async (req, res) => {
    const { topic } = req.body;
    const scriptResult = await askAI(`30-sec viral YouTube Shorts script about "${topic}". JSON: {"hook": "...", "body": "...", "cta": "..."}`);
    let script = null;
    try { script = JSON.parse(scriptResult.replace(/```json/g, '').replace(/```/g, '').trim()); } catch(e) {}
    const thumbnailUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(`Clickbait YouTube thumbnail for ${topic}`)}?width=1280&height=720&nologo=true&seed=${Math.floor(Math.random() * 1000)}`;
    res.json({ success: true, script, thumbnailUrl });
});

// ---------------------------------------------------------
// 🛠️ TOOL 8: Pro Auto-Blogger (Posts directly to Blogger)
// ---------------------------------------------------------
app.post('/api/tool/blog-worker', async (req, res) => {
    const { niche, blogId, userBloggerToken } = req.body;
    try {
        const articleHTML = await askAI(`Write 800-word SEO blog about "${niche}". Output ONLY HTML.`);
        if (!articleHTML) return res.json({ success: false, error: "AI failed" });
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(`Blog feature image about ${niche}`)}?width=1200&height=630&nologo=true`;
        const finalHTML = `<img src="${imageUrl}" style="width:100%;border-radius:8px;margin-bottom:20px;" /> ${articleHTML}`;
        const token = await getBloggerToken(userBloggerToken);
        await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts/`, {
            kind: 'blogger#post', title: `${niche} - Ultimate Guide`, content: finalHTML, labels: [niche]
        }, { headers: { Authorization: `Bearer ${token}` } });
        res.json({ success: true, message: "Posted!" });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

// ---------------------------------------------------------
// 🛠️ TOOL 9: AI Humanizer (Premium)
// ---------------------------------------------------------
app.post('/api/tool/ai-humanizer', async (req, res) => {
    const { text } = req.body;
    const result = await askAI(`Rewrite the following text to make it sound 100% human, highly engaging, and bypass AI detectors. Keep the original meaning but use varied sentence structures, idioms, and a conversational tone. Add relevant emojis if suitable.\n\nOriginal Text:\n${text}\n\nOutput ONLY the rewritten text.`);
    if (result) res.json({ success: true, humanizedText: result });
    else res.json({ success: false });
});

// ---------------------------------------------------------
// 🛠️ TOOL 10: Instant Indexer
// ---------------------------------------------------------
app.post('/api/tool/index-now', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.json({ success: false, error: "URL required" });
    try {
        await axios.post('https://api.indexnow.org/IndexNow', {
            host: new URL(url).hostname,
            key: "pilotstaffindexkey2024",
            urlList: [url]
        });
        res.json({ success: true, message: "URL submitted to IndexNow! Google will crawl it within minutes." });
    } catch(e) { res.json({ success: false, error: "Failed to submit" }); }
});

// ==========================================
// 🤖 AI CHATBOT WITH MEMORY
// ==========================================
app.post('/api/ai-chat', async (req, res) => {
    const { message, sessionId } = req.body;
    if (!message || !sessionId) return res.json({ success: false });

    let { data: memory } = await supabase.from('chat_memories').select('summary').eq('session_id', sessionId).single();
    let contextPrompt = "You are a highly professional AI Sales Agent for PilotStaff. Help the user, answer questions about our AI tools, and try to qualify them as a lead.";
    
    if (memory && memory.summary) {
        contextPrompt += `\n\nYou have spoken to this user before. Here is what you remember:\n${memory.summary}`;
    }

    const prompt = `${contextPrompt}\n\nUser: ${message}\n\nRespond in a helpful, concise way. Also, at the very end of your response, output a JSON block with a brief summary of this conversation for your memory. Format: {"reply": "Your actual response to user", "memory_update": "Brief summary of what happened"} `;
    
    const result = await askAI(prompt);
    
    try {
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.memory_update) {
                await supabase.from('chat_memories')
                    .upsert({ session_id: sessionId, summary: parsed.memory_update, updated_at: new Date().toISOString() }, { onConflict: 'session_id' });
            }
            res.json({ success: true, reply: parsed.reply });
        } else {
            res.json({ success: true, reply: result });
        }
    } catch(e) {
        res.json({ success: true, reply: result });
    }
});

// ==========================================
// 📊 CRM ROUTES
// ==========================================
app.get('/api/crm/leads', async (req, res) => {
    const { data: leads, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error });
    res.json({ success: true, leads });
});

app.post('/api/crm/leads', async (req, res) => {
    const { name, email, phone, status, value } = req.body;
    const { data, error } = await supabase.from('leads').insert({ name, email, phone, status, value }).select().single();
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

// ==========================================
// 💳 PAYPAL WEBHOOK
// ==========================================
app.post('/api/paypal-webhook', async (req, res) => {
    console.log("✅ Webhook hit:", req.body);
    res.status(200).send('OK');
});

// ==========================================
// 🛡️ ADMIN ROUTE
// ==========================================
app.post('/api/admin-login', (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) res.json({ success: true });
    else res.json({ success: false });
});

// ==========================================
// 🚀 START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 PilotStaff LIVE on ${PORT}`));
