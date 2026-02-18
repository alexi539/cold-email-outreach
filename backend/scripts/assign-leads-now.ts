/**
 * Assign unassigned leads for an active campaign (one-time fix).
 * Usage: npx tsx scripts/assign-leads-now.ts [campaignId]
 */
import "dotenv/config";
import { assignLeadsAndStart } from "../src/services/campaignStart.js";

const campaignId = process.argv[2] || "082c3b81-4942-43a1-b5c5-ba7f053c66c6";

assignLeadsAndStart(campaignId)
  .then(() => {
    console.log("Done");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
