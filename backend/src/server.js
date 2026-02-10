import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/database.js';
import authRoutes from './routes/authRoutes.js';
import inventoryRoutes from './routes/inventoryRoutes.js';

dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/inventory', inventoryRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'HappyShelf API is running' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
