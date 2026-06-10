require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { ApifyClient } = require('apify-client');
const axios = require('axios');
const cron = require('node-cron');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

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
const ADMIN_SECRET_TOKEN = process.env.ADMIN_SECRET_TOKEN || 'default_token';

const supabase = createClient(SB_URL, SB_KEY);
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

async function askAI(prompt) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: "You are an expert e-commerce SEO copywriter. Always output STRICT JSON." },
                { role: "user", content: prompt }
            ],
            temperature: 0.6,
        }, { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } });
        return response.data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
    } catch(e) { console.error("AI Error:", e.message); return null; }
}

app.get('/', (req, res) => res.send('🤖 PilotBot God Mode V3 is AWAKE!'));

// ORDER SAVE (Without Nodemailer - No Crash)
app.post('/api/save-order', async (req, res) => {
    const { paypal_order_id, products, buyer_email, buyer_address, traffic_source, total_price, total_profit } = req.body;
    if(!paypal_order_id || !products) return res.json({ success: false });
    
    const expected = new Date(); expected.setDate(expected.getDate() + 12);
    
    const { data: orderData, error } = await supabase.from('orders').insert({
        paypal_order_id, product_name: products.map(p=>p.name).join(', '), 
        product_image: products[0].image, price_usd: total_price, 
        buyer_email, buyer_address: buyer_address, 
        expected_delivery: expected.toISOString().split('T')[0], 
        status: 'Pending CJ Order',
        traffic_source: traffic_source || 'Direct',
        cj_base_cost: products.reduce((s,p)=>s+parseFloat(p.cj_base_cost||0),0),
        cj_shipping_cost: products.reduce((s,p)=>s+parseFloat(p.cj_shipping_cost||0),0),
        profit_margin: total_profit
    }).select().single();

    if(error) return res.json({ success: false, error });
    console.log(`✅ NEW ORDER: $${total_price} | Profit: $${total_profit} | Check Supabase!`);
    res.json({ success: true, order: orderData });
});

// ADMIN STATS (SECURED)
app.get('/api/admin/stats', async (req, res) => {
    const auth = req.headers.authorization;
    if(auth !== `Bearer ${ADMIN_SECRET_TOKEN}`) return res.status(401).json({ error: "Unauthorized" });
    
    try {
        const { data: orders } = await supabase.from('orders').select('*');
        const { data: products } = await supabase.from('store_products').select('*');
        
        let totalRevenue = 0, totalCJCost = 0, totalShippingCost = 0, totalProfit = 0;
        const trafficSources = {}; const statusCounts = {};

        orders.forEach(o => {
            const price = parseFloat(String(o.price_usd).replace(/[^0-9.]/g, '')) || 0;
            totalRevenue += price;
            totalCJCost += parseFloat(o.cj_base_cost) || 0;
            totalShippingCost += parseFloat(o.cj_shipping_cost) || 0;
            totalProfit += parseFloat(o.profit_margin) || 0;
            if(o.traffic_source) trafficSources[o.traffic_source] = (trafficSources[o.traffic_source] || 0) + 1;
            if(o.status) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
        });

        res.json({ success: true, totalOrders: orders.length, totalProducts: products.length, totalRevenue: totalRevenue.toFixed(2), totalCJCost: totalCJCost.toFixed(2), totalShippingCost: totalShippingCost.toFixed(2), totalProfit: totalProfit.toFixed(2), trafficSources, statusCounts, recentOrders: orders.slice(-5).reverse() });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// OTHER APIS (Compare, Reel, Coupons)
app.post('/api/compare-prices', async (req, res) => { const { product } = req.body; if (!product) return res.json({ success: false, prices: [] }); try { const prompt = `I need estimated prices for "${product}" across 8 global platforms. Give me a JSON array with 8 objects. Stores must be: Amazon, Flipkart, Myntra, Meesho, Ajio, AliExpress, Nykaa, and Walmart. Each object must have: "store", "price", "search_query". Just return the raw JSON array.`; let prices = JSON.parse(await askAI(prompt)); prices = prices.map(p => { let url = '#'; const q = encodeURIComponent(p.search_query || product); switch(p.store) { case 'Amazon': url = `https://www.amazon.com/s?k=${q}`; break; case 'Flipkart': url = `https://www.flipkart.com/search?q=${q}`; break; default: url = `https://www.google.com/search?q=buy+${q}`; } return { ...p, url: url }; }); res.json({ success: true, prices: prices }); } catch (error) { res.json({ success: false, prices: [] }); } });

// CRON: Smart Product Import (No Loss Formula)
cron.schedule('0 10 * * *', async () => {
    if (!CJ_ACCESS_TOKEN || !GROQ_KEY) return;
    try {
        const cjRes = await axios.get('https://developers.cjdropshipping.com/api2.0/v1/product/list', { params: { pageNum: 1, pageSize: 5 }, headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN } });
        const products = cjRes?.data?.data?.list;
        if(!products) return;
        
        for (let prod of products) {
            let shipCost = 5.00; 
            try {
                const s = await axios.post('https://developers.cjdropshipping.com/api2.0/v1/logistics/freight', { pid: prod.productId, vid: prod.defaultVariantId, quantity: 1, country: "US" }, { headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN } });
                if(s.data?.data?.totalPrice) shipCost = parseFloat(s.data.data.totalPrice);
            } catch(e) {}
            
            const base = parseFloat(prod.sellPrice) || 2;
            const calculatedPrice = ((base + shipCost) * 1.4); 
            const finalPrice = Math.floor(calculatedPrice) + 0.99; 
            const profit = (finalPrice - base - shipCost).toFixed(2);

            const prompt = `Product: ${prod.productNameEn}. JSON: {"seo_title":"Amazon viral title","seo_desc":"2 line desc","specs":"Material: Premium|Shipping: FREE Worldwide|Warranty: 1 Year"}`;
            const r = await askAI(prompt);
            if(r) {
                const d = JSON.parse(r);
                await supabase.from('store_products').insert({ 
                    cj_product_id: prod.productId, name: d.seo_title, description: d.seo_desc, specs: d.specs,
                    image: prod.productImage, price_usd: finalPrice.toFixed(2), affiliate_link: prod.productUrl,
                    cj_pid: prod.productId, cj_vid: prod.defaultVariantId,
                    cj_base_cost: base.toFixed(2), cj_shipping_cost: shipCost.toFixed(2), profit_margin: profit
                });
            }
        }
    } catch(e) { console.error("Cron Error:", e.message); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 PilotBot V3 Running!'));
