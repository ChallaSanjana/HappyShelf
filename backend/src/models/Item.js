import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema(
  {
    // The household this item belongs to, not an individual user. It was
    // named user_id while it already held a household id, which invited
    // exactly the kind of scoping mistake that leaks data between
    // households. Existing documents are renamed by
    // scripts/migrate-item-household-id.js.
    household_id: {
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
    unit: {
      type: String,
      required: true,
      enum: ['pcs', 'kg', 'g', 'L', 'ml', 'packs', 'bottles', 'boxes', 'other'],
      default: 'pcs',
    },
    purchase_date: {
      type: Date,
      default: null,
    },
    min_stock_level: {
      type: Number,
      default: null,
    },
    cost_per_unit: {
      type: Number,
      default: null,
      min: 0,
    },
    storage_location: {
      type: String,
      default: null,
      trim: true,
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
    // camelCase over the wire, matching User, ActionPlan and the history
    // models, which all expose householdId.
    ret.householdId = ret.household_id.toString();
    delete ret.household_id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

const Item = mongoose.model('Item', itemSchema);

export default Item;
