const express = require('express');
const jwt = require('jsonwebtoken');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admi123';
const CASHIER_USERNAME = process.env.CASHIER_USERNAME || 'cashier';
const CASHIER_PASSWORD = process.env.CASHIER_PASSWORD || 'cashier123';

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const isAdmin = username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
  const isCashier = username === CASHIER_USERNAME && password === CASHIER_PASSWORD;

  if (!isAdmin && !isCashier) {
    return res.status(401).json({ error: 'Login failed. Check credentials.' });
  }

  const role = isAdmin ? 'admin' : 'cashier';
  const userId = isAdmin ? 1 : 2;

  const token = jwt.sign(
    {
      id: userId,
      username: username,
      role,
    },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  return res.json({
    token,
    user: {
      id: userId,
      username: username,
      role,
    },
  });
});

module.exports = router;
