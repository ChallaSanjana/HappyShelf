import express from 'express';
import {
  getItems,
  createItem,
  bulkCreateItems,
  updateItem,
  deleteItem,
  reorderItem,
  consumeItem,
  getReorderHistory,
  getConsumptionHistory,
  getStats,
  getPredictions,
} from '../controllers/inventoryController.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { expensiveLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/items', getItems);
router.post('/items', authorizeRoles('Admin', 'Manager', 'Staff'), createItem);
// Declared before '/items/:id' routes so "bulk" is never parsed as an id.
router.post('/items/bulk', authorizeRoles('Admin', 'Manager', 'Staff'), expensiveLimiter, bulkCreateItems);
router.put('/items/:id', authorizeRoles('Admin', 'Manager', 'Staff'), updateItem);
router.patch('/items/:id/reorder', authorizeRoles('Admin', 'Manager', 'Staff'), reorderItem);
router.patch('/items/:id/consume', authorizeRoles('Admin', 'Manager', 'Staff'), consumeItem);
router.delete('/items/:id', authorizeRoles('Admin', 'Manager', 'Staff'), deleteItem);
router.get('/reorder-history', getReorderHistory);
router.get('/consumption-history', getConsumptionHistory);
router.get('/stats', getStats);
// Fans out to the Python ML service, so it gets the tighter budget.
router.get('/predictions', expensiveLimiter, getPredictions);

export default router;