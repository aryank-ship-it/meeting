const mongoose = require('mongoose');

const MeetingSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String },
  message: { type: String },
  attendees: { type: [String], default: [] },
  companyName: { type: String },
  industries: { type: String },
  jobTitles: { type: String },
  priority: { type: String },
  monthlyContacts: { type: String },
  start: { type: Date, required: true },
  end: { type: Date, required: true },
  timeZone: { type: String, default: 'Asia/Kolkata' },
  hangoutLink: { type: String },
  htmlLink: { type: String },
  eventId: { type: String },
  status: { type: String, enum: ['scheduled', 'cancelled'], default: 'scheduled' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Meeting', MeetingSchema);
