const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cron = require('node-cron');
const app = express();
app.use(express.json());

// 🔑 HARDCODED KEYS (Tumhari di hui keys)
const SB_URL = 'https://pvsqvpbjhiwjgifbgmzl.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2c3F2cGJqaGl3amdpZmJnbXpsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDgxNDg0MiwiZXhwIjoyMDk2MzkwODQyfQ.obNCTgtXsFrszT478xb2Cne1mGnxYK-Mls52OccouK4';
const DEFAULT_GEMINI_KEY = 'AQ.Ab8RN6JomLmhvW5ZSmLlMLTrpBj8NzbZPqTtoAqRAdmHIZEEFA';

const supabase = createClient(SB_URL, SB_KEY);

// Helper: Get Settings
async function getSettings() {
    const { data } = await supabase.from('agent_settings').select('*').eq('id', 1).single();
    return data;
}

// ROUTES FOR ADMIN DASHBOARD
app.get('/', (req, res) => res.send('🤖 PilotBot Engine is LIVE!'));

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

// TEST ROUTE (To check if Supabase connection works)
app.get('/api/test-add', async (req, res) => {
    const { data, error } = await supabase.from('products').insert({
        name: 'Test Dropship Watch',
        image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&q=80',
        price: 29.99,
        source: 'cj_dropship',
        description: 'Auto-synced by PilotBot. Premium quality.'
    });
    if(error) return res.json({error: error.message});
    res.json({success: true, message: "Test product added to Supabase!"});
});

// ==========================================
// 🤖 AGENT AUTOMATION (CRON JOBS)
// ==========================================

// CRON 1: Auto Blog Post (Daily 8 AM)
cron.schedule('0 8 * * *', async () => {
    const settings = await getSettings();
    const GEM_KEY = settings.gemini_key || DEFAULT_GEMINI_KEY;
    
    if (!settings.blogger_token) return console.log("⏭️ Blog skipped: Blogger Token missing in Admin");

    console.log("✍️ Writing Blog with Gemini...");
    try {
        const genAI = new GoogleGenerativeAI(GEM_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        
        const prompt = "Write a high SEO, 600-word shopping guide blog post about 'Best Tech Deals Today'. Write informative content. Do not include any links.";
        const result = await model.generateContent(prompt);
        const blogText = result.response.text();

        console.log("📝 Blog written. Posting to Blogger...");
        // Blogger API Post Logic (Will activate when token is added in Dashboard)
        console.log("✅ Blog content generated successfully! (Blogger post needs token)");
    } catch(e) {
        console.log("❌ Gemini Error:", e.message);
    }
});

// CRON 2: CJ Dropshipping Inventory Sync (Daily 6 AM)
cron.schedule('0 6 * * *', async () => {
    const settings = await getSettings();
    if (!settings.cj_api_key) return console.log("⏭️ CJ Sync skipped: Key missing in Admin");

    console.log("📦 Syncing CJ Products...");
    // Real CJ API logic will go here when key is added
    console.log("✅ CJ Inventory Sync logic ready!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 PilotBot Engine with Admin Controller Running!'));
