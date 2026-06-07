const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SB_URL, SB_KEY);

// TEST ROUTE 1: Check if agent is live
app.get('/', (req, res) => res.send('🤖 PilotBot Engine is LIVE!'));

// TEST ROUTE 2: Add Dummy Product to Test Database
app.get('/api/test-add', async (req, res) => {
    try {
        const { data, error } = await supabase.from('products').insert({
            name: 'Test Wireless Headphones',
            image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500&q=80',
            cost: 20.00,
            price: 39.99,
            description: 'High-quality AI-curated headphones with global shipping.',
            stock: 50
        });
        
        if(error) return res.json({error: error.message});
        res.json({success: true, message: "Test product added to Supabase!"});
    } catch(e) {
        res.json({error: e.message});
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 PilotBot Running on port ' + PORT));
