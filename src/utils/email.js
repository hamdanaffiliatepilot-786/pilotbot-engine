const { env } = require('../config/env');
const logger = require('./logger');

const RESEND_API_KEY = env('RESEND_API_KEY');
const FRONTEND_URL = (env('FRONTEND_URL') || '').replace(/\/+$/, '');
const FROM_EMAIL = 'PilotBot <onboarding@resend.dev>';

async function sendEmail({ to, subject, html }) {
    if (!RESEND_API_KEY) {
        logger.warn('RESEND_API_KEY not set — email skipped');
        return false;
    }

    if (!to || !subject || !html) {
        logger.warn('sendEmail called with missing params');
        return false;
    }

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: FROM_EMAIL,
                to: [to.trim().toLowerCase()],
                subject,
                html,
            }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            logger.error('Resend API error:', data?.message || data?.name || response.status);
            return false;
        }

        logger.info(`Email sent to ${to}, id: ${data.id || 'unknown'}`);
        return true;
    } catch (error) {
        logger.error('Email send failed:', error?.message || error);
        return false;
    }
}

function verificationHtml(token) {
    const link = `${FRONTEND_URL}/verify-email?token=${token}`;

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background:#f4f4f5; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5; padding:40px 16px;">
        <tr>
            <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.08);">
                    <tr>
                        <td style="background:#09090b; padding:32px 32px 24px; text-align:center;">
                            <h1 style="margin:0; color:#ffffff; font-size:22px; font-weight:700;">PilotBot</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:32px;">
                            <p style="margin:0 0 16px; color:#3f3f46; font-size:16px; line-height:1.5;">Verify your email address to get started.</p>
                            <table width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td align="center">
                                        <a href="${link}" style="display:inline-block; background:#09090b; color:#ffffff; text-decoration:none; padding:12px 32px; border-radius:8px; font-size:15px; font-weight:600;">
                                            Verify Email
                                        </a>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin:24px 0 0; color:#71717a; font-size:13px; line-height:1.5;">
                                This link expires in 24 hours. If you didn't create an account, ignore this email.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:16px 32px; border-top:1px solid #e4e4e7; text-align:center;">
                            <p style="margin:0; color:#a1a1aa; font-size:12px;">PilotBot Engine</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

function resetPasswordHtml(token) {
    const link = `${FRONTEND_URL}/reset-password?token=${token}`;

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background:#f4f4f5; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5; padding:40px 16px;">
        <tr>
            <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.08);">
                    <tr>
                        <td style="background:#09090b; padding:32px 32px 24px; text-align:center;">
                            <h1 style="margin:0; color:#ffffff; font-size:22px; font-weight:700;">PilotBot</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:32px;">
                            <p style="margin:0 0 16px; color:#3f3f46; font-size:16px; line-height:1.5;">You requested a password reset. Click the button below to set a new password.</p>
                            <table width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td align="center">
                                        <a href="${link}" style="display:inline-block; background:#09090b; color:#ffffff; text-decoration:none; padding:12px 32px; border-radius:8px; font-size:15px; font-weight:600;">
                                            Reset Password
                                        </a>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin:24px 0 0; color:#71717a; font-size:13px; line-height:1.5;">
                                This link expires in 1 hour. If you didn't request this, ignore this email — your password is safe.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:16px 32px; border-top:1px solid #e4e4e7; text-align:center;">
                            <p style="margin:0; color:#a1a1aa; font-size:12px;">PilotBot Engine</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

async function sendVerificationEmail(email, token) {
    return sendEmail({
        to: email,
        subject: 'Verify your email — PilotBot',
        html: verificationHtml(token),
    });
}

async function sendResetEmail(email, token) {
    return sendEmail({
        to: email,
        subject: 'Reset your password — PilotBot',
        html: resetPasswordHtml(token),
    });
}

module.exports = { sendVerificationEmail, sendResetEmail };
