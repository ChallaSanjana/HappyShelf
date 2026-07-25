import mongoose from 'mongoose';

// Records every completed reorder so the household can see a log of what
// was restocked, when, and how much was added. Deliberately denormalized
// (item_name/category copied at reorder time) so the history stays readable
// even if the item is later renamed or deleted.
const reorderHistorySchema = new mongoose.Schema(
    {
        household_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        item_id: {
            type: String,
            required: true,
        },
        item_name: {
            type: String,
            required: true,
            trim: true,
        },
        category: {
            type: String,
            default: '',
            trim: true,
        },
        quantity_added: {
            type: Number,
            required: true,
        },
        new_quantity: {
            type: Number,
            required: true,
        },
        unit: {
            type: String,
            default: 'pcs',
        },
        reordered_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
    },
    {
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
        collection: 'reorder_history',
    }
);

reorderHistorySchema.set('toJSON', {
    virtuals: true,
    transform: function (doc, ret) {
        ret.id = ret._id.toString();
        ret.householdId = ret.household_id.toString();
        ret.itemId = ret.item_id;
        ret.itemName = ret.item_name;
        ret.quantityAdded = ret.quantity_added;
        ret.newQuantity = ret.new_quantity;
        ret.reorderedBy = ret.reordered_by.toString();
        delete ret._id;
        delete ret.household_id;
        delete ret.item_id;
        delete ret.item_name;
        delete ret.quantity_added;
        delete ret.new_quantity;
        delete ret.reordered_by;
        delete ret.__v;
        return ret;
    },
});

const ReorderHistory = mongoose.model('ReorderHistory', reorderHistorySchema);

export default ReorderHistory;