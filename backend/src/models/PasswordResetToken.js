import mongoose from 'mongoose';

/**
 * A pending password reset.
 *
 * The raw token is NEVER stored. Only its SHA-256 hash is, so a database
 * dump — or read access to a backup — cannot be turned into a set of working
 * reset links. The raw value exists exactly once, in the email that was
 * sent, and is unrecoverable from here afterwards.
 *
 * SHA-256 rather than bcrypt on purpose: the token is 32 bytes of CSPRNG
 * output, so it has no guessable structure for a slow hash to protect
 * against, and lookup needs to be a single indexed query rather than a
 * bcrypt comparison against every outstanding row.
 */
const passwordResetTokenSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    token_hash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    expires_at: {
      type: Date,
      required: true,
    },
    // Set the moment the token is spent. Single-use is enforced by checking
    // this, not by deleting the row, so a replayed link can be told apart
    // from one that never existed.
    used_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'password_reset_tokens',
  }
);

// Mongo removes the document once it expires, so spent and stale tokens do
// not accumulate. The application still checks expiry itself — the TTL
// monitor only runs about once a minute, so a just-expired token can still
// be present and must not be honoured.
passwordResetTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

const PasswordResetToken = mongoose.model('PasswordResetToken', passwordResetTokenSchema);

export default PasswordResetToken;
