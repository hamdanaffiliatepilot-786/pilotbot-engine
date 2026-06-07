const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cron = require('node-cron');

const app = express();
app.use(express.json());

// ENV VARIABLES (Render me set karenge)
const CJ_KEY = process.env.CJ_API_KEY;
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;
const GEM_KEY = process.env.GEMINI_API_KEY;
const BLOGGER_TOKEN = process.env.BLOGGER_TOKEN;
const PINTEREST_TOKEN = process.env.PINTEREST_TOKEN;
const AFF_TAG = process.env.AMAZON_AFF_TAG || "yourid-21";

const supabase = createClient(SB_URL, SB_KEY);
const genAI = new GoogleGenerativeAI(GEM_KEY);

// ==========================================
// AGENT TASK 1: DAILY INVENTORY SYNC & MARGIN
// ==========================================
async function syncInventory() {
    try {
        console.log("🤖 Agent: Syncing Inventory from CJ...");
        // CJ API call (Mock structure - actual CJ API endpoint may vary)
        const cjRes = await axios.get('https://developers.cjdropshipping.com/api/product/list', {
            headers: { 'CJ-Access-Token': CJ_KEY }
        });
        const products = cjRes.data.data || [];

        for (let prod of products.slice(0, 5)) {
            const model = genAI.getGenerativeModel({ model: "gemini-pro" });
            const prompt = `Write a 50-word high-converting SEO product description for: ${prod.productNameEn}. Include keywords like 'Best Deal', 'Global Shipping'.`;
            const aiDesc = await model.generateContent(prompt);
            
            const costPrice = parseFloat(prod.sellingPrice || 10);
            const sellingPrice = (costPrice * 1.5).toFixed(2); // 50% Profit Margin

            await supabase.from('products').upsert({
                cj_id: prod.pid,
                name: prod.productNameEn,
                image: prod.productImage,
                cost: costPrice,
                price: sellingPrice,
                description: aiDesc.response.text(),
                stock: prod.stock || 10
            });
        }
        console.log("✅ Agent: Inventory Synced with 50% margin!");
    } catch(e) { console.error("Inventory Error:", e.message); }
}

// ==========================================
// AGENT TASK 2: AUTO BLOG POST (BLOGGER + AFFILIATE)
// ==========================================
async function autoBlog() {
    try {
        console.log("🤖 Agent: Writing SEO Blog Post...");
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const prompt = `Write a high SEO 600-word shopping blog post about 'Top 5 Tech Deals Today'. Include 2 Amazon product links formatted like: https://amazon.com/dp/EXAMPLE?tag=${AFF_TAG}. Use HTML tags <h2>, <p>.`;
        const result = await model.generateContent(prompt);
        const blogHTML = result.response.text();

        if(BLOGGER_TOKEN) {
            await axios.post('https://www.googleapis.com/blogger/v3/blogs/YOUR_BLOG_ID/posts', {
                kind: 'blogger#post', title: 'Top 5 Tech Deals Today - AI Curated', content: blogHTML
            }, { headers: { 'Authorization': `Bearer ${BLOGGER_TOKEN}`, 'Content-Type': 'application/json' } });
            console.log("✅ Agent: Blog Posted to Blogger!");
        }
    } catch(e) { console.error("Blog Error:", e.message); }
}

// ==========================================
// AGENT TASK 3: PINTEREST PIN CREATION
// ==========================================
async function autoPinterest() {
    try {
        console.log("🤖 Agent: Creating Pinterest Pin...");
        const { data: prods } = await supabase.from('products').select('*').limit(1);
        if(prods.length > 0 && PINTEREST_TOKEN) {
            const prod = prods[0];
            await axios.post('https://api.pinterest.com/v5/pins', {
                board_id: 'YOUR_BOARD_ID',
                title: prod.name,
                description: prod.description,
                media_source: { source_type: 'image_url', url: prod.image },
                link: `https://your-vercel-app.vercel.app/product/${prod.id}` // Link to your site
            }, { headers: { 'Authorization': `Bearer ${PINTEREST_TOKEN}`, 'Content-Type': 'application/json' } });
            console.log("✅ Agent: Pin Created on Pinterest!");
        }
    } catch(e) { console.error("Pinterest Error:", e.message); }
}

// ==========================================
// AGENT TASK 4: AUTO ORDER FULFILLMENT (PAYPAL WEBHOOK)
// ==========================================
app.post('/api/paypal-webhook', async (req, res) => {
    const { event_type, resource } = req.body;
    if(event_type === 'PAYMENT.SALE.COMPLETED') {
        console.log("🤖 Agent: New Order Received! Processing...");
        // Extract details (Simplified for example)
        const customerAddress = resource.shipping_address;
        const productId = resource.custom_id; // Pass product ID from frontend

        const { data: prod } = await supabase.from('products').select('*').eq('id', productId).single();

        if(prod) {
            // Place order on CJ Dropshipping
            await axios.post('https://developers.cjdropshipping.com/api/order/create', {
                orderType: 1, shippingName: customerAddress.recipient_name, 
                shippingAddress: customerAddress.line1, productId: prod.cj_id, quantity: 1
            }, { headers: { 'CJ-Access-Token': CJ_KEY } });

            await supabase.from('orders').insert({ product: prod.name, profit: (prod.price - prod.cost).toFixed(2), status: 'Shipped by Agent' });
            console.log("✅ Agent: Order shipped! Profit secured!");
        }
    }
    res.sendStatus(200);
});

// ==========================================
// CRON JOBS (Automated Daily Schedule)
// ==========================================
cron.schedule('0 10 * * *', syncInventory); // 10 AM Daily
cron.schedule('0 12 * * *', autoBlog);      // 12 PM Daily
cron.schedule('0 15 * * *', autoPinterest); //  3 PM Daily

app.get('/', (req, res) => res.send('🤖 PilotBot Engine is Running!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 PilotBot Engine Live on Port ${PORT}`);
    // syncInventory(); // Run once on start for testing
});
