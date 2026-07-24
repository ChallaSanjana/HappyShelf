import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import User from '../models/User.js';
import { devUsers } from './authController.js';

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

export const getTeamMembers = async (req, res) => {
  try {
    const householdId = req.user.householdId;

    if (!isDbConnected()) {
      const members = Array.from(devUsers.values())
        .filter(u => u.household_id === householdId)
        .map(u => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          householdId: u.household_id,
        }));
      return res.json({ members });
    }

    const members = await User.find({ household_id: householdId });
    res.json({ members });
  } catch (error) {
    console.error('Get team members error:', error);
    res.status(500).json({ error: 'Failed to fetch team members' });
  }
};

export const createTeamMember = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const householdId = req.user.householdId;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'All fields (name, email, password, role) are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if email already exists
    if (!isDbConnected()) {
      if (devUsers.has(normalizedEmail)) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const userId = `dev_user_${Date.now()}`;
      const newMember = {
        id: userId,
        name,
        email: normalizedEmail,
        password_hash: passwordHash,
        role,
        household_id: householdId,
      };
      devUsers.set(normalizedEmail, newMember);

      return res.status(201).json({
        message: 'Team member added successfully (dev mode)',
        member: {
          id: userId,
          name,
          email: normalizedEmail,
          role,
          householdId,
        },
      });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const newMember = await User.create({
      name,
      email: normalizedEmail,
      password_hash: passwordHash,
      role,
      household_id: householdId,
    });

    res.status(201).json({
      message: 'Team member added successfully',
      member: newMember,
    });
  } catch (error) {
    console.error('Create team member error:', error);
    res.status(500).json({ error: 'Failed to create team member' });
  }
};

export const updateTeamMember = async (req, res) => {
  try {
    const { name, role } = req.body;
    const memberId = req.params.id;
    const householdId = req.user.householdId;

    if (isDbConnected() && !mongoose.Types.ObjectId.isValid(memberId)) {
      return res.status(400).json({ error: 'Invalid team member id' });
    }

    if (!isDbConnected()) {
      // Find member in devUsers
      const member = Array.from(devUsers.values()).find(u => u.id === memberId && u.household_id === householdId);
      if (!member) {
        return res.status(404).json({ error: 'Team member not found' });
      }

      if (name !== undefined) member.name = name;
      if (role !== undefined) member.role = role;

      return res.json({
        message: 'Team member updated successfully (dev mode)',
        member: {
          id: member.id,
          name: member.name,
          email: member.email,
          role: member.role,
          householdId: member.household_id,
        },
      });
    }

    const member = await User.findOne({ _id: memberId, household_id: householdId });
    if (!member) {
      return res.status(404).json({ error: 'Team member not found' });
    }

    if (name !== undefined) member.name = name;
    if (role !== undefined) member.role = role;

    await member.save();

    res.json({
      message: 'Team member updated successfully',
      member,
    });
  } catch (error) {
    console.error('Update team member error:', error);
    res.status(500).json({ error: 'Failed to update team member' });
  }
};

export const deleteTeamMember = async (req, res) => {
  try {
    const memberId = req.params.id;
    const householdId = req.user.householdId;

    // A user cannot delete themselves from the team view
    if (memberId === req.user.userId) {
      return res.status(400).json({ error: 'You cannot delete yourself from the team panel' });
    }

    if (isDbConnected() && !mongoose.Types.ObjectId.isValid(memberId)) {
      return res.status(400).json({ error: 'Invalid team member id' });
    }

    if (!isDbConnected()) {
      const member = Array.from(devUsers.values()).find(u => u.id === memberId && u.household_id === householdId);
      if (!member) {
        return res.status(404).json({ error: 'Team member not found' });
      }

      devUsers.delete(member.email);
      return res.json({ message: 'Team member removed successfully (dev mode)' });
    }

    const result = await User.deleteOne({ _id: memberId, household_id: householdId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Team member not found' });
    }

    res.json({ message: 'Team member removed successfully' });
  } catch (error) {
    console.error('Delete team member error:', error);
    res.status(500).json({ error: 'Failed to delete team member' });
  }
};
