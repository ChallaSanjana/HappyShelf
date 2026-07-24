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
      select: false,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ['Admin', 'Manager', 'Staff', 'Viewer'],
      default: 'Admin',
    },
    household_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'users',
  }
);

userSchema.pre('save', function () {
  if (!this.household_id) {
    this.household_id = this._id;
  }
});

// Virtual for user ID as string
userSchema.virtual('id').get(function () {
  return this._id.toString();
});

// Ensure virtuals are included in JSON
userSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    ret.id = ret._id.toString();
    if (ret.household_id) {
      ret.householdId = ret.household_id.toString();
    }
    delete ret._id;
    delete ret.household_id;
    delete ret.__v;
    delete ret.password_hash;
    return ret;
  },
});

const User = mongoose.model('User', userSchema);

export default User;