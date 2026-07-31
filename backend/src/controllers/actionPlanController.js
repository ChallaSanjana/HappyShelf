import mongoose from 'mongoose';
import Item from '../models/Item.js';
import ActionPlan from '../models/ActionPlan.js';
import { getUserItems } from './inventoryController.js';
import {
    getStockStatus,
    getDaysToExpiry,
    isExpiredOrExpiringSoon,
} from '../utils/inventoryMetrics.js';

function isDbConnected() {
    return mongoose.connection.readyState === 1;
}

// Sessions opened while the DB was down carry a synthetic "dev_" id that
// can't be resolved once the DB is back. That's now rejected centrally in
// middleware/auth.js, which re-reads the account on every request, so no
// controller needs its own guard.

// In-memory storage fallback for development when MongoDB is unavailable.
// Keyed by householdId -> plans[], mirroring the pattern used elsewhere
// (devUsers in store/devStore.js, devInventory in inventoryController.js).
const devActionPlans = new Map();
let nextPlanId = 1;

function getHouseholdPlans(householdId) {
    if (!devActionPlans.has(householdId)) {
        devActionPlans.set(householdId, []);
    }
    return devActionPlans.get(householdId);
}

/**
 * Serializes a task the way ActionPlan's toJSON transform does.
 *
 * buildTasksFromItems produces the snake_case shape Mongoose stores
 * (`item_name`), and the model's toJSON renames it to `itemName` on the way
 * out. The dev-mode path used to spread the raw task straight into the
 * response, so without a database every task arrived as `item_name` and the
 * UI — which reads `itemName` — rendered a blank name on every row.
 */
function buildDevTask(id, task) {
    return {
        id,
        type: task.type,
        itemName: task.item_name,
        description: task.description,
        done: task.done,
    };
}

// Builds the checklist tasks from a household's current inventory. Runs
// server-side against the live item list (not whatever the client sends)
// so a plan can't be seeded with fabricated tasks.
//
// Stock and expiry status come from utils/inventoryMetrics.js — the same
// module the dashboard stats, the search filters and the alert emails use.
// This file previously kept private copies of both rules, and they had
// drifted: the local isLowStock ignored min_stock_level, and the local
// isExpiringSoon guarded on `days >= 0`, so an item that had *already
// expired* produced no "use soon" task at all — the one case an action plan
// most needs to raise.
function buildTasksFromItems(items) {
    const tasks = [];

    for (const item of items) {
        const status = getStockStatus(item);
        if (status === 'out') {
            tasks.push({
                type: 'restock',
                item_name: item.name,
                description: `${item.name} is out of stock — reorder as soon as possible.`,
                done: false,
            });
        } else if (status === 'low') {
            tasks.push({
                type: 'restock',
                item_name: item.name,
                description: `${item.name} is running low (${item.quantity} ${item.unit} left) — plan a restock.`,
                done: false,
            });
        }
    }

    for (const item of items) {
        if (!isExpiredOrExpiringSoon(item.expiry_date)) continue;

        const days = getDaysToExpiry(item.expiry_date);
        if (days < 0) {
            const ago = Math.abs(days);
            tasks.push({
                type: 'use_soon',
                item_name: item.name,
                description: `${item.name} expired ${ago} day${ago === 1 ? '' : 's'} ago — check it and discard if it has gone off.`,
                done: false,
            });
        } else {
            const when = days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`;
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
                householdId,
                createdBy: req.user.userId,
                title: planTitle,
                tasks: tasks.map((t, i) => buildDevTask(`dev_task_${Date.now()}_${i}`, t)),
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