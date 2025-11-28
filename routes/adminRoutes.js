const express = require('express');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const Meeting = require('../models/Meeting');
const Settings = require('../models/Settings');
const verifyAdmin = require('../middleware/authAdmin');
const { sendMail } = require('../utils/sendMail');
const { oauth2Client, loadTokensFromFile } = require('../googleClient');
const { google } = require('googleapis');

const router = express.Router();

// POST /admin/login
router.post('/login', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Service unavailable: Database is not connected' });
    }
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ message: 'Missing credentials' });
    const admin = await Admin.findOne({ email }).exec();
    if (!admin) return res.status(401).json({ message: 'Invalid credentials' });
    const valid = await admin.comparePassword(password);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });
    const token = jwt.sign({ adminId: admin._id }, process.env.JWT_SECRET || 'secret', { expiresIn: '12h' });
    return res.json({ token, admin: { email: admin.email, name: admin.name } });
  } catch (err) {
    console.error('Admin login error', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Use verifyAdmin for following
router.use(verifyAdmin);

// GET /admin/profile
router.get('/profile', async (req, res) => {
  const admin = req.admin;
  return res.json({ email: admin.email, name: admin.name, createdAt: admin.createdAt });
});

// PUT /admin/update-email
router.put('/update-email', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ message: 'Missing email' });
    req.admin.email = email;
    await req.admin.save();
    return res.json({ success: true, message: 'Email updated', email: req.admin.email });
  } catch (err) {
    console.error('Update email error', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// PUT /admin/update-password
router.put('/update-password', async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) return res.status(400).json({ message: 'Missing password info' });
    const ok = await req.admin.comparePassword(oldPassword);
    if (!ok) return res.status(401).json({ message: 'Invalid old password' });
    req.admin.passwordHash = await Admin.hashPassword(newPassword);
    await req.admin.save();
    return res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    console.error('Update password error', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /admin/settings
router.get('/settings', async (req, res) => {
  try {
    let s = await Settings.findOne({}).exec();
    if (!s) {
      s = await Settings.create({ adminEmail: process.env.ADMIN_EMAIL });
    }
    return res.json(s);
  } catch (err) {
    console.error('Settings get error', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// PUT /admin/settings
router.put('/settings', async (req, res) => {
  try {
    const updates = req.body || {};
    let s = await Settings.findOne({}).exec();
    if (!s) s = new Settings({});
    Object.assign(s, updates);
    await s.save();
    return res.json({ success: true, message: 'Settings saved', settings: s });
  } catch (err) {
    console.error('Settings update error', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /admin/meetings
router.get('/meetings', async (req, res) => {
  try {
    const { search, startDate, endDate, status } = req.query || {};
    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }
    if (status) filter.status = status;
    if (startDate || endDate) {
      filter.start = {};
      if (startDate) filter.start.$gte = new Date(startDate);
      if (endDate) filter.start.$lte = new Date(endDate);
    }
    const meetings = await Meeting.find(filter).sort({ start: 1 }).exec();
    return res.json({ meetings });
  } catch (err) {
    console.error('Meetings list error', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /admin/delete-meeting/:id
router.delete('/delete-meeting/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const meeting = await Meeting.findById(id);
    if (!meeting) return res.status(404).json({ message: 'Not found' });
    // Delete calendar event if exists
    if (meeting.eventId) {
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      try {
        await calendar.events.delete({ calendarId: 'primary', eventId: meeting.eventId });
      } catch (err) {
        console.warn('Failed to delete calendar event:', err && err.message ? err.message : err);
      }
    }
    await meeting.remove();
    return res.json({ success: true, message: 'Meeting deleted' });
  } catch (err) {
    console.error('Delete meeting error', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST /admin/cancel-meeting/:id
router.post('/cancel-meeting/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const meeting = await Meeting.findById(id);
    if (!meeting) return res.status(404).json({ message: 'Not found' });
    if (meeting.eventId) {
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      try {
        await calendar.events.delete({ calendarId: 'primary', eventId: meeting.eventId });
      } catch (err) {
        console.warn('Failed to delete calendar event on cancel:', err && err.message ? err.message : err);
      }
    }
    meeting.status = 'cancelled';
    await meeting.save();
    // Send cancellation email to user
    const subject = 'Your Meeting Has Been Cancelled';
    const html = `<p>Hi ${meeting.name},</p><p>Your meeting scheduled for ${meeting.start} has been cancelled.</p>`;
    try {
      await sendMail(meeting.email, subject, html);
    } catch (err) {
      console.error('Failed to send cancellation email:', err && err.message ? err.message : err);
    }
    return res.json({ success: true, message: 'Meeting cancelled' });
  } catch (err) {
    console.error('Cancel meeting error', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
