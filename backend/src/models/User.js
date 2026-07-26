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
    avatar_url: {
      type: String,
      default: null,
      trim: true,
    },
    // Soft-disable flag. Defaults to true so existing documents (and any
    // query that doesn't explicitly filter on it) keep working as before.
    is_active: {
      type: Boolean,
      default: true,
    },
    household_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    email_notifications: {
      type: Boolean,
      default: true,
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
    ret.avatarUrl = ret.avatar_url || null;
    ret.isActive = ret.is_active !== false;
    ret.emailNotifications = ret.email_notifications !== false;
    delete ret._id;
    delete ret.household_id;
    delete ret.avatar_url;
    delete ret.is_active;
    delete ret.email_notifications;
    delete ret.__v;
    delete ret.password_hash;
    return ret;
  },
});

const User = mongoose.model('User', userSchema);

export default User;