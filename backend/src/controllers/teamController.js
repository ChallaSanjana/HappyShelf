import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import User from '../models/User.js';
import { devUsers } from './authController.js';

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

const ROLES = ['Admin', 'Manager', 'Staff', 'Viewer'];
const MIN_PASSWORD_LENGTH = 8;

// A Manager could otherwise add a brand-new member as Admin (or promote an
// existing Staff/Viewer straight to Admin/Manager), instantly granting
// themselves a peer or superior account. Only an Admin may assign the
// Admin or Manager role; a Manager may only assign Staff or Viewer.
function canAssignRole(actorRole, targetRole) {
  if (actorRole === 'Admin') return true;
  if (actorRole === 'Manager') return targetRole === 'Staff' || targetRole === 'Viewer';
  return false;
}

// Beyond just the role being assigned, a Manager must not be able to touch
// (rename, re-role, or delete) an existing Admin or Manager account at
// all — otherwise they could demote/rename an Admin peer without ever
// "assigning" a disallowed role themselves. Only an Admin can act on an
// Admin/Manager member; anyone with team access can act on Staff/Viewer.
function canActOnMember(actorRole, memberCurrentRole) {
  if (actorRole === 'Admin') return true;
  if (actorRole === 'Manager') return memberCurrentRole === 'Staff' || memberCurrentRole === 'Viewer';
  return false;
}

// A member counts as an "active Admin" unless they've been explicitly
// deactivated. Used by the last-Admin safeguard below.
function isActiveAdmin(u) {
  return u.role === 'Admin' && u.is_active !== false;
}

// Counts how many active Admins exist in a household. Used to make sure a
// demotion, deactivation, or deletion never leaves a household with zero
// Admins.
async function countActiveAdmins(householdId) {
  if (!isDbConnected()) {
    return Array.from(devUsers.values()).filter(
      (u) => u.household_id === householdId && isActiveAdmin(u)
    ).length;
  }
  return User.countDocuments({ household_id: householdId, role: 'Admin', is_active: { $ne: false } });
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : email;
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= MIN_PASSWORD_LENGTH;
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
          avatarUrl: u.avatar_url || null,
          isActive: u.is_active !== false,
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

    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${ROLES.join(', ')}` });
    }

    if (!canAssignRole(req.user.role, role)) {
      return res.status(403).json({ error: `Forbidden: your role (${req.user.role}) cannot assign the ${role} role` });
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
        avatar_url: null,
        is_active: true,
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
          avatarUrl: null,
          isActive: true,
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
    const { name, email, password, avatarUrl, role, isActive } = req.body;
    const memberId = req.params.id;
    const householdId = req.user.householdId;
    // req.user.userId is always a string (either the dev-mode id or the
    // Mongo ObjectId's .toString()), and memberId comes from the URL, so a
    // plain string comparison is safe in both modes.
    const actingOnSelf = String(memberId) === String(req.user.userId);

    if (isDbConnected() && !mongoose.Types.ObjectId.isValid(memberId)) {
      return res.status(400).json({ error: 'Invalid team member id' });
    }

    if (role !== undefined && !ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${ROLES.join(', ')}` });
    }

    if (password !== undefined && !isValidPassword(password)) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    if (isActive !== undefined && typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    const isChangingRoleOrAccess = role !== undefined || isActive !== undefined;

    // --- Permission gate -------------------------------------------------
    // Editing your OWN record (name/email/password/avatar) is always allowed
    // for anyone with team access — that's just self-service profile editing.
    // But changing your OWN role or active-status is a privilege escalation /
    // self-reinstatement risk, so only an Admin may do that to themselves;
    // a Manager can never touch their own role or active-status here, no
    // matter what. Editing someone ELSE's record still goes through the
    // normal hierarchy checks.
    if (actingOnSelf) {
      if (isChangingRoleOrAccess && req.user.role !== 'Admin') {
        return res.status(403).json({
          error: 'You cannot change your own role or account status. Ask an Admin to make this change.',
        });
      }
    }

    if (!isDbConnected()) {
      // Find member in devUsers
      const member = Array.from(devUsers.values()).find(u => u.id === memberId && u.household_id === householdId);
      if (!member) {
        return res.status(404).json({ error: 'Team member not found' });
      }

      if (!actingOnSelf) {
        // Check against the member's *current* role first (e.g. a Manager
        // can't rename/demote an existing Admin), then against the role
        // being assigned (a Manager can't promote anyone to Admin either).
        if (!canActOnMember(req.user.role, member.role)) {
          return res.status(403).json({ error: `Forbidden: your role (${req.user.role}) cannot modify a ${member.role}` });
        }
        if (role !== undefined && !canAssignRole(req.user.role, role)) {
          return res.status(403).json({ error: `Forbidden: your role (${req.user.role}) cannot assign the ${role} role` });
        }
      }

      // --- Last-Admin safeguard ------------------------------------------
      // A household can never be left with zero active Admins. This blocks
      // the change regardless of who is making it (an Admin editing their
      // own account, or another Admin acting on them).
      const wouldRemoveAdminRole = member.role === 'Admin' && role !== undefined && role !== 'Admin';
      const wouldDeactivateAdmin = member.role === 'Admin' && isActive === false && member.is_active !== false;
      if (wouldRemoveAdminRole || wouldDeactivateAdmin) {
        const activeAdminCount = await countActiveAdmins(householdId);
        if (activeAdminCount <= 1) {
          return res.status(403).json({
            error: 'Cannot complete this change: at least one Admin must always remain on the team.',
          });
        }
      }

      // Email uniqueness check when changing email
      if (email !== undefined) {
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail) {
          return res.status(400).json({ error: 'Email cannot be empty' });
        }
        if (normalizedEmail !== member.email) {
          if (devUsers.has(normalizedEmail)) {
            return res.status(400).json({ error: 'Email already registered' });
          }
          devUsers.delete(member.email);
          member.email = normalizedEmail;
          devUsers.set(normalizedEmail, member);
        }
      }

      if (name !== undefined) member.name = name;
      if (avatarUrl !== undefined) member.avatar_url = avatarUrl || null;
      if (password !== undefined) member.password_hash = await bcrypt.hash(password, 10);
      if (role !== undefined) member.role = role;
      if (isActive !== undefined) member.is_active = isActive;

      return res.json({
        message: 'Team member updated successfully (dev mode)',
        member: {
          id: member.id,
          name: member.name,
          email: member.email,
          role: member.role,
          householdId: member.household_id,
          avatarUrl: member.avatar_url || null,
          isActive: member.is_active !== false,
        },
      });
    }

    const member = await User.findOne({ _id: memberId, household_id: householdId });
    if (!member) {
      return res.status(404).json({ error: 'Team member not found' });
    }

    if (!actingOnSelf) {
      if (!canActOnMember(req.user.role, member.role)) {
        return res.status(403).json({ error: `Forbidden: your role (${req.user.role}) cannot modify a ${member.role}` });
      }
      if (role !== undefined && !canAssignRole(req.user.role, role)) {
        return res.status(403).json({ error: `Forbidden: your role (${req.user.role}) cannot assign the ${role} role` });
      }
    }

    // --- Last-Admin safeguard ------------------------------------------
    const wouldRemoveAdminRole = member.role === 'Admin' && role !== undefined && role !== 'Admin';
    const wouldDeactivateAdmin = member.role === 'Admin' && isActive === false && member.is_active !== false;
    if (wouldRemoveAdminRole || wouldDeactivateAdmin) {
      const activeAdminCount = await countActiveAdmins(householdId);
      if (activeAdminCount <= 1) {
        return res.status(403).json({
          error: 'Cannot complete this change: at least one Admin must always remain on the team.',
        });
      }
    }

    // Email uniqueness check when changing email
    if (email !== undefined) {
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) {
        return res.status(400).json({ error: 'Email cannot be empty' });
      }
      if (normalizedEmail !== member.email) {
        const existing = await User.findOne({ email: normalizedEmail });
        if (existing) {
          return res.status(400).json({ error: 'Email already registered' });
        }
        member.email = normalizedEmail;
      }
    }

    if (name !== undefined) member.name = name;
    if (avatarUrl !== undefined) member.avatar_url = avatarUrl || null;
    if (password !== undefined) member.password_hash = await bcrypt.hash(password, 10);
    if (role !== undefined) member.role = role;
    if (isActive !== undefined) member.is_active = isActive;

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

      if (!canActOnMember(req.user.role, member.role)) {
        return res.status(403).json({ error: `Forbidden: your role (${req.user.role}) cannot remove a ${member.role}` });
      }

      // Last-Admin safeguard: never allow the sole remaining active Admin
      // to be deleted, even by another Admin.
      if (isActiveAdmin(member)) {
        const activeAdminCount = await countActiveAdmins(householdId);
        if (activeAdminCount <= 1) {
          return res.status(403).json({ error: 'Cannot remove this member: at least one Admin must always remain on the team.' });
        }
      }

      devUsers.delete(member.email);
      return res.json({ message: 'Team member removed successfully (dev mode)' });
    }

    const member = await User.findOne({ _id: memberId, household_id: householdId });
    if (!member) {
      return res.status(404).json({ error: 'Team member not found' });
    }

    if (!canActOnMember(req.user.role, member.role)) {
      return res.status(403).json({ error: `Forbidden: your role (${req.user.role}) cannot remove a ${member.role}` });
    }

    // Last-Admin safeguard: never allow the sole remaining active Admin to
    // be deleted, even by another Admin.
    if (member.role === 'Admin' && member.is_active !== false) {
      const activeAdminCount = await countActiveAdmins(householdId);
      if (activeAdminCount <= 1) {
        return res.status(403).json({ error: 'Cannot remove this member: at least one Admin must always remain on the team.' });
      }
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