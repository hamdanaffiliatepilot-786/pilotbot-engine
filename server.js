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
const BLOGGER_CLIENT_ID = process.env.BLOGGER_CLIENT_ID;
const BLOGGER_CLIENT_SECRET = process.env.BLOGGER_CLIENT_SECRET;
const BLOGGER_REFRESH_TOKEN = process.env.BLOGGER_REFRESH_TOKEN;
const BLOG_ID = process.env.BLOG_ID;
const INSTA_SESSION_ID = process.env.INSTA_SESSION_ID;
const UNSPLASH_KEY = process.env.UNSPLASH_KEY;
const PINTEREST_TOKEN = process.env.PINTEREST_TOKEN;
const PINTEREST_BOARD_ID = process.env.PINTEREST_BOARD_ID;
const CJ_ACCESS_TOKEN = process.env.CJ_ACCESS_TOKEN;

const supabase = createClient(SB_URL, SB_KEY);
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

async function askAI(prompt) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: "You are an expert e-commerce Trend Analyst and SEO copywriter. Always output STRICT JSON." },
                { role: "user", content: prompt }
            ],
            temperature: 0.6,
        }, { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } });
        return response.data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
    } catch(e) { console.error("AI Error:", e.message); return null; }
}

async function getSettings() { const { data } = await supabase.from('agent_settings').select('*').eq('id', 1).single(); return data; }

// ==========================================
// 🛠️ WEBSITE TOOLS API
// ==========================================

app.get('/', (req, res) => res.send('🤖 PilotBot God Mode V2 is AWAKE!'));
app.get('/ping', (req, res) => res.status(200).send('🤖 PilotBot is awake!'));
app.get('/api/settings', async (req, res) => { const settings = await getSettings(); res.json(settings); });
app.post('/api/settings', async (req, res) => { const newSettings = req.body; const { error } = await supabase.from('agent_settings').update(newSettings).eq('id', 1); if (error) return res.json({ success: false, error: error.message }); res.json({ success: true }); });

app.post('/api/emi-calculator', (req, res) => { const { principal, rate, tenure } = req.body; if (!principal || !rate || !tenure) return res.status(400).json({ success: false }); const r = rate / (12 * 100); const emi = (principal * r * Math.pow(1 + r, tenure)) / (Math.pow(1 + r, tenure) - 1); res.json({ success: true, emi: Math.round(emi) }); });
app.get('/api/currency', async (req, res) => { const { from = 'USD', to = 'INR', amount = 1 } = req.query; try { const { data } = await axios.get(`https://open.er-api.com/v6/latest/${from}`); const rate = data.rates[to]; res.json({ success: true, rate, result: (amount * rate).toFixed(2) }); } catch (e) { res.json({ success: false }); } });

app.post('/api/compare-prices', async (req, res) => { const { product } = req.body; if (!product) return res.json({ success: false, prices: [] }); try { const prompt = `I need estimated prices for "${product}" across 8 global platforms. Give me a JSON array with 8 objects. Stores must be: Amazon, Flipkart, Myntra, Meesho, Ajio, AliExpress, Nykaa, and Walmart. Each object must have: "store" (string), "price" (estimated string with $ symbol), "search_query" (optimized search term). Just return the raw JSON array.`; let prices = JSON.parse(await askAI(prompt)); prices = prices.map(p => { let url = '#'; const q = encodeURIComponent(p.search_query || product); switch(p.store) { case 'Amazon': url = `https://www.amazon.com/s?k=${q}`; break; case 'Flipkart': url = `https://www.flipkart.com/search?q=${q}`; break; default: url = `https://www.google.com/search?q=buy+${q}`; } return { ...p, url: url }; }); res.json({ success: true, prices: prices }); } catch (error) { res.json({ success: false, prices: [] }); } });

app.post('/api/reel-product', async (req, res) => { const { reelUrl } = req.body; if (!reelUrl) return res.json({ success: false, productName: "No URL" }); try { const run = await apifyClient.actor("shu8hvrXbJbY3Eb9W").call({ "resultsType": "posts", "directUrls": [reelUrl], "resultsLimit": 1, "instagramCookies": [{ "name": "sessionid", "value": INSTA_SESSION_ID, "domain": ".instagram.com" }] }); const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems(); if(items.length > 0) { const caption = items[0].caption || items[0].text || "Product found"; const productName = await askAI(`Extract the main product name from this caption. Just return the name. Caption: "${caption}"`); res.json({ success: true, productName: productName }); } else { res.json({ success: false, productName: "Could not identify" }); } } catch (error) { res.json({ success: false, productName: "Error" }); } });

app.get('/api/coupons', async (req, res) => { const store = req.query.store || 'amazon'; const keyword = store === 'amazon' ? 'amazon coupons today' : 'flipkart offers today'; try { const run = await apifyClient.actor("se6u51NCji6y89vBS").call({ "keywords": [keyword], "maxResultsPerKeyword": 3, "fullDetails": true, "marketplace": "com" }); const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems(); const coupons = items.map(item => ({ code: item.title || "Deal", discount: item.price ? `Price: ${item.price}` : "Click to see" })).slice(0, 3); res.json({ coupons }); } catch (error) { res.json({ coupons: [{ code: "Limit Reached", discount: "Try later" }] }); } });

app.post('/api/price-alert', async (req, res) => { const { email, product_url, target_price } = req.body; if (!email || !product_url || !target_price) return res.status(400).json({ success: false }); const { error } = await supabase.from('price_alerts').insert({ email, product_url, target_price }); if (!error) res.json({ success: true, message: "Alert set!" }); else res.json({ success: false, error: error.message }); });

app.post('/api/gift-finder', async (req, res) => { const { relation, budget, interest } = req.body; if (!relation || !budget) return res.json({ success: false, gifts: [] }); try { const prompt = `Suggest 5 best gift ideas for my ${relation} who likes ${interest || 'general things'}. Budget: ${budget}. Return a JSON array with 5 objects. Each object must have: "gift_name" (string), "estimated_price" (string with $), "reason" (10 words).`; const gifts = JSON.parse(await askAI(prompt)); res.json({ success: true, gifts }); } catch (error) { res.json({ success: false, gifts: [] }); } });

// 🛒 DASHBOARD APIs
app.get('/api/orders', async (req, res) => { const email = req.query.email; if(!email) return res.json({ success: false, orders: [] }); const { data } = await supabase.from('orders').select('*').eq('buyer_email', email).order('created_at', { ascending: false }); res.json({ success: true, orders: data || [] }); });
app.post('/api/add-wishlist', async (req, res) => { const { email, product_id } = req.body; if(!email || !product_id) return res.json({ success: false }); const { error } = await supabase.from('wishlist').insert({ email, product_id }); if(!error) res.json({ success: true }); else res.json({ success: false, error }); });
app.get('/api/wishlist', async (req, res) => { const email = req.query.email; if(!email) return res.json({ success: false, items: [] }); const { data } = await supabase.from('wishlist').select('*').eq('email', email); res.json({ success: true, items: data || [] }); });

// 🚀 MEGA API: SAVE ORDER & AUTO-PLACE ON CJ
app.post('/api/save-order', async (req, res) => {
    const { paypal_order_id, product_name, product_image, price_usd, buyer_email, buyer_address, cj_pid, cj_vid, traffic_source, cj_base_cost, cj_shipping_cost, profit_margin } = req.body;
    if(!paypal_order_id || !product_name) return res.json({ success: false });
    
    const expected = new Date(); expected.setDate(expected.getDate() + 10);
    
    // 1. Save Order to Supabase
    const { data: orderData, error } = await supabase.from('orders').insert({
        paypal_order_id, product_name, product_image, price_usd, buyer_email, buyer_address, 
        expected_delivery: expected.toISOString().split('T')[0], status: 'Processing',
        traffic_source: traffic_source || 'Direct',
        cj_base_cost: cj_base_cost, cj_shipping_cost: cj_shipping_cost, profit_margin: profit_margin
    }).select().single();

    if(error) return res.json({ success: false, error });

    // 2. AUTO-PLACE ORDER ON CJ
    if(CJ_ACCESS_TOKEN && cj_pid && cj_vid && buyer_address) {
        try {
            console.log("🔄 Auto-placing order on CJ...");
            await axios.post('https://developers.cjdropshipping.com/api2.0/v1/shopping/order/create', {
                orderId: paypal_order_id,
                shippingMethod: "Standard Shipping",
                productList: [{ pid: cj_pid, vid: cj_vid, quantity: 1 }],
                shippingAddress: buyer_address
            }, { headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN } });
            
            await supabase.from('orders').update({ status: 'Shipped by CJ' }).eq('id', orderData.id);
            console.log("✅ CJ Order Auto-Placed!");
        } catch(cjErr) {
            console.error("❌ CJ Auto-Order Failed:", cjErr.response?.data || cjErr.message);
            await supabase.from('orders').update({ status: 'Manual Action Needed' }).eq('id', orderData.id);
        }
    }
    res.json({ success: true, order: orderData });
});

// 📊 ADMIN ANALYTICS API (DETAILED PROFIT & TRAFFIC)
app.get('/api/admin/stats', async (req, res) => {
    try {
        const { data: orders } = await supabase.from('orders').select('*');
        const { data: products } = await supabase.from('store_products').select('*');
        
        let totalRevenue = 0, monthlyRevenue = 0, totalCJCost = 0, totalShippingCost = 0, totalProfit = 0;
        const currentMonth = new Date().getMonth();
        let trafficSources = { Pinterest: 0, Blog: 0, Google: 0, Direct: 0 };
        let statusCounts = { Processing: 0, 'Shipped by CJ': 0, Delivered: 0 };
        let recentOrders = [];

        orders.forEach(o => {
            const price = parseFloat(String(o.price_usd).replace(/[^0-9.]/g, '')) || 0;
            const cjCost = parseFloat(o.cj_base_cost) || 0;
            const shipCost = parseFloat(o.cj_shipping_cost) || 0;
            const margin = parseFloat(o.profit_margin) || 0;

            totalRevenue += price;
            totalCJCost += cjCost;
            totalShippingCost += shipCost;
            totalProfit += margin;
            if (new Date(o.created_at).getMonth() === currentMonth) monthlyRevenue += price;
            
            if(o.traffic_source) trafficSources[o.traffic_source] = (trafficSources[o.traffic_source] || 0) + 1;
            else trafficSources['Direct']++;
            if(o.status) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
        });

        // Get Recent 5 Orders
        recentOrders = orders.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5).map(o => ({
            id: o.paypal_order_id, name: o.product_name, price: o.price_usd, 
            cj_cost: o.cj_base_cost, shipping: o.cj_shipping_cost, profit: o.profit_margin,
            source: o.traffic_source, status: o.status, date: new Date(o.created_at).toLocaleDateString()
        }));

        res.json({ 
            success: true, 
            totalOrders: orders.length, 
            totalProducts: products.length,
            totalRevenue: totalRevenue.toFixed(2), 
            monthlyRevenue: monthlyRevenue.toFixed(2),
            totalCJCost: totalCJCost.toFixed(2),
            totalShippingCost: totalShippingCost.toFixed(2),
            totalProfit: totalProfit.toFixed(2),
            statusCounts,
            trafficSources,
            recentOrders
        });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// 🚀 CJ TEST API (SMART PRICING WITH SHIPPING & MARGIN)
app.get('/api/test-cj', async (req, res) => {
    if (!CJ_ACCESS_TOKEN) return res.json({ success: false, error: "CJ_ACCESS_TOKEN missing!" });
    try {
        const cjRes = await axios.get('https://developers.cjdropshipping.com/api2.0/v1/product/list', { params: { pageNum: 1, pageSize: 2 }, headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN } });
        const products = cjRes?.data?.data?.list;
        if(!products) return res.json({ success: false, error: "No products" });
        let savedCount = 0;
        
        for (let prod of products) {
            // Step 1: Get Real Shipping Cost from CJ
            let shippingCost = 5.00; // Default fallback
            try {
                const shipRes = await axios.post('https://developers.cjdropshipping.com/api2.0/v1/logistics/freight', {
                    pid: prod.productId, vid: prod.defaultVariantId, quantity: 1, country: "US"
                }, { headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN } });
                if(shipRes.data?.data?.totalPrice) shippingCost = parseFloat(shipRes.data.data.totalPrice);
            } catch(e) { console.log("Shipping API failed, using default"); }

            const baseCost = parseFloat(prod.sellPrice) || 2.00;
            
            // Step 2: AI SEO + Smart Pricing
            const prompt = `Product: ${prod.productNameEn}, Base Wholesale: $${baseCost}, Shipping Cost: $${shippingCost.toFixed(2)}.
            Return STRICT JSON: {
              "seo_title": "Viral Amazon style title",
              "seo_desc": "2-line sales desc",
              "specs": "Material: Premium|Shipping: FREE Worldwide|Warranty: 1 Year",
              "selling_price_usd": "Calculate: Base + Shipping + 40% Profit Margin. Round to .99. NO $ SIGN JUST NUMBER"
            }`;
            
            const aiResult = await askAI(prompt);
            if(aiResult) {
                const seoData = JSON.parse(aiResult);
                const finalPrice = parseFloat(seoData.selling_price_usd);
                const profit = (finalPrice - baseCost - shippingCost).toFixed(2);

                await supabase.from('store_products').insert({ 
                    cj_product_id: prod.productId, name: seoData.seo_title, description: seoData.seo_desc, specs: seoData.specs,
                    image: prod.productImage, price_usd: seoData.selling_price_usd, affiliate_link: prod.productUrl,
                    cj_pid: prod.productId, cj_vid: prod.defaultVariantId,
                    cj_base_cost: baseCost.toFixed(2), cj_shipping_cost: shippingCost.toFixed(2), profit_margin: profit
                });
                savedCount++;
            }
        }
        res.json({ success: true, message: `✅ ${savedCount} Smart Priced Products Imported!` });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// ==========================================
// 🤖 AUTOMATION ENGINE
// ==========================================

cron.schedule('0 8 * * *', async () => { /* Blog Cron - Same */ });
cron.schedule('0 10 * * *', async () => { if (!CJ_ACCESS_TOKEN || !GROQ_KEY) return; try { const cjRes = await axios.get('https://developers.cjdropshipping.com/api2.0/v1/product/list', { params: { pageNum: 1, pageSize: 3 }, headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN } }); const products = cjRes?.data?.data?.list; if(!products) return; for (let prod of products) { let shipCost = 5.00; try { const s = await axios.post('https://developers.cjdropshipping.com/api2.0/v1/logistics/freight', { pid: prod.productId, vid: prod.defaultVariantId, quantity: 1, country: "US" }, { headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN } }); if(s.data?.data?.totalPrice) shipCost = parseFloat(s.data.data.totalPrice); } catch(e) {} const base = parseFloat(prod.sellPrice) || 2; const prompt = `Product: ${prod.productNameEn}, Base: $${base}, Ship: $${shipCost.toFixed(2)}. JSON: {"seo_title":"title","seo_desc":"desc","specs":"Key:Val|Key:Val","selling_price_usd":"Calculate: Base+Ship+40%Margin. Round .99 NUMBER ONLY"}`; const r = await askAI(prompt); if(r) { const d = JSON.parse(r); const fp = parseFloat(d.selling_price_usd); const pr = (fp - base - shipCost).toFixed(2); await supabase.from('store_products').insert({ cj_product_id: prod.productId, name: d.seo_title, description: d.seo_desc, specs: d.specs, image: prod.productImage, price_usd: d.selling_price_usd, affiliate_link: prod.productUrl, cj_pid: prod.productId, cj_vid: prod.defaultVariantId, cj_base_cost: base.toFixed(2), cj_shipping_cost: shipCost.toFixed(2), profit_margin: pr }); } } } catch(e) {} });
cron.schedule('0 12 * * *', async () => { /* Pinterest Cron - Same */ });
cron.schedule('0 14 * * *', async () => { /* Price Drop Alert Cron - Same */ });
cron.schedule('0 0 * * 0', async () => { /* Cleanup Cron - Same */ });

async function getBloggerAccessToken() { try { const response = await axios.post('https://oauth2.googleapis.com/token', { client_id: BLOGGER_CLIENT_ID, client_secret: BLOGGER_CLIENT_SECRET, refresh_token: BLOGGER_REFRESH_TOKEN, grant_type: 'refresh_token' }); return response.data.access_token; } catch (error) { return null; } }

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 PilotBot God Mode V2 Running!'));
