/**
 * Renames Item.user_id to Item.household_id on existing documents.
 *
 * The field always held a household id despite its name. Renaming it in the
 * schema alone would leave stored documents carrying `user_id`, which the new
 * queries do not match — every existing item would simply vanish from the
 * app while still sitting in the database.
 *
 *   node scripts/migrate-item-household-id.js --dry-run   # report only
 *   node scripts/migrate-item-household-id.js             # apply
 *
 * Idempotent: running it twice is a no-op. Safe to run before deploying the
 * new code as well as after, since the old code reads user_id and the new
 * code reads household_id but neither writes the other.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const DRY_RUN = process.argv.includes('--dry-run');
const COLLECTION = 'inventory_items';

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/happyshelf';
  console.log(`Connecting to ${uri.replace(/\/\/[^@]*@/, '//***@')}`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const col = mongoose.connection.collection(COLLECTION);

  const total = await col.countDocuments({});
  const legacyOnly = await col.countDocuments({
    user_id: { $exists: true },
    household_id: { $exists: false },
  });
  const bothFields = await col.countDocuments({
    user_id: { $exists: true },
    household_id: { $exists: true },
  });
  const migrated = await col.countDocuments({
    user_id: { $exists: false },
    household_id: { $exists: true },
  });
  const neither = await col.countDocuments({
    user_id: { $exists: false },
    household_id: { $exists: false },
  });

  console.log(`\n${COLLECTION}: ${total} documents`);
  console.log(`  already migrated (household_id only) : ${migrated}`);
  console.log(`  needing rename   (user_id only)      : ${legacyOnly}`);
  console.log(`  carrying both fields                 : ${bothFields}`);
  console.log(`  carrying neither                     : ${neither}`);

  if (neither > 0) {
    console.warn(
      `\n! ${neither} document(s) have no household field at all. Those are ` +
        'orphaned and are left untouched — inspect them by hand.'
    );
  }

  // Documents holding both fields can only arise from a partial run or from
  // old and new code writing concurrently. Dropping user_id is safe when the
  // two agree; when they disagree the correct value is not knowable here, so
  // those are reported and skipped rather than guessed at.
  let conflicting = 0;
  if (bothFields > 0) {
    const docs = await col
      .find({ user_id: { $exists: true }, household_id: { $exists: true } })
      .project({ user_id: 1, household_id: 1 })
      .toArray();
    conflicting = docs.filter((d) => String(d.user_id) !== String(d.household_id)).length;
    if (conflicting > 0) {
      console.error(
        `\n! ${conflicting} document(s) have user_id and household_id set to ` +
          'DIFFERENT values. Skipping them; resolve manually before rerunning.'
      );
      docs
        .filter((d) => String(d.user_id) !== String(d.household_id))
        .slice(0, 10)
        .forEach((d) => console.error(`    _id=${d._id} user_id=${d.user_id} household_id=${d.household_id}`));
    }
  }

  const nothingToRename = legacyOnly === 0 && bothFields - conflicting === 0;
  if (nothingToRename) {
    console.log('\nNo documents need renaming.');
    // Deliberately not returning here: a collection that is already fully
    // migrated can still carry the stale user_id index from before the
    // rename, and dropping that is the one piece of work left.
  }

  if (DRY_RUN) {
    console.log(
      `\n[dry run] would rename ${legacyOnly} document(s) and drop a redundant ` +
        `user_id from ${bothFields - conflicting}. No changes written.`
    );
    await mongoose.disconnect();
    return;
  }

  if (!nothingToRename && legacyOnly > 0) {
    const res = await col.updateMany(
      { user_id: { $exists: true }, household_id: { $exists: false } },
      { $rename: { user_id: 'household_id' } }
    );
    console.log(`\nRenamed user_id -> household_id on ${res.modifiedCount} document(s).`);
  }

  if (!nothingToRename && bothFields - conflicting > 0) {
    const res = await col.updateMany(
      { $expr: { $eq: ['$user_id', '$household_id'] } },
      { $unset: { user_id: '' } }
    );
    console.log(`Dropped redundant user_id from ${res.modifiedCount} document(s).`);
  }

  const remaining = await col.countDocuments({ user_id: { $exists: true } });
  console.log(`\nDocuments still carrying user_id: ${remaining}`);
  if (remaining === 0) {
    // The old index is dead weight once nothing queries user_id. Dropping it
    // is optional, so a failure here is reported rather than fatal.
    try {
      const indexes = await col.indexes();
      const stale = indexes.find((i) => i.key && i.key.user_id !== undefined);
      if (stale) {
        await col.dropIndex(stale.name);
        console.log(`Dropped stale index ${stale.name}.`);
      }
    } catch (error) {
      console.warn(`Could not drop the stale user_id index: ${error.message}`);
    }
  }

  console.log('\nDone.');
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('Migration failed:', error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
