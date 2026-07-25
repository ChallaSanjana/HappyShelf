import mongoose from 'mongoose';
import Item from '../models/Item.js';
import ActionPlan from '../models/ActionPlan.js';
import { getUserItems } from './inventoryController.js';

function isDbConnected() {
    return mongoose.connection.readyState === 1;
}

// A user who registered/logged in while the DB was down gets a token with a
// synthetic id like "dev_1"/"dev_user_...", which is not a valid Mongo
// ObjectId or household_id. If the DB comes back up during that token's
// lifetime, any query built from req.user.householdId would throw a
// Mongoose CastError (surfacing as an opaque 500). Mirrors the same guard
// in inventoryController.js.
function isDevModeId(id) {
    return typeof id === 'string' && id.startsWith('dev_');
}

function rejectStaleDevSession(req, res) {
    if (isDbConnected() && (isDevModeId(req.user.householdId) || isDevModeId(req.user.userId))) {
        res.status(409).json({
            error: 'Your session was created while offline. Please log in again.',
        });
        return true;
    }
    return false;
}

// In-memory storage fallback for development when MongoDB is unavailable.
// Keyed by householdId -> plans[], mirroring the pattern used elsewhere
// (devUsers in authController.js, devInventory in inventoryController.js).
const devActionPlans = new Map();
let nextPlanId = 1;

function getHouseholdPlans(householdId) {
    if (!devActionPlans.has(householdId)) {
        devActionPlans.set(householdId, []);
    }
    return devActionPlans.get(householdId);
}

// Same thresholds as inventoryController's getStats/getPredictions, so the
// checklist a plan generates always matches what the dashboard is showing
// as "low stock" / "expiring soon" at the moment the plan is created.
function isLowStock(item) {
    const daysLeft = item.daily_usage > 0 ? item.quantity / item.daily_usage : 999;
    return daysLeft < 3;
}

function daysToExpiry(item) {
    if (!item.expiry_date) return null;
    return Math.ceil((new Date(item.expiry_date) - new Date()) / (1000 * 60 * 60 * 24));
}

function isExpiringSoon(item) {
    const days = daysToExpiry(item);
    return days !== null && days >= 0 && days < 7;
}

// Builds the checklist tasks from a household's current inventory. Runs
// server-side against the live item list (not whatever the client sends)
// so a plan can't be seeded with fabricated tasks.
function buildTasksFromItems(items) {
    const tasks = [];

    for (const item of items) {
        if (item.quantity <= 0) {
            tasks.push({
                type: 'restock',
                item_name: item.name,
                description: `${item.name} is out of stock — reorder as soon as possible.`,
                done: false,
            });
        } else if (isLowStock(item)) {
            tasks.push({
                type: 'restock',
                item_name: item.name,
                description: `${item.name} is running low (${item.quantity} ${item.unit} left) — plan a restock.`,
                done: false,
            });
        }
    }

    for (const item of items) {
        if (isExpiringSoon(item)) {
            const days = daysToExpiry(item);
            const when = days <= 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`;
            tasks.push({
                type: 'use_soon',
                item_name: item.name,
                description: `${item.name} expires ${when} — use it up or move it to the front.`,
                done: false,
            });
        }
    }

    return tasks;
}

export const getActionPlans = async (req, res) => {
    try {
        if (rejectStaleDevSession(req, res)) return;

        const householdId = req.user.householdId;

        if (!isDbConnected()) {
            const plans = getHouseholdPlans(householdId)
                .slice()
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            return res.json({ plans });
        }

        const plans = await ActionPlan.find({ household_id: householdId }).sort({ created_at: -1 });
        res.json({ plans });
    } catch (error) {
        console.error('Get action plans error:', error);
        res.status(500).json({ error: 'Failed to fetch action plans' });
    }
};

export const createActionPlan = async (req, res) => {
    try {
        if (rejectStaleDevSession(req, res)) return;

        const { title } = req.body;
        const householdId = req.user.householdId;
        const planTitle = (typeof title === 'string' && title.trim()) || `Action Plan — ${new Date().toLocaleDateString()}`;

        if (!isDbConnected()) {
            const items = getUserItems(householdId);
            const tasks = buildTasksFromItems(items);

            if (tasks.length === 0) {
                return res.status(400).json({ error: 'Nothing to add right now — no items are low, out of stock, or expiring soon.' });
            }

            const plan = {
                id: `dev_plan_${nextPlanId++}`,
                household_id: householdId,
                created_by: req.user.userId,
                title: planTitle,
                tasks: tasks.map((t, i) => ({ id: `dev_task_${Date.now()}_${i}`, ...t })),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            getHouseholdPlans(householdId).push(plan);

            return res.status(201).json({
                message: 'Action plan created successfully (dev mode)',
                plan,
            });
        }

        const items = await Item.find({ user_id: householdId });
        const tasks = buildTasksFromItems(items);

        if (tasks.length === 0) {
            return res.status(400).json({ error: 'Nothing to add right now — no items are low, out of stock, or expiring soon.' });
        }

        const plan = await ActionPlan.create({
            household_id: householdId,
            created_by: req.user.userId,
            title: planTitle,
            tasks,
        });

        res.status(201).json({
            message: 'Action plan created successfully',
            plan,
        });
    } catch (error) {
        console.error('Create action plan error:', error);
        res.status(500).json({ error: 'Failed to create action plan' });
    }
};

// Toggles a single task's done state. This is the only edit an action plan
// supports — it's a checklist, not a general task editor.
export const updateActionPlanTask = async (req, res) => {
    try {
        if (rejectStaleDevSession(req, res)) return;

        const { planId, taskId } = req.params;
        const { done } = req.body;
        const householdId = req.user.householdId;

        if (typeof done !== 'boolean') {
            return res.status(400).json({ error: 'done must be a boolean' });
        }

        if (!isDbConnected()) {
            const plan = getHouseholdPlans(householdId).find((p) => p.id === planId);
            if (!plan) {
                return res.status(404).json({ error: 'Action plan not found' });
            }
            const task = plan.tasks.find((t) => t.id === taskId);
            if (!task) {
                return res.status(404).json({ error: 'Task not found' });
            }
            task.done = done;
            plan.updated_at = new Date().toISOString();
            return res.json({ message: 'Task updated successfully (dev mode)', plan });
        }

        if (!mongoose.Types.ObjectId.isValid(planId) || !mongoose.Types.ObjectId.isValid(taskId)) {
            return res.status(400).json({ error: 'Invalid plan or task id' });
        }

        const plan = await ActionPlan.findOne({ _id: planId, household_id: householdId });
        if (!plan) {
            return res.status(404).json({ error: 'Action plan not found' });
        }
        const task = plan.tasks.id(taskId);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }
        task.done = done;
        await plan.save();

        res.json({ message: 'Task updated successfully', plan });
    } catch (error) {
        console.error('Update action plan task error:', error);
        res.status(500).json({ error: 'Failed to update task' });
    }
};

export const deleteActionPlan = async (req, res) => {
    try {
        if (rejectStaleDevSession(req, res)) return;

        const { planId } = req.params;
        const householdId = req.user.householdId;

        if (!isDbConnected()) {
            const plans = getHouseholdPlans(householdId);
            const index = plans.findIndex((p) => p.id === planId);
            if (index === -1) {
                return res.status(404).json({ error: 'Action plan not found' });
            }
            plans.splice(index, 1);
            return res.json({ message: 'Action plan deleted successfully (dev mode)' });
        }

        if (!mongoose.Types.ObjectId.isValid(planId)) {
            return res.status(400).json({ error: 'Invalid plan id' });
        }

        const result = await ActionPlan.deleteOne({ _id: planId, household_id: householdId });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Action plan not found' });
        }

        res.json({ message: 'Action plan deleted successfully' });
    } catch (error) {
        console.error('Delete action plan error:', error);
        res.status(500).json({ error: 'Failed to delete action plan' });
    }
};