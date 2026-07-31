import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const connectDB = async () => {
  const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/happyshelf';

  // Mongoose waits 30s by default before giving up on server selection, so an
  // unreachable database meant 30s of silence before the process either fell
  // back to the in-memory store or (in production) exited — 30s during which
  // a supervisor has no idea the start failed. Still generous enough to ride
  // out a replica-set election.
  const serverSelectionTimeoutMS = Number(process.env.MONGO_TIMEOUT_MS) || 10000;

  try {
    await mongoose.connect(mongoURI, { serverSelectionTimeoutMS });
    console.log('✅ MongoDB connected successfully');
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);

    // In production the in-memory fallback is actively dangerous, not
    // convenient: the server would come up looking healthy, accept
    // registrations and inventory writes into a plain Map, and lose all of
    // it on the next restart — with no signal to the user that their data
    // was never persisted. A failed DB connection in production is a
    // startup failure, so exit and let the supervisor restart/alert.
    if (process.env.NODE_ENV === 'production') {
      console.error('   Refusing to start in production without a database.');
      console.error('   Check MONGODB_URI and that the database is reachable.');
      process.exit(1);
    }

    console.log('⚠️  Server will continue with an IN-MEMORY store (development only).');
    console.log('   Data will NOT survive a restart. To use a real database:');
    console.log('   Option 1: Install MongoDB locally (https://www.mongodb.com/try/download/community)');
    console.log('   Option 2: Use MongoDB Atlas (https://www.mongodb.com/cloud/atlas)');
    console.log('   Then update MONGODB_URI in backend/.env file\n');
    return false;
  }
};

export default connectDB;
