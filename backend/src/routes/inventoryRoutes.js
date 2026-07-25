import express from 'express';
import {
  getItems,
  createItem,
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

const router = express.Router();

router.use(authenticateToken);

router.get('/items', getItems);
router.post('/items', authorizeRoles('Admin', 'Manager', 'Staff'), createItem);
router.put('/items/:id', authorizeRoles('Admin', 'Manager', 'Staff'), updateItem);
router.patch('/items/:id/reorder', authorizeRoles('Admin', 'Manager', 'Staff'), reorderItem);
router.patch('/items/:id/consume', authorizeRoles('Admin', 'Manager', 'Staff'), consumeItem);
router.delete('/items/:id', authorizeRoles('Admin', 'Manager', 'Staff'), deleteItem);
router.get('/reorder-history', getReorderHistory);
router.get('/consumption-history', getConsumptionHistory);
router.get('/stats', getStats);
router.get('/predictions', getPredictions);

export default router;