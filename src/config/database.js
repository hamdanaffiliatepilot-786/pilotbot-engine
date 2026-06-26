const { createClient } = require('@supabase/supabase-js');
const { env } = require('./env');
const logger = require('../utils/logger');

const SB_URL = env('SB_URL');
const SB_KEY = env('SB_KEY');

let supabase = null;

if (SB_URL && SB_KEY) {
    supabase = createClient(SB_URL, SB_KEY, {
        auth: { persistSession: false },
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

async function runTransaction(fn) {
    if (!supabase) {
        throw new Error('Database not configured');
    }

    try {
        const result = await fn(supabase);
        return result;
    } catch (error) {
        logger.error('Transaction failed:', error?.message || error);
        throw error;
    }
}

async function rpc(fnName, params) {
    if (!supabase) {
        throw new Error('Database not configured');
    }

    const { data, error } = await supabase.rpc(fnName, params);

    if (error) {
        logger.error(`RPC ${fnName} failed:`, error.message);
        throw new Error(error.message);
    }

    return data;
}

module.exports = { supabase, requireDB, runTransaction, rpc };
