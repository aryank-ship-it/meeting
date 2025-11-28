const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  adminEmail: { type: String },
  defaultDurationMinutes: { type: Number, default: 30 },
  emailTransport: {
    service: { type: String },
    user: { type: String },
    pass: { type: String },
    oauth: {
      clientId: { type: String },
      clientSecret: { type: String },
      refreshToken: { type: String },
    },
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Settings', SettingsSchema);
