import express from 'express';
import { getAuditLog } from '../controllers/auditLogController.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// Admin only. A Manager can add and re-role Staff/Viewer members, but
// reviewing who did what across the whole household is a separate privilege.
router.get('/', authorizeRoles('Admin'), getAuditLog);

export default router;
