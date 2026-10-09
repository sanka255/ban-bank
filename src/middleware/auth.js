const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * authenticateToken
 * Verifies the Bearer JWT issued by ella_pms (shared JWT_SECRET).
 * Attaches req.user = { id, username, role } from the token payload.
 * Does NOT re-query the PMS DB on each request — JWT is the source of truth.
 */
function authenticateToken(req, res, next) {
  const isWebhook =
    req.path === '/payments/webhook' ||
    req.path === '/payments/mock/webhook' ||
    req.originalUrl?.includes('/payments/webhook') ||
    req.originalUrl?.includes('/payments/mock/webhook');

  if (isWebhook && req.method === 'POST') {
    return next();
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer <token>"

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // ella_pms token payload: { id, username, role, iat, exp }
    req.user = {
      id: payload.id,
      username: payload.username,
      role: payload.role,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
}

/**
 * requireAdmin
 * Must be used after authenticateToken.
 * Restricts the route to users with role === 'admin'.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requireFinancialAccess(req, res, next) {
  if (!req.user || !['admin', 'cashier'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin or cashier access required' });
  }
  next();
}

module.exports = { authenticateToken, requireAdmin, requireFinancialAccess };
