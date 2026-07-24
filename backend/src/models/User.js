import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password_hash: {
      type: String,
      required: true,
      // Without `select: false`, User.findOne({ email }) returns the hash by
      // default and authController's `.select('+password_hash')` calls are
      // no-ops. toJSON() strips it before responses go out, but that only
      // protects document methods — a future `.lean()` query would bypass
      // toJSON entirely and could leak the hash. Excluding it here means it
      // has to be explicitly opted into, which is the safer default.
      select: false,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'users',
  }
);

// Virtual for user ID as string
userSchema.virtual('id').get(function () {
  return this._id.toString();
});

// Ensure virtuals are included in JSON
userSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.password_hash;
    return ret;
  },
});

const User = mongoose.model('User', userSchema);

export default User;