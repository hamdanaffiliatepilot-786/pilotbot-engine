const { createClient } = require('@supabase/supabase-js');
const { env } = require('./env');
const logger = require('../utils/logger');

const SB_URL = env('SB_URL');
const SB_KEY = env('SB_KEY');

let supabase = null;

if (SB_URL && SB_KEY) {
    supabase = createClient(SB_URL, SB_KEY, {
        auth: { persistSession: false }
    });
    logger.info('Supabase client initialized');
} else {
    logger.warn('Supabase NOT configured — SB_URL or SB_KEY missing');
}

function requireDB(res) {
    if (!supabase) {
        res.status(503).json({ success: false, error: 'Database not configured' });
        return false;
    }
    return true;
}

module.exports = { supabase, requireDB };
