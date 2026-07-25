import mongoose from 'mongoose';
import { applyCommonHistoryFields } from '../utils/historyJson.js';

// Records every completed consume so the household has a usage log: what was
// used, when, how much, and what was left afterwards. Mirrors ReorderHistory
// (same denormalization of item_name/category at write time, so the log stays
// readable after an item is renamed or deleted) and is the raw signal a real
// demand forecast would train on, instead of the static daily_usage estimate
// the ML service currently falls back to.
const consumptionHistorySchema = new mongoose.Schema(
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
        quantity_consumed: {
            type: Number,
            required: true,
        },
        // Stock left after this consume. Stored rather than derived so the log
        // still reads correctly after later reorders/consumes move the item's
        // current quantity somewhere else entirely.
        remaining_quantity: {
            type: Number,
            required: true,
        },
        unit: {
            type: String,
            default: 'pcs',
        },
        consumed_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
    },
    {
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
        collection: 'consumption_history',
    }
);

consumptionHistorySchema.set('toJSON', {
    virtuals: true,
    transform: function (doc, ret) {
        applyCommonHistoryFields(ret);
        ret.quantityConsumed = ret.quantity_consumed;
        ret.remainingQuantity = ret.remaining_quantity;
        ret.consumedBy = ret.consumed_by.toString();
        delete ret.quantity_consumed;
        delete ret.remaining_quantity;
        delete ret.consumed_by;
        return ret;
    },
});

const ConsumptionHistory = mongoose.model('ConsumptionHistory', consumptionHistorySchema);

export default ConsumptionHistory;
