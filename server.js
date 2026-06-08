const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();
app.use(express.json());

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SB_URL, SB_KEY);

// TEST ROUTE
app.get('/', (req, res) => res.send('🤖 PilotBot Engine is LIVE!'));

// TEST ADD (With Full Description Fix)
app.get('/api/test-add', async (req, res) => {
    const { data, error } = await supabase.from('products').insert({
        name: 'Test Wireless Headphones',
        image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500&q=80',
        cost: 20.00,
        price: 39.99,
        description: 'High-quality AI-curated wireless headphones with deep bass and 15-hour battery life. Perfect for global shipping.',
        stock: 50
    });
    if(error) return res.json({error: error.message});
    res.json({success: true, message: "Test product added!"});
});

// SYNC ROUTE
app.get('/api/sync', (req, res) => {
    res.json({success: true, message: "Sync triggered!"});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 PilotBot Running on port ' + PORT));
