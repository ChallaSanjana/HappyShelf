import express from 'express';
import {
    getActionPlans,
    createActionPlan,
    updateActionPlanTask,
    deleteActionPlan,
} from '../controllers/actionPlanController.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/', getActionPlans);
router.post('/', authorizeRoles('Admin', 'Manager', 'Staff'), createActionPlan);
router.patch('/:planId/tasks/:taskId', authorizeRoles('Admin', 'Manager', 'Staff'), updateActionPlanTask);
router.delete('/:planId', authorizeRoles('Admin', 'Manager', 'Staff'), deleteActionPlan);

export default router;