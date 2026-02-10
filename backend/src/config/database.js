import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/happyshelf';
    
    await mongoose.connect(mongoURI);
    
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    console.log('⚠️  Server will continue without database. Please configure MongoDB:');
    console.log('   Option 1: Install MongoDB locally (https://www.mongodb.com/try/download/community)');
    console.log('   Option 2: Use MongoDB Atlas (https://www.mongodb.com/cloud/atlas)');
    console.log('   Then update MONGODB_URI in backend/.env file\n');
    // Don't exit - let server start without DB for development
  }
};

export default connectDB;
