const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

async function verifyAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const token = auth.split(' ')[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    if (!payload || !payload.adminId) return res.status(401).json({ message: 'Unauthorized' });
    const admin = await Admin.findById(payload.adminId).exec();
    if (!admin) return res.status(401).json({ message: 'Unauthorized' });
    req.admin = admin;
    next();
  } catch (err) {
    console.error('verifyAdmin error', err);
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

module.exports = verifyAdmin;
