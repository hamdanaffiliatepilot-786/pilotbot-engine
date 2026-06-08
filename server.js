const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const cron = require('node-cron');
const app = express();
app.use(express.json());

// 🔑 HARDCODED KEYS
const SB_URL = 'https://pvsqvpbjhiwjgifbgmzl.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2c3F2cGJqaGl3amdpZmJnbXpsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDgxNDg0MiwiZXhwIjoyMDk2MzkwODQyfQ.obNCTgtXsFrszT478xb2Cne1mGnxYK-Mls52OccouK4';
const DEFAULT_GEMINI_KEY = 'AQ.Ab8RN6JomLmhvW5ZSmLlMLTrpBj8NzbZPqTtoAqRAdmHIZEEFA';

// 🔑 BLOGGER OAUTH CREDENTIALS (Tumhare diye hue)
const BLOGGER_CLIENT_ID = '347967969883-i25938q4sqpsgoihh3up0s2dahp0e7c9.apps.googleusercontent.com';
const BLOGGER_CLIENT_SECRET = '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';
const BLOGGER_REFRESH_TOKEN = '1//04N1D0adAA4NJCgYIARAAGAQSNwF-L9Ir9PxJtu7wfbQr5srSZEx_HszKuX23n2HdQWkyumqxGz_WKcScM_NKk9Plggmf9qhxMMA';
const BLOG_ID = '4924676053847184907';

const supabase = createClient(SB_URL, SB_KEY);

// Helper: Get Settings
async function getSettings() {
    const { data } = await supabase.from('agent_settings').select('*').eq('id', 1).single();
    return data;
}

// ROUTES
app.get('/', (req, res) => res.send('🤖 PilotBot Engine with Blogger API is LIVE!'));

app.get('/api/settings', async (req, res) => {
    const settings = await getSettings();
    res.json(settings);
});

app.post('/api/settings', async (req, res) => {
    const newSettings = req.body;
    const { error } = await supabase.from('agent_settings').update(newSettings).eq('id', 1);
    if (error) return res.json({ success: false, error: error.message });
    res.json({ success: true });
});

app.get('/api/test-add', async (req, res) => {
    const { data, error } = await supabase.from('products').insert({
        name: 'Test Smart Watch',
        image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&q=80',
        price: 29.99,
        source: 'cj_dropship',
        description: 'Auto-synced by PilotBot. Premium quality.'
    });
    if(error) return res.json({error: error.message});
    res.json({success: true, message: "Test product added to Supabase!"});
});

// ==========================================
// 🤖 BLOGGER AUTO-POST LOGIC
// ==========================================

// Function to get fresh Access Token from Refresh Token
async function getBloggerAccessToken() {
    try {
        const response = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: BLOGGER_CLIENT_ID,
            client_secret: BLOGGER_CLIENT_SECRET,
            refresh_token: BLOGGER_REFRESH_TOKEN,
            grant_type: 'refresh_token'
        });
        return response.data.access_token;
    } catch (error) {
        console.error("❌ Error generating Access Token:", error.response?.data || error.message);
        return null;
    }
}

// CRON JOB: Auto Blog Post (Daily 8 AM)
cron.schedule('0 8 * * *', async () => {
    console.log("⏰ Cron triggered: Writing Blog...");
    const settings = await getSettings();
    const GEM_KEY = settings.gemini_key || DEFAULT_GEMINI_KEY;

    try {
        // 1. Generate Content using Gemini
        console.log("✍️ Generating content with Gemini...");
        const genAI = new GoogleGenerativeAI(GEM_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        
        const prompt = `Write a highly SEO optimized, humanized, 800-word shopping guide blog post about "Best Global Tech Deals Today". Include engaging headings, bullet points, and product recommendations. Write in a friendly tone. Do not include any fake links.`;
        const result = await model.generateContent(prompt);
        const blogText = result.response.text();

        // 2. Get Fresh Blogger Access Token
        console.log("🔑 Fetching Blogger Access Token...");
        const accessToken = await getBloggerAccessToken();
        
        if (!accessToken) {
            console.log("❌ Failed to get Access Token. Blog not posted.");
            return;
        }

        // 3. Post to Blogger
        console.log("📝 Posting to Blogger...");
        const bloggerRes = await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts`, {
            kind: 'blogger#post',
            title: 'Best Global Tech Deals Today - AI Curated by Hamdan',
            content: blogText + `<br><br><p>Visit <a href="https://affiliatepilot-frontend.vercel.app">AffiliatePilot</a> for real-time price tracking tools!</p>`
        }, {
            headers: { 
                Authorization: `Bearer ${accessToken}`, 
                'Content-Type': 'application/json' 
            }
        });

        if(bloggerRes.status === 200) {
            console.log("✅ Blog Successfully Posted on Blogspot!");
        } else {
            console.log("⚠️ Blogger API returned status:", bloggerRes.status);
        }

    } catch(e) {
        console.log("❌ Blog Automation Error:", e.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 PilotBot Engine with Full Blogger Automation Running!'));
