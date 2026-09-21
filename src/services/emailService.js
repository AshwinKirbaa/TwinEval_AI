const nodemailer = require('nodemailer');

function getTransporter() {
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

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

module.exports = { sendVerificationEmail, isConfigured };
