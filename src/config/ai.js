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

// ─── Query Timing Wrapper ───
async function timedQuery(label, fn) {
  const timer = logger.startTimer(`db:${label}`);
  try {
    const result = await fn(supabase);
    logger.endTimer(timer);
    return result;
  } catch (error) {
    logger.endTimer(timer);
    logger.reportError(error, { query: label });
    throw error;
  }
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
    logger.reportError(error, { type: 'transaction' });
    throw error;
  }
}

async function rpc(fnName, params) {
  if (!supabase) {
    throw new Error('Database not configured');
  }

  const timer = logger.startTimer(`db:rpc:${fnName}`);
  try {
    const { data, error } = await supabase.rpc(fnName, params);
    logger.endTimer(timer);

    if (error) {
      logger.error(`RPC ${fnName} failed:`, error.message);
      throw new Error(error.message);
    }

    return data;
  } catch (error) {
    logger.endTimer(timer);
    throw error;
  }
}

module.exports = { supabase, requireDB, timedQuery, runTransaction, rpc };
