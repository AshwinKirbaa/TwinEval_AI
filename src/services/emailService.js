const nodemailer = require('nodemailer');

// Test hook: lets the automated tests capture outgoing mail without SMTP.
let transportOverride = null;
function __setTransportForTests(transport) {
    if (process.env.NODE_ENV !== 'test') throw new Error('Transport override is only available when NODE_ENV=test.');
    transportOverride = transport;
}

function getTransporter() {
    if (transportOverride) return transportOverride;
    const { SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
    const smtpHost = process.env.SMTP_HOST || (String(SMTP_USER || '').toLowerCase().endsWith('@gmail.com') ? 'smtp.gmail.com' : '');
    if (!smtpHost || !SMTP_USER || !SMTP_PASS) {
        throw new Error('Email delivery is not configured. Set SMTP_USER and SMTP_PASS, plus SMTP_HOST for non-Gmail providers.');
    }

    return nodemailer.createTransport({
        host: smtpHost,
        port: Number(SMTP_PORT || 587),
        secure: String(SMTP_SECURE || '').toLowerCase() === 'true',
        auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
}

function isConfigured() {
    if (transportOverride) return true;
    const user = String(process.env.SMTP_USER || '').toLowerCase();
    return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS && (process.env.SMTP_HOST || user.endsWith('@gmail.com')));
}

async function sendVerificationEmail({ to, name, token, request }) {
    const baseUrl = (process.env.PUBLIC_APP_URL || `${request.protocol}://${request.get('host')}`).replace(/\/$/, '');
    const verificationUrl = `${baseUrl}/verify-email.html?token=${encodeURIComponent(token)}`;
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;

    await getTransporter().sendMail({
        from,
        to,
        subject: 'Verify your TwinEval AI account',
        text: `Hi ${name},\n\nVerify your TwinEval AI account by opening this link:\n${verificationUrl}\n\nThis link expires in 24 hours. If you did not create this account, you can ignore this email.`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#3d3c43"><h2>Verify your TwinEval AI account</h2><p>Hi ${escapeHtml(name)},</p><p>Click the button below to verify your email address and activate your account.</p><p><a href="${verificationUrl}" style="display:inline-block;padding:12px 18px;background:#6c5dbb;color:#fff;text-decoration:none;border-radius:8px">Verify email address</a></p><p>This link expires in 24 hours. If you did not create this account, you can ignore this email.</p></div>`
    });
}

function getBaseUrl(request) {
    return (process.env.PUBLIC_APP_URL || `${request.protocol}://${request.get('host')}`).replace(/\/$/, '');
}

async function sendPasswordResetEmail({ to, name, token, request }) {
    const resetUrl = `${getBaseUrl(request)}/reset-password.html#token=${encodeURIComponent(token)}`;
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    await getTransporter().sendMail({
        from,
        to,
        subject: 'Reset your TwinEval AI password',
        text: `Hi ${name},\n\nWe received a request to reset your TwinEval AI password. Open this link to choose a new one:\n${resetUrl}\n\nThis link expires in 1 hour and can be used once. If you did not request this, you can ignore this email - your password will not change.`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937"><h2>Reset your password</h2><p>Hi ${escapeHtml(name)},</p><p>We received a request to reset your TwinEval AI password. Click the button below to choose a new one.</p><p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px">Reset password</a></p><p>This link expires in 1 hour and can be used once. If you did not request this, you can ignore this email - your password will not change.</p></div>`
    });
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, isConfigured, __setTransportForTests };
