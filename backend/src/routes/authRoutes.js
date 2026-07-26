import express from 'express';
import { register, login, getMe, updateMe } from '../controllers/authController.js';
import { loginLimiter, registerLimiter } from '../middleware/rateLimiter.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);
router.get('/me', authenticateToken, getMe);
router.patch('/me', authenticateToken, updateMe);

export default router;