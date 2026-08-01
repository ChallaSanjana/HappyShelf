import express from 'express';
import { register, login, getMe, updateMe, forgotPassword, resetPassword } from '../controllers/authController.js';
import { loginLimiter, registerLimiter, passwordResetLimiter } from '../middleware/rateLimiter.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);
// Unauthenticated by necessity: whoever needs these cannot sign in.
router.post('/forgot-password', passwordResetLimiter, forgotPassword);
router.post('/reset-password', passwordResetLimiter, resetPassword);

router.get('/me', authenticateToken, getMe);
router.patch('/me', authenticateToken, updateMe);

export default router;