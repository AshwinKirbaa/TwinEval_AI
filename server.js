require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { testConnection } = require('./src/config/db');
const { assertAuthConfig } = require('./src/config/authConfig');

// Import Routes
const authRoutes = require('./src/routes/authRoutes');
const studentRoutes = require('./src/routes/studentRoutes');
const evaluationRoutes = require('./src/routes/evaluationRoutes');
const learningPlanRoutes = require('./src/routes/learningPlanRoutes');
const analyticsRoutes = require('./src/routes/analyticsRoutes');
const dashboardRoutes = require('./src/routes/dashboardRoutes');
const aiRoutes = require('./src/routes/aiRoutes');
const paperRoutes = require('./src/routes/paperRoutes');
const submissionRoutes = require('./src/routes/submissionRoutes');

// Import Error Handlers
const { notFoundHandler, globalErrorHandler } = require('./src/middleware/errorHandler');

const app = express();

// Express Middleware Configuration
app.use(helmet({ contentSecurityPolicy: false })); // Security Headers
if (process.env.TRUST_PROXY) {
    // e.g. TRUST_PROXY=1 when running behind nginx/Render/Vercel so rate limiting sees the real client IP.
    app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
}
// The frontend is served by this same Express app, so no CORS headers are needed by default.
// Set CORS_ORIGINS (comma-separated) only if a separately hosted frontend must call this API.
const allowedOrigins = String(process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
if (allowedOrigins.length) {
    app.use(cors({ origin: allowedOrigins, credentials: true }));
}
// Default express.json() body limit is 100KB -- a paper with many
// questions, each carrying a full AI-generated answer key (model
// answer, keywords, concepts, rubric, etc), can realistically exceed
// that for larger papers, causing /papers/finalize to be silently
// rejected with a 413 right after a long AI generation run completed
// successfully. Raised generously; this has no effect on AI behavior.
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// HTTP request logging. One-time tokens in URLs (e.g. /auth/verify-email?token=...) are never logged.
morgan.token('safe-url', req => String(req.originalUrl || req.url).split('?')[0]);
app.use(morgan(':method :safe-url :status :response-time ms - :res[content-length]'));

// Serve Frontend Static Files
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        // HTML is never cached, so a signed-out user cannot be shown a stale page via back/forward.
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    }
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Root Status Health Check Endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: '🚀 TwinEval AI Production Backend is Running',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        documentation: 'docs/API_DOCUMENTATION.md',
        timestamp: new Date().toISOString()
    });
});

// API Endpoint Routes
app.use('/auth', authRoutes);
app.use('/students', studentRoutes);
app.use('/evaluations', evaluationRoutes);
app.use('/plans', learningPlanRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/ai', aiRoutes);
app.use('/papers', paperRoutes);
app.use('/submissions', submissionRoutes);

// 404 Route Not Found Middleware
app.use(notFoundHandler);

// Global Error Handler Middleware
app.use(globalErrorHandler);

const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || '0.0.0.0';

// Initialize SQLite database, then start the lightweight central Express server.
// AI/Ollama is intentionally NOT started here: each client computer runs
// its own local AI engine so the central server does not need GPU/CPU-heavy
// model hosting.
const startServer = async () => {
    assertAuthConfig(); // refuses to start in production without a strong JWT_SECRET
    await testConnection();

    app.listen(PORT, HOST, () => {
        console.log(`====================================================`);
        console.log(`🚀 TwinEval AI Server Running on Port ${PORT}`);
        console.log(`🏠 Local: http://localhost:${PORT}`);

        console.log(`🧠 AI: Local on each client computer (Ollama + Python) at http://127.0.0.1:8000`);
        console.log(`🗄️ Database: ${process.env.DB_PATH || './database/twineval.db'}`);
        console.log(`====================================================`);
    });
};

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

if (require.main === module) {
    startServer().catch(error => {
        console.error('❌ Failed to start TwinEval AI:', error.message);
        process.exit(1);
    });
}

module.exports = app;