// Load environment variables from .env (if present)
require('dotenv').config();

// Simple Node.js version check — must run before requiring dependencies that might use newer Node
const [majorStr] = process.versions.node.split('.');
const major = Number(majorStr);
if (Number.isInteger(major) && major < 14) {
  console.error(`Node.js v${process.versions.node} detected — this project requires Node >= 14. Please upgrade Node and try again.`);
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const { sendMail, verifyTransporter } = require('./utils/sendMail');
const {
  oauth2Client,
  getAuthUrl,
  exchangeCodeForTokens,
  createGoogleMeeting,
  loadTokensFromFile,
  hasSavedTokens,
  getSavedTokenInfo,
  clearSavedTokens,
} = require('./googleClient');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());

app.use(express.json());
app.use(express.static('public'));

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.RECEIVER_EMAIL || 'aryan.k@sarv.com' ;
const GMAIL_USER = process.env.GMAIL_USER || 'your-gmail@example.com';

// Verify transporter during startup (non-blocking)
verifyTransporter().catch((err) => {
  console.warn('Warning: transporter verify returned an error:', err && err.message ? err.message : err);
});

app.post('/send-mail', async (req, res) => {
  try {
    const { name, email, phone, message, meetingDate, meetingTime, attendees: incomingAttendees, companyName, industries, jobTitles, priority, monthlyContacts } = req.body || {};

    
    if (!name || !email || !meetingDate || !meetingTime || !message) {
      return res.status(400).json({ message: 'Name, email, meetingDate, meetingTime and message are required.' });
    }

    // Fetch settings to compute start & end times and sendUpdates for Google event
    const Settings = require('./models/Settings');
    const settingsDoc = (await Settings.findOne({}).exec()) || {};
    const defaultDurationMinutes = settingsDoc.defaultDurationMinutes || 30;
    const shouldSendInvites = !!settingsDoc.sendInvitesToAttendees;

    // compute start & end times for Google Calendar event
    const tz = 'Asia/Kolkata';
    let start, end;
    try {
      start = new Date(`${meetingDate}T${meetingTime}:00`);
      if (isNaN(start.getTime())) throw new Error('Invalid date/time');
      end = new Date(start.getTime() + (defaultDurationMinutes * 60 * 1000));
    } catch (err) {
      const now = new Date();
      start = new Date(now.getTime() + 60 * 60 * 1000);
      end = new Date(start.getTime() + (defaultDurationMinutes * 60 * 1000));
    }

    // Attempt to create a Google Calendar event (with Google Meet link)
    try {
      // Include user and any guest attendees (if provided) as attendees for the Google Calendar event
      const attendees = (Array.isArray(incomingAttendees) && incomingAttendees.length)
        ? Array.from(new Set([email, ...incomingAttendees].filter(Boolean))).map(e => ({ email: e }))
        : [{ email }];
      const sendUpdates = shouldSendInvites ? 'all' : 'none';
      const meeting = await createGoogleMeeting({ name, email, phone, message, startTime: start, endTime: end, attendees, sendUpdates });
      console.log('Google Meeting created with link:', meeting.hangoutLink);

      // Format times nicely
      const startFormatted = start.toLocaleString('en-IN', { timeZone: tz });
      const endFormatted = end.toLocaleString('en-IN', { timeZone: tz });

      // Prepare email content
      const userSubject = 'Your Meeting Is Scheduled';
      const userHtml = require('./utils/emailTemplates').meetingNotification({ name, email, startFormatted, endFormatted, tz, meetLink: meeting.hangoutLink, message, recipients: [email] });

      const adminSubject = 'New Meeting Scheduled';
      const adminHtml = `
        <h2>New Meeting Scheduled</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone || '(not provided)'}</p>
        <p><strong>Time:</strong> ${startFormatted} - ${endFormatted} (${tz})</p>
        <p><strong>Message:</strong><br/>${message}</p>
        <p><strong>Google Meet:</strong> <a href="${meeting.hangoutLink}" target="_blank">${meeting.hangoutLink}</a></p>
        <p>Calendar Event: <a href="${meeting.htmlLink}" target="_blank">Open Event</a></p>
        <p><em>Sent to admin + team members</em></p>
      `;

      // Persist meeting information in DB
      try {
        const MeetingModel = require('./models/Meeting');
        const meetingDoc = await MeetingModel.create({
          name,
          email,
          phone,
          message,
          attendees: attendees.map(a => a.email || a),
          companyName: companyName || undefined,
          industries: (industries || undefined),
          jobTitles: (jobTitles || undefined),
          priority: (priority || undefined),
          monthlyContacts: (monthlyContacts || undefined),
          start,
          end,
          timeZone: tz,
          hangoutLink: meeting.hangoutLink,
          htmlLink: meeting.htmlLink,
          eventId: meeting.eventId || meeting.id,
        });
        console.log('Meeting saved to DB:', meetingDoc._id);
      } catch (saveErr) {
        console.error('Failed to save meeting to DB:', saveErr && saveErr.message ? saveErr.message : saveErr);
      }
      // Prepare recipients: user, admin and all team members
      try {
        const TeamMember = require('./models/TeamMember');
        const members = await TeamMember.find({}).lean().exec();
        const memberEmails = members.filter(m => m && m.email).map(m => m.email);
        // Also dedupe with attendees (guests) to avoid double sends
        const guestEmails = (Array.isArray(incomingAttendees) ? incomingAttendees : []).filter(Boolean);
        const recipients = Array.from(new Set([email, ADMIN_EMAIL, ...memberEmails, ...guestEmails].filter(Boolean)));

        // Build a composite HTML that mentions that the message was sent to admin + team members
        const recipientsHtml = `<p><strong>Recipients:</strong> ${recipients.join(', ')}</p><p><em>Note: this event was also added to Google Calendar</em></p>`;
        const sharedHtml = require('./utils/emailTemplates').meetingNotification({ name, email, startFormatted, endFormatted, tz, meetLink: meeting.hangoutLink, message, recipients });

        // Send a single email to all recipients (user + admin + members)
        try {
          await sendMail(recipients, `Meeting Scheduled — ${name}`, sharedHtml);
          console.log('Emails sent to user, admin, and team members:', recipients.join(','));
        } catch (err) {
          console.error('Failed to send notifications to recipients:', err && err.message ? err.message : err);
        }
      } catch (err) {
        console.error('Failed to fetch/send to team members:', err && err.message ? err.message : err);
      }

      return res.json({
        success: true,
        message: 'Meeting scheduled. Emails sent to user, admin, and team members.',
        meetLink: meeting.hangoutLink,
        eventLink: meeting.htmlLink,
        adminEmail: ADMIN_EMAIL,
        start: startFormatted,
        end: endFormatted,
      });
    } catch (err) {
      console.warn('Failed to create Google Meeting:', err.message || err);
      // If meeting creation fails, still return success for email and notify admin via email
      const adminFallbackSubject = 'New Meeting Booking (Calendar not created)';
      const adminFallbackHtml = `
        <h2>New Meeting Request (Calendar not created)</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone || '(not provided)'}</p>
        <p><strong>Message:</strong><br/>${message}</p>
        <p><strong>Selected Time:</strong> ${meetingDate} ${meetingTime}</p>
      `;
      // Persist meeting even when we couldn't create the event
      try {
        const MeetingModel = require('./models/Meeting');
        const meetingDoc = await MeetingModel.create({
          name,
          email,
          phone,
          message,
          attendees: (Array.isArray(incomingAttendees) ? incomingAttendees : []).filter(Boolean),
          companyName: companyName || undefined,
          industries: (industries || undefined),
          jobTitles: (jobTitles || undefined),
          priority: (priority || undefined),
          monthlyContacts: (monthlyContacts || undefined),
          start,
          end,
          timeZone: tz,
          status: 'scheduled'
        });
        console.log('Fallback meeting saved to DB:', meetingDoc._id);
      } catch (saveErr) {
        console.error('Failed to save fallback meeting to DB:', saveErr && saveErr.message ? saveErr.message : saveErr);
      }

      try {
        // Also fetch team members so admin + team members are notified about the fallback
        const TeamMember = require('./models/TeamMember');
        const members = await TeamMember.find({}).lean().exec();
        const memberEmails = members.filter(m => m && m.email).map(m => m.email);
        const recipients = Array.from(new Set([ADMIN_EMAIL, ...memberEmails].filter(Boolean)));
        try {
          const recipientsHtml = `<p><strong>Recipients:</strong> ${recipients.join(', ')}</p>`;
          await sendMail(recipients, adminFallbackSubject, adminFallbackHtml + recipientsHtml);
        } catch (sendErr) {
          console.error('Failed to send fallback admin/team email:', sendErr && sendErr.message ? sendErr.message : sendErr);
        }
      } catch (err) {
        console.error('Failed to fetch team members for fallback:', err && err.message ? err.message : err);
      }

      // Also notify the user even when Google Calendar event could not be created
      try {
        const userFallbackSubject = 'Your Meeting Request — Pending Calendar Confirmation';
        const userFallbackHtml = `<p>Hi ${name},</p>
          <p>Thanks for requesting a meeting. We were unable to automatically create a Google Calendar event for your selected time due to a technical issue.</p>
          <p>Your requested time: <strong>${start.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</strong></p>
          <p>An admin will reach out shortly to confirm the scheduling.</p>
          <p>Thanks,</p>
          <p>Your Team</p>`;
        await sendMail(email, userFallbackSubject, userFallbackHtml);
      } catch (userErr) {
        console.error('Failed to send fallback user email:', userErr && userErr.message ? userErr.message : userErr);
      }
      return res.json({ success: true, message: 'Meeting request sent successfully! (Calendar not linked)', adminEmail: ADMIN_EMAIL, start: start.toISOString(), end: end.toISOString() });
    }
  } catch (err) {
    console.error('Failed to send email:', err);
    return res.status(500).json({ message: 'Failed to send email.' });
  }
});


app.get('/', (req, res) => {
  res.json({ message: 'Meeting booking backend is running.' });
});

// Status endpoint to check whether a Google account is linked and token details
app.get('/status', (req, res) => {
  try {
    const savedInfo = getSavedTokenInfo();
    // Build stable response
    const googleLinked = savedInfo.hasTokens;
    const details = {
      googleLinked,
      hasAccessToken: !!savedInfo.hasAccessToken,
      hasRefreshToken: !!savedInfo.hasRefreshToken,
      expiryDate: savedInfo.expiryDate || null,
    };
    return res.json(details);
  } catch (err) {
    return res.json({ googleLinked: false, error: err.message });
  }
});

// Test mail endpoint — helpful for debugging email configuration
app.get('/test-mail', async (req, res) => {
  try {
    const to = req.query.to || ADMIN_EMAIL;
    const subject = req.query.subject || 'Test email from meeting booking app';
    const html = req.query.html || '<p>This is a test email. If you received it, SMTP is configured.</p>';
    try {
      // Also return debug info: transporter method currently selected
      const debugInfo = {
        usingEmailUser: Boolean(process.env.EMAIL_USER || process.env.GMAIL_USER),
        hasAppPass: Boolean(process.env.EMAIL_PASS || process.env.GMAIL_APP_PASSWORD),
        hasOauth: Boolean(process.env.GMAIL_OAUTH_CLIENT_ID && process.env.GMAIL_OAUTH_CLIENT_SECRET && process.env.GMAIL_OAUTH_REFRESH_TOKEN),
      };
      const info = await sendMail(to, subject, html);
      return res.json({ success: true, message: 'Test email queued', info, debugInfo });
    } catch (err) {
      console.error('Test mail failed:', err && err.message ? err.message : err);
      return res.status(500).json({ success: false, message: 'Failed to send test email', error: err && err.message ? err.message : err });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Internal server error', error: err && err.message ? err.message : err });
  }
});

// Admin diagnostics - shows DB, Google, and transporter status
app.get('/admin/diagnostics', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const transportInfo = {
      usingEmailUser: Boolean(process.env.EMAIL_USER || process.env.GMAIL_USER),
      hasAppPass: Boolean(process.env.EMAIL_PASS || process.env.GMAIL_APP_PASSWORD),
      hasOauthEnv: Boolean(process.env.GMAIL_OAUTH_CLIENT_ID && process.env.GMAIL_OAUTH_CLIENT_SECRET && process.env.GMAIL_OAUTH_REFRESH_TOKEN),
    };
    const dbStateMap = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
    const dbStatus = dbStateMap[mongoose.connection.readyState] || 'unknown';
    const googleLinkedInfo = require('./googleClient').getSavedTokenInfo();
    return res.json({ dbStatus, transportInfo, googleLinked: googleLinkedInfo });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : err });
  }
});

// Google OAuth auth route - redirects to consent screen
app.get('/auth', (req, res) => {
  // Check that Google OAuth client credentials are configured
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).send('Missing Google OAuth credentials (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET). Please set them and restart the server.');
  }
  const authUrl = getAuthUrl();
  console.log('Redirecting to Google OAuth consent screen:', authUrl);
  return res.redirect(authUrl);
});

// OAuth2 callback - exchange code and store tokens
app.get('/oauth2callback', async (req, res) => {
  try {
    const code = req.query.code;
    console.log('Received /oauth2callback - code:', code ? `${code.substring(0, 8)}...` : '(none)');
    if (!code) return res.status(400).send('Missing code');
    await exchangeCodeForTokens(code);
    console.log('OAuth flow completed; tokens saved to disk.');
    return res.send('Google Calendar linked successfully!');
  } catch (err) {
    console.error('OAuth2 callback error:', err);
    return res.status(500).send('Failed to exchange code for tokens.');
  }
});

// Revoke saved tokens and clear credentials (server-side only) — useful to force re-authorize
app.get('/revoke', async (req, res) => {
  try {
    // Best-effort: If a refresh_token exists, call revoke on refresh_token
    try {
      if (oauth2Client.credentials.refresh_token) {
        await oauth2Client.revokeCredentials();
        console.log('OAuth credentials revoked via API');
      }
    } catch (err) {
      console.warn('Warning: revoke via API failed:', err && err.message ? err.message : err);
    }
    // Clear saved tokens file
    clearSavedTokens();
    return res.send('Google tokens removed. You can re-link via /auth');
  } catch (err) {
    console.error('Failed to revoke tokens:', err);
    return res.status(500).send('Failed to revoke tokens');
  }
});

// Load any saved tokens (this sets oauth2Client credentials if a tokens file exists)
loadTokensFromFile();

// Connect to MongoDB
const mongoose = require('mongoose');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/booking';
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true }).then(() => {
  console.log('Connected to MongoDB');
  // Create initial admin from env if none exists
  (async () => {
    try {
      const Admin = require('./models/Admin');
      const Settings = require('./models/Settings');
      const adminCount = await Admin.countDocuments().exec();
      const adminEmailEnv = process.env.ADMIN_EMAIL;
      const adminPassEnv = process.env.ADMIN_PASS || process.env.ADMIN_PASSWORD;
      if (adminCount === 0) {
        if (adminEmailEnv && adminPassEnv) {
          const pwHash = await Admin.hashPassword(adminPassEnv);
          await Admin.create({ email: adminEmailEnv, passwordHash: pwHash, name: 'Admin' });
          console.log('Admin user created from ADMIN_EMAIL environment variable (email hidden for security).');
        } else {
          console.log('No admin user found. To auto-create an admin on startup set ADMIN_EMAIL and ADMIN_PASS environment variables.');
        }
      } else {
        console.log('Admin user exists.');
      }
      // Ensure Settings exist and set adminEmail from env if present
      let s = await Settings.findOne({}).exec();
      if (!s) {
        s = await Settings.create({ adminEmail: adminEmailEnv || process.env.RECEIVER_EMAIL });
        console.log('Settings document created.');
      } else if (adminEmailEnv && s.adminEmail !== adminEmailEnv) {
        s.adminEmail = adminEmailEnv;
        await s.save();
        console.log('Settings adminEmail updated from env var.');
      }
    } catch (err) {
      console.error('Admin/Settings initialization error:', err && err.message ? err.message : err);
    }
  })();
}).catch((err) => {
  console.error('MongoDB connection error', err);
});

// Log whether Google tokens are saved and therefore a Google account is linked
const googleLinked = hasSavedTokens();
console.log('Google account linked:', googleLinked);

const server = app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Close the process using this port or run with a different port by setting the PORT environment variable.`);
    console.error('To find the running process (Linux): lsof -i :5000 -sTCP:LISTEN -P -n');
    console.error('Then kill it: kill <pid> or kill -9 <pid>');
    console.error('Alternatively, run: PORT=5001 node server.js');
    process.exit(1);
  }
  console.error('Server failed with error:', err);
  process.exit(1);
});

// Mount admin routes
const adminRoutes = require('./routes/adminRoutes');
app.use('/admin', adminRoutes);
