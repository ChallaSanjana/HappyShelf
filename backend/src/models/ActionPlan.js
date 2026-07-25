import mongoose from 'mongoose';

// A single checklist item within a plan — either "restock this" (low/out of
// stock) or "use this soon" (expiring soon). Kept intentionally simple:
// just enough to check off as done, not a full task-management system.
const actionPlanTaskSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ['restock', 'use_soon'],
            required: true,
        },
        item_name: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            required: true,
            trim: true,
        },
        done: {
            type: Boolean,
            default: false,
        },
    },
    { _id: true }
);

const actionPlanSchema = new mongoose.Schema(
    {
        household_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        created_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
        },
        tasks: {
            type: [actionPlanTaskSchema],
            default: [],
        },
    },
    {
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
        collection: 'action_plans',
    }
);

actionPlanSchema.virtual('id').get(function () {
    return this._id.toString();
});

actionPlanSchema.set('toJSON', {
    virtuals: true,
    transform: function (doc, ret) {
        ret.id = ret._id.toString();
        ret.householdId = ret.household_id.toString();
        ret.createdBy = ret.created_by.toString();
        ret.tasks = (ret.tasks || []).map((t) => ({
            id: t._id.toString(),
            type: t.type,
            itemName: t.item_name,
            description: t.description,
            done: t.done,
        }));
        delete ret._id;
        delete ret.household_id;
        delete ret.created_by;
        delete ret.__v;
        return ret;
    },
});

const ActionPlan = mongoose.model('ActionPlan', actionPlanSchema);

export default ActionPlan;