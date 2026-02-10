import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    daily_usage: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    expiry_date: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'inventory_items',
  }
);

// Virtual for item ID as string
itemSchema.virtual('id').get(function () {
  return this._id.toString();
});

// Ensure virtuals are included in JSON
itemSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    ret.id = ret._id.toString();
    ret.user_id = ret.user_id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

const Item = mongoose.model('Item', itemSchema);

export default Item;
