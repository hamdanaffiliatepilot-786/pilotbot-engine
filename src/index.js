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

// Supabase ko app.locals pe bhi daalo taaki routes se access ho
app.locals.supabase = supabase;

// ─── Security Headers ───
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));

// ─── Compression ───
app.use(compression());

// ─── Request Logging ───
app.use(morgan(':method :url :status :response-time ms - :remote-addr'));

// ─── CORS ───
const configuredOrigins = [
    env('FRONTEND_URL'),
    ...env('FRONTEND_URLS').split(',').map(u => u.trim().replace(/\/+$/, '')).filter(Boolean),
    'http://localhost:3000'
].filter(Boolean);

const allowVercelPreviews = envBool('ALLOW_VERCEL_PREVIEWS');

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);

        const normalized = origin.trim().replace(/\/+$/, '');
        const isAllowed =
            configuredOrigins.includes(normalized) ||
            (allowVercelPreviews && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(normalized));

        if (isAllowed) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-cron-secret'],
    credentials: true
}));

// ─── Body Parser ───
app.use(express.json({ limit: '10mb' }));

// ─── Rate Limiting ───
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 80,
    message: { success: false, error: 'Too many requests. Try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false
});

const toolLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 35,
    message: { success: false, error: 'Tool limit reached. Upgrade to Pro for unlimited.' },
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/api/tool/', toolLimiter);
app.use('/api/agent/', toolLimiter);
app.use('/api/', globalLimiter);

// ─── Routes mount karo ───
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const toolRoutes = require('./routes/tools');
const agentRoutes = require('./routes/agents');
const taskRoutes = require('./routes/tasks');
const subscriptionRoutes = require('./routes/subscriptions');
const clientRoutes = require('./routes/client');
const captureRoutes = require('./routes/capture');

app.use('/', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/tool', toolRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api', subscriptionRoutes);
app.use('/api/client', clientRoutes);
app.use('/api', captureRoutes);

// ─── Internal: Cron Automation ───
app.post('/api/internal/run-automation', verifyCronSecret, async (req, res) => {
    logger.info('Cron automation triggered');
    const result = await runDueTasks(12);
    if (!result.success) return err(res, result.error || 'Automation failed', 500);
    ok(res, { success: true, processed: result.processed, succeeded: result.succeeded });
});

// ─── 404 ───
app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// ─── Global Error Handler ───
app.use((error, req, res, next) => {
    logger.error('Unhandled error:', error.message, '\nStack:', error.stack);
    res.status(500).json({ success: false, error: 'Internal server error' });
});

// ─── Render ke liye server start ───
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
    logger.info(`PilotStaff API running on port ${PORT}`);
    logger.info(`Gemini: ${GEMINI_KEY ? '✅' : '❌'} | Groq: ${GROQ_KEY ? '✅' : '❌'}`);
    logger.info(`CORS origins:`, configuredOrigins);
});

// ─── Graceful Shutdown ───
const shutdown = (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
    });
    setTimeout(() => {
        logger.warn('Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
