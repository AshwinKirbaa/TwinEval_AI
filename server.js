require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { testConnection } = require('./src/config/db');
const { validateEnv, allowedOrigins } = require('./src/config/env');
const { verifyToken, csrfOriginGuard } = require('./src/middleware/authMiddleware');
const { serveUpload } = require('./src/middleware/uploadAccess');

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
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
app.use(helmet({
    // Pages use inline scripts/styles and the Font Awesome / Google Fonts CDNs.
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            upgradeInsecureRequests: null
        }
    }
})); // Security Headers
// Credentialed CORS only for the app's own origin(s); same-origin requests
// (the default deployment) never need CORS at all.
app.use(cors({
    credentials: true,
    origin: (origin, callback) => callback(null, !origin || allowedOrigins().has(origin.replace(/\/$/, '')))
}));
app.use(cookieParser());
app.use(csrfOriginGuard); // Cookie auth: reject cross-site state-changing requests
// Default express.json() body limit is 100KB -- a paper with many
// questions, each carrying a full AI-generated answer key (model
// answer, keywords, concepts, rubric, etc), can realistically exceed
// that for larger papers, causing /papers/finalize to be silently
// rejected with a 413 right after a long AI generation run completed
// successfully. Raised generously; this has no effect on AI behavior.
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev')); // HTTP Request Logging

// Serve Frontend Static Files
app.use(express.static(path.join(__dirname, 'public')));
// Uploaded answer sheets, papers and avatars are private: authenticated and
// authorized per file (see src/middleware/uploadAccess.js).
app.use('/uploads', verifyToken, serveUpload);

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
    validateEnv();
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

// Tests import the app without opening a port or touching process signals.
if (require.main === module) {
    startServer();
}

module.exports = app;
module.exports.startServer = startServer;