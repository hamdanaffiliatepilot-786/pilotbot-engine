require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { env, envBool } = require('./config/env');
const { GEMINI_KEY, GROQ_KEY } = require('./config/ai');
const { supabase } = require('./config/database');
const { verifyCronSecret } = require('./middleware/security');
const { runDueTasks } = require('./services/task.service');
const { ok, err } = require('./utils/helpers');
const logger = require('./utils/logger');

const app = express();
app.locals.supabase = supabase;

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(morgan(':method :url :status :response-time ms - :remote-addr'));

const configuredOrigins = [
    env('FRONTEND_URL'),
    ...env('FRONTEND_URLS').split(',').map(u => u.trim().replace(/\/+$/, '')).filter(Boolean),
    'http://localhost:3000'
].filter(Boolean);

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        const normalized = origin.trim().replace(/\/+$/, '');
        const isAllowed = configuredOrigins.includes(normalized) ||
            (envBool('ALLOW_VERCEL_PREVIEWS') && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(normalized));
        if (isAllowed) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-cron-secret'],
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 80, message: { success: false, error: 'Too many requests. Try again in 15 minutes.' }, standardHeaders: true, legacyHeaders: false });
const toolLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 35, message: { success: false, error: 'Tool limit reached. Upgrade to Pro for unlimited.' }, standardHeaders: true, legacyHeaders: false });

app.use('/api/tool/', toolLimiter);
app.use('/api/agent/', toolLimiter);
app.use('/api/', globalLimiter);

// Routes
app.use('/', require('./routes/health'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tool', require('./routes/tools'));
app.use('/api/agent', require('./routes/agents'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api', require('./routes/subscriptions'));
app.use('/api/client', require('./routes/client'));
app.use('/api', require('./routes/capture'));
app.use('/api', require('./routes/referrals'));

// Cron
app.post('/api/internal/run-automation', verifyCronSecret, async (req, res) => {
    logger.info('Cron triggered');
    const result = await runDueTasks(12);
    if (!result.success) return err(res, result.error || 'Automation failed', 500);
    ok(res, { success: true, processed: result.processed, succeeded: result.succeeded });
});

app.use((req, res) => res.status(404).json({ success: false, error: 'Endpoint not found' }));
app.use((error, req, res, next) => {
    logger.error('Unhandled error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    logger.info(`PilotStaff API running on port ${PORT}`);
    logger.info(`Gemini: ${GEMINI_KEY ? '✅' : '❌'} | Groq: ${GROQ_KEY ? '✅' : '❌'}`);
});

const shutdown = (signal) => {
    logger.info(`${signal} - shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
