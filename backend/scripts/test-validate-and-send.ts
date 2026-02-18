/**
 * Test: validate email + send personalized email via Zoho
 * Usage: npx tsx scripts/test-validate-and-send.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { validateEmails } from "../src/services/validkit.js";
import { sendZoho } from "../src/services/zoho.js";
import { personalize } from "../src/services/personalize.js";

const TO_EMAIL = "stelmakh539@gmail.com";

const EMAIL_CONTENT = `Summer seasonal 2026 employment

Hi {{Name}} team,
  
I'm looking for a seasonal job in the US for summer 2026 — ideally FOH, but I'm open to BOH too.

I'm Alex, from Europe (Belarus), will be in the US during the summer season on the Work and Travel program. This isn't my first time: I spent last summer in Ocean City, MD — had two line cook jobs, and worked 1–2 shifts a week as a server. So I have both kitchen and floor experience.
  
I'm available from June to September. I'm coming through InterExchange (www.interexchange.org, tel. 212-924-0446); they handle the paperwork and documents, and I already have a Social Security Number.
Further down in this message is my resume.

Please let me know if you have a vacancy where I could be useful. I'd be grateful for the opportunity to chat.


Resume
Aliaksei Stelmakh
stelmakh539@gmail.com • +375 29 163 11 81 • Minsk, Belarus (Europe)

Experience

Buxy's Salty Dog — Ocean City, MD USA — Line Cook — June 2025 – September 2025 (Work and Travel)
- Worked salad station, fry station, pizza station, and grill. Rotated to prep and dishwashing when needed. Often covered more than one station at once.
- Handled busy rushes and game nights
- Learned to switch between stations and tasks quickly in a fast-paced environment.

Shenanigans — Ocean City, MD, USA — Line Cook — from July 2025 to September 2025 (Work and Travel)
- Worked burger prep station, flat-top, and oven and steamer for pizzas. Often ran two stations at once, some days ran all three stations solo
- Got used to juggling multiple stations and keeping pace during busy periods.

Flavors of Italy Bistro — Ocean City, MD, USA — Server — from July 2025 to September 2025 (Work and Travel, 1–2 days per week)
- Took orders, ran food, bussed tables, used POS for orders and payments. Filled in as server, runner, and support as needed

Restaurant "Bluz" — Belarus — Server — from June 2023 to August 2024
- servers handle all FOH (no separate runners). Took orders, ran food, cleared tables, open/close duties. Worked in a fast-paced environment with high guest turnover.
- Operated register, handled transactions.

Languages
- English — advanced (have lived in America, fully English spoken university program, graduated high school with honors in English)
- Russian — native.
- Belarusian — native

Education
School of Business, BSU — Business Administration (2024–2028).
High school — graduated with honors, English contests (1st and 3rd place, regional/university levels).

Best regards,

Aliaksei Stelmakh`;

async function main() {
  const prisma = new PrismaClient();

  // 1. Validate email
  console.log("=== 1. Validating email:", TO_EMAIL, "===");
  try {
    const results = await validateEmails([TO_EMAIL]);
    const r = results[0];
    console.log("Status:", r.status);
    console.log("Raw:", JSON.stringify(r.raw, null, 2));
    console.log("Validation complete.\n");
  } catch (e) {
    console.log("Validation failed (ValidKit may not be configured):", (e as Error).message);
    console.log("Skipping validation, proceeding to send.\n");
  }

  // 2. Find personalization data (Name) in DB
  let personalizationData: Record<string, string> = {};
  const lead = await prisma.lead.findFirst({
    where: { email: TO_EMAIL.toLowerCase() },
  });
  if (lead?.data) {
    try {
      personalizationData = JSON.parse(lead.data) as Record<string, string>;
      console.log("=== 2. Personalization from DB ===");
      console.log("Found lead data:", personalizationData);
      console.log("Name for {{Name}}:", personalizationData.Name ?? personalizationData.name ?? "(not found)");
      console.log();
    } catch {}
  }
  if (!personalizationData.Name && !personalizationData.name) {
    personalizationData = { Name: "Hiring Manager", name: "Hiring Manager" };
    console.log("=== 2. No lead in DB — using default {{Name}} = 'Hiring Manager' ===\n");
  }

  // 3. Apply personalization
  const [subjectLine, ...bodyLines] = EMAIL_CONTENT.split("\n");
  const subject = personalize(subjectLine.trim(), personalizationData);
  const body = bodyLines.join("\n").trim();
  const bodyPersonalized = personalize(body, personalizationData);

  console.log("=== 3. Sending email ===");
  console.log("Subject:", subject);
  console.log("Body (first 200 chars):", bodyPersonalized.slice(0, 200) + "...");

  const account = await prisma.emailAccount.findFirst({
    where: { accountType: "zoho", isActive: true },
  });
  if (!account) {
    throw new Error("No Zoho account found. Add a Zoho account first.");
  }
  console.log("From:", account.email);

  await sendZoho(account, TO_EMAIL, subject, bodyPersonalized);
  console.log("Sent successfully to", TO_EMAIL);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
