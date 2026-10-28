const nodemailer = require('nodemailer');
const { isProduction } = require('../config/env');

// Messages captured in memory when NODE_ENV=test (never sent, never logged).
const outbox = [];

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

/**
 * True when a message can be handled: real SMTP is configured, or we are in
 * a non-production environment where links are written to the server console.
 */
function canDeliver() {
    return isConfigured() || !isProduction();
}

/**
 * Links in emails use PUBLIC_APP_URL. The request Host header is only trusted
 * as a fallback outside production, to prevent host-header poisoning of
 * password-reset links.
 */
function baseUrl(request) {
    if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL.replace(/\/$/, '');
    if (isProduction()) throw new Error('PUBLIC_APP_URL must be set in production to build email links.');
    return `${request.protocol}://${request.get('host')}`;
}

/**
 * Deliver a message. Returns { delivered, mode }:
 *  - 'smtp'    : handed to the SMTP server
 *  - 'outbox'  : captured in memory (tests)
 *  - 'console' : development fallback, link printed to the server console;
 *                nothing was emailed and callers must not claim otherwise.
 */
async function deliver({ to, subject, text, html, devLabel, link }) {
    if (process.env.NODE_ENV === 'test') {
        outbox.push({ to, subject, text, link });
        return { delivered: false, mode: 'outbox' };
    }
    if (!isConfigured()) {
        if (isProduction()) throw new Error('Email delivery is not configured.');
        console.warn(`[DEV MODE] SMTP is not configured; no email was sent. ${devLabel} for ${to}: ${link}`);
        return { delivered: false, mode: 'console' };
    }
    await getTransporter().sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, html });
    return { delivered: true, mode: 'smtp' };
}

function button(url, label) {
    return `<p><a href="${url}" style="display:inline-block;padding:12px 18px;background:#6c5dbb;color:#fff;text-decoration:none;border-radius:8px">${label}</a></p>`;
}

async function sendVerificationEmail({ to, name, token, request }) {
    const link = `${baseUrl(request)}/verify-email.html?token=${encodeURIComponent(token)}`;
    return deliver({
        to, link, devLabel: 'Verification link',
        subject: 'Verify your TwinEval AI account',
        text: `Hi ${name},\n\nVerify your TwinEval AI account by opening this link:\n${link}\n\nThis link expires in 24 hours. If you did not create this account, you can ignore this email.`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#3d3c43"><h2>Verify your TwinEval AI account</h2><p>Hi ${escapeHtml(name)},</p><p>Click the button below to verify your email address and activate your account.</p>${button(link, 'Verify email address')}<p>This link expires in 24 hours. If you did not create this account, you can ignore this email.</p></div>`
    });
}

async function sendPasswordResetEmail({ to, name, token, request }) {
    const link = `${baseUrl(request)}/reset-password.html?token=${encodeURIComponent(token)}`;
    return deliver({
        to, link, devLabel: 'Password reset link',
        subject: 'Reset your TwinEval AI password',
        text: `Hi ${name},\n\nWe received a request to reset your TwinEval AI password. Open this link to choose a new one:\n${link}\n\nThis link expires in 1 hour and can be used once. If you did not request this, you can ignore this email; your password will not change.`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#3d3c43"><h2>Reset your password</h2><p>Hi ${escapeHtml(name)},</p><p>We received a request to reset your TwinEval AI password.</p>${button(link, 'Choose a new password')}<p>This link expires in 1 hour and can be used once. If you did not request this, you can ignore this email; your password will not change.</p></div>`
    });
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, isConfigured, canDeliver, outbox };
