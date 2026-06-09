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
    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: "llama-3.3-70b-versatile",
        messages: [
            { role: "system", content: "You are a helpful shopping assistant designed to output strict JSON when asked." },
            { role: "user", content: prompt }
        ],
        temperature: 0.5,
    }, { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } });
    return response.data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
}

async function getSettings() { const { data } = await supabase.from('agent_settings').select('*').eq('id', 1).single(); return data; }

app.get('/', (req, res) => res.send('🤖 PilotBot Engine is AWAKE and LIVE!'));
app.get('/ping', (req, res) => res.status(200).send('🤖 PilotBot is awake!'));
app.get('/api/settings', async (req, res) => { const settings = await getSettings(); res.json(settings); });
app.post('/api/settings', async (req, res) => { const newSettings = req.body; const { error } = await supabase.from('agent_settings').update(newSettings).eq('id', 1); if (error) return res.json({ success: false, error: error.message }); res.json({ success: true }); });

app.post('/api/emi-calculator', (req, res) => { const { principal, rate, tenure } = req.body; if (!principal || !rate || !tenure) return res.status(400).json({ success: false }); const r = rate / (12 * 100); const emi = (principal * r * Math.pow(1 + r, tenure)) / (Math.pow(1 + r, tenure) - 1); res.json({ success: true, emi: Math.round(emi) }); });
app.get('/api/currency', async (req, res) => { const { from = 'USD', to = 'INR', amount = 1 } = req.query; try { const { data } = await axios.get(`https://open.er-api.com/v6/latest/${from}`); const rate = data.rates[to]; res.json({ success: true, rate, result: (amount * rate).toFixed(2) }); } catch (e) { res.json({ success: false }); } });

app.post('/api/compare-prices', async (req, res) => { const { product } = req.body; if (!product) return res.json({ success: false, prices: [] }); try { const prompt = `I need estimated prices for "${product}" across 8 global platforms. Give me a JSON array with 8 objects. Stores must be: Amazon, Flipkart, Myntra, Meesho, Ajio, AliExpress, Nykaa, and Walmart. Each object must have: "store" (string), "price" (estimated string with $ symbol), "search_query" (optimized search term). Just return the raw JSON array.`; let prices = JSON.parse(await askAI(prompt)); prices = prices.map(p => { let url = '#'; const q = encodeURIComponent(p.search_query || product); switch(p.store) { case 'Amazon': url = `https://www.amazon.com/s?k=${q}`; break; case 'Flipkart': url = `https://www.flipkart.com/search?q=${q}`; break; case 'AliExpress': url = `https://www.aliexpress.com/w/wholesale-${q}.html`; break; default: url = `https://www.google.com/search?q=buy+${q}`; } return { ...p, url: url }; }); res.json({ success: true, prices: prices }); } catch (error) { res.json({ success: false, prices: [] }); } });

app.post('/api/reel-product', async (req, res) => { const { reelUrl } = req.body; if (!reelUrl) return res.json({ success: false, productName: "No URL" }); try { const run = await apifyClient.actor("shu8hvrXbJbY3Eb9W").call({ "resultsType": "posts", "directUrls": [reelUrl], "resultsLimit": 1, "instagramCookies": [{ "name": "sessionid", "value": INSTA_SESSION_ID, "domain": ".instagram.com" }] }); const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems(); if(items.length > 0) { const caption = items[0].caption || items[0].text || "Product found"; const prompt = `Extract the main product name from this caption. Just return the name. Caption: "${caption}"`; const productName = await askAI(prompt); res.json({ success: true, productName: productName }); } else { res.json({ success: false, productName: "Could not identify" }); } } catch (error) { res.json({ success: false, productName: "Error" }); } });

app.get('/api/coupons', async (req, res) => { const store = req.query.store || 'amazon'; const keyword = store === 'amazon' ? 'amazon coupons today' : 'flipkart offers today'; try { const run = await apifyClient.actor("se6u51NCji6y89vBS").call({ "keywords": [keyword], "maxResultsPerKeyword": 3, "fullDetails": true, "marketplace": "com" }); const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems(); const coupons = items.map(item => ({ code: item.title || "Deal", discount: item.price ? `Price: ${item.price}` : "Click to see" })).slice(0, 3); res.json({ coupons }); } catch (error) { res.json({ coupons: [{ code: "Limit Reached", discount: "Try later" }] }); } });

app.post('/api/price-alert', async (req, res) => { const { email, product_url, target_price } = req.body; if (!email || !product_url || !target_price) return res.status(400).json({ success: false }); const { error } = await supabase.from('price_alerts').insert({ email, product_url, target_price }); if (!error) res.json({ success: true, message: "Alert set!" }); else res.json({ success: false, error: error.message }); });

app.post('/api/gift-finder', async (req, res) => { const { relation, budget, interest } = req.body; if (!relation || !budget) return res.json({ success: false, gifts: [] }); try { const prompt = `Suggest 5 best gift ideas for my ${relation} who likes ${interest || 'general things'}. Budget: ${budget}. Return a JSON array with 5 objects. Each object must have: "gift_name" (string), "estimated_price" (string with $), "reason" (10 words).`; const gifts = JSON.parse(await askAI(prompt)); res.json({ success: true, gifts }); } catch (error) { res.json({ success: false, gifts: [] }); } });

// 🛒 ORDER TRACKING APIs
app.post('/api/save-order', async (req, res) => {
    const { paypal_order_id, product_name, product_image, price_usd, buyer_email } = req.body;
    if(!paypal_order_id || !product_name) return res.json({ success: false });
    // Expected delivery 10 days from now
    const expected = new Date(); expected.setDate(expected.getDate() + 10);
    const { data, error } = await supabase.from('orders').insert({
        paypal_order_id, product_name, product_image, price_usd, buyer_email, expected_delivery: expected.toISOString().split('T')[0]
    }).select().single();
    if(!error) res.json({ success: true, order: data });
    else res.json({ success: false, error });
});

app.get('/api/orders', async (req, res) => {
    const email = req.query.email;
    if(!email) return res.json({ success: false, orders: [] });
    const { data } = await supabase.from('orders').select('*').eq('buyer_email', email).order('created_at', { ascending: false });
    res.json({ success: true, orders: data || [] });
});

// 🚀 CJ TEST API (USD ONLY)
app.get('/api/test-cj', async (req, res) => {
    if (!CJ_ACCESS_TOKEN) return res.json({ success: false, error: "CJ_ACCESS_TOKEN missing!" });
    try {
        const cjRes = await axios.get('https://developers.cjdropshipping.com/api2.0/v1/product/list', {
            params: { pageNum: 1, pageSize: 2 }, headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN }
        });
        const products = cjRes?.data?.data?.list;
        if(!products || products.length === 0) return res.json({ success: false, error: "No products" });
        let savedCount = 0;
        for (let prod of products) {
            const prompt = `Product: ${prod.productNameEn}, Base Price: $${prod.sellPrice}. Return JSON: {"seo_title": "title", "seo_desc": "short 2 line desc", "specs": "3-4 bullet points", "selling_price_usd": "calculate_usd_price_with_50_percent_margin"}`;
            const seoData = JSON.parse(await askAI(prompt));
            await supabase.from('store_products').insert({ 
                cj_product_id: prod.productId, name: seoData.seo_title, description: seoData.seo_desc, specs: seoData.specs,
                image: prod.productImage, price_usd: seoData.selling_price_usd, affiliate_link: prod.productUrl 
            });
            savedCount++;
        }
        res.json({ success: true, message: `✅ ${savedCount} Products Imported (USD Only)!` });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// CRON JOBS
cron.schedule('0 8 * * *', async () => { /* Blog Cron Same */ });
cron.schedule('0 10 * * *', async () => { if (!CJ_ACCESS_TOKEN || !GROQ_KEY) return; try { const cjRes = await axios.get('https://developers.cjdropshipping.com/api2.0/v1/product/list', { params: { pageNum: 1, pageSize: 3 }, headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN } }); const products = cjRes?.data?.data?.list; if(!products) return; for (let prod of products) { const prompt = `Product: ${prod.productNameEn}, Base Price: $${prod.sellPrice}. Return JSON: {"seo_title": "title", "seo_desc": "desc", "specs": "3 bullets", "selling_price_usd": "usd_price_with_margin"}`; const seoData = JSON.parse(await askAI(prompt)); await supabase.from('store_products').insert({ cj_product_id: prod.productId, name: seoData.seo_title, description: seoData.seo_desc, specs: seoData.specs, image: prod.productImage, price_usd: seoData.selling_price_usd, affiliate_link: prod.productUrl }); } } catch(e) {} });
cron.schedule('0 12 * * *', async () => { /* Pinterest Cron Same */ });

async function getBloggerAccessToken() { try { const response = await axios.post('https://oauth2.googleapis.com/token', { client_id: BLOGGER_CLIENT_ID, client_secret: BLOGGER_CLIENT_SECRET, refresh_token: BLOGGER_REFRESH_TOKEN, grant_type: 'refresh_token' }); return response.data.access_token; } catch (error) { return null; } }

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 PilotBot Running!'));
