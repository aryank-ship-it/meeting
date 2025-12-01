const nodemailer = require('nodemailer');
const { google } = require('googleapis');
// Optionally re-use the OAuth client from googleClient
let googleClientOAuth2 = null;
try {
  googleClientOAuth2 = require('../googleClient').oauth2Client;
} catch (err) {
  // ignore if not available
}

let transporter = null;

function createTransporter() {
  if (transporter) return transporter;
  // Primary: EMAIL_USER/EMAIL_PASS env vars
  const user = process.env.EMAIL_USER || process.env.GMAIL_USER;
  const appPass = process.env.EMAIL_PASS || process.env.GMAIL_APP_PASSWORD;
  // Optional Gmail OAuth credentials
  const oauthClientId = process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GMAIL_OAUTH_CLIENT_ID;
  const oauthClientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET || process.env.GMAIL_OAUTH_CLIENT_SECRET;
  const oauthRefreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN || process.env.GMAIL_OAUTH_REFRESH_TOKEN;

  // Prefer SMTP password transport if set (simpler to configure)
  if (user && appPass) {
    console.log('createTransporter: Using SMTP transport (EMAIL_USER).');
    const smtpHost = process.env.EMAIL_SMTP_HOST || null;
    const smtpPort = process.env.EMAIL_SMTP_PORT ? parseInt(process.env.EMAIL_SMTP_PORT, 10) : null;
    const smtpSecure = process.env.EMAIL_SMTP_SECURE === 'true';
    if (smtpHost) {
      transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort || 587,
        secure: smtpSecure || false,
        auth: { user, pass: appPass },
      });
    } else {
      transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass: appPass },
      });
    }
    return transporter;
  }

  if (oauthClientId && oauthClientSecret && oauthRefreshToken && user) {
    console.log('createTransporter: Using OAuth2 transport (Gmail).');
    // OAuth2 transporter
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user,
        clientId: oauthClientId,
        clientSecret: oauthClientSecret,
        refreshToken: oauthRefreshToken,
        // accessToken will be fetched dynamically if needed
      },
      
    });
    return transporter;
  }

  if (user && appPass) {
    console.log('createTransporter: Using SMTP transport (EMAIL_USER).');
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user,
        pass: appPass,
      },
    });
    return transporter;
  }

  throw new Error('Missing email configuration. Set EMAIL_USER and EMAIL_PASS or GMAIL OAuth env vars and GMAIL_USER.');
}

async function verifyTransporter() {
  const t = createTransporter();
  try {
    await t.verify();
    console.log('Nodemailer transporter verified.');
  } catch (err) {
    console.warn('Failed to verify transporter:', err.message || err);
  }
}

async function sendMail(to, subject, html) {
  const t = createTransporter();
  const from = process.env.EMAIL_USER || process.env.GMAIL_USER || 'no-reply@example.com';
  // Allow `to` to be a string or array of emails
  const normalizedTo = Array.isArray(to) ? to.join(',') : to;
  const mailOptions = {
    from,
    to: normalizedTo,
    subject,
    html,
  };

  console.log(`sendMail: Sending email to ${normalizedTo} with subject: ${subject}`);
  try {
    // If transporter uses OAuth2 and we have google oauth client with refresh token, set accessToken dynamically
    if (googleClientOAuth2 && googleClientOAuth2.credentials && googleClientOAuth2.credentials.refresh_token) {
      try {
        const accessTokenObj = await googleClientOAuth2.getAccessToken();
        const accessTokenStr = typeof accessTokenObj === 'string' ? accessTokenObj : (accessTokenObj && accessTokenObj.token) ? accessTokenObj.token : null;
        if (accessTokenStr) {
          // Provide the accessToken to transporter
          t.options = t.options || {};
          t.options.auth = t.options.auth || {};
          t.options.auth.type = 'OAuth2';
          t.options.auth.accessToken = accessTokenStr;
          console.log('sendMail: Injected access token from googleClient oauth2Client for transport.');
        }
      } catch (err) {
        console.warn('sendMail: Failed to refresh accessToken using googleClient oauth2Client:', err && err.message ? err.message : err);
      }
    }
    const info = await t.sendMail(mailOptions);
    console.log(`sendMail: Email sent to ${normalizedTo}, messageId: ${info.messageId || info.messageId}`);
    return info;
  } catch (err) {
    console.error(`sendMail: Failed to send email to ${to}:`, err && err.message ? err.message : err);
    throw err;
  }
}

module.exports = { createTransporter, verifyTransporter, sendMail };
