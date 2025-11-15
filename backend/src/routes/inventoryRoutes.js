import express from 'express';
import {
  getItems,
  createItem,
  updateItem,
  deleteItem,
  getStats,
} from '../controllers/inventoryController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/items', getItems);
router.post('/items', createItem);
router.put('/items/:id', updateItem);
router.delete('/items/:id', deleteItem);
router.get('/stats', getStats);

export default router;
