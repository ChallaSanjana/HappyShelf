import mongoose from 'mongoose';

/**
 * An append-only record of actions worth answering "who did that?" about.
 *
 * Entries are never updated or deleted through the API — an audit trail that
 * can be edited by the people it audits is not one. The actor's name and
 * email are denormalised on purpose: the whole point is to still read
 * correctly after that member has been renamed or removed from the team.
 */
const auditLogSchema = new mongoose.Schema(
  {
    household_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    actor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Kept as plain strings so the entry survives the actor being deleted.
    actor_name: { type: String, default: null, trim: true },
    actor_email: { type: String, default: null, trim: true },

    action: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    target_type: {
      type: String,
      enum: ['item', 'member', 'account', 'household'],
      required: true,
    },
    target_id: { type: String, default: null },
    target_name: { type: String, default: null, trim: true },

    /**
     * Action-specific context — quantities, the roles either side of a
     * change, how many rows an import created.
     *
     * Mixed rather than a fixed shape because the useful detail genuinely
     * differs per action. Nothing sensitive is ever put here: no passwords,
     * no hashes, no tokens.
     */
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'audit_logs',
  }
);

// The only read pattern is "this household's entries, newest first".
auditLogSchema.index({ household_id: 1, created_at: -1 });

auditLogSchema.virtual('id').get(function () {
  return this._id.toString();
});

auditLogSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    ret.id = ret._id.toString();
    ret.householdId = ret.household_id.toString();
    ret.actorId = ret.actor_id ? ret.actor_id.toString() : null;
    ret.actorName = ret.actor_name;
    ret.actorEmail = ret.actor_email;
    ret.targetType = ret.target_type;
    ret.targetId = ret.target_id;
    ret.targetName = ret.target_name;
    ret.createdAt = ret.created_at;

    delete ret._id;
    delete ret.__v;
    delete ret.household_id;
    delete ret.actor_id;
    delete ret.actor_name;
    delete ret.actor_email;
    delete ret.target_type;
    delete ret.target_id;
    delete ret.target_name;
    delete ret.created_at;
    delete ret.updated_at;
    return ret;
  },
});

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

export default AuditLog;
