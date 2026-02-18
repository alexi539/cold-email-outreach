import "dotenv/config";
import path from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import multer from "multer";
import cron from "node-cron";
import { accountsRouter } from "./routes/accounts.js";
import { authRouter } from "./routes/auth.js";
import { campaignsRouter } from "./routes/campaigns.js";
import { leadsRouter, handleLeadsUpload } from "./routes/leads.js";
import { historyRouter } from "./routes/history.js";
import { statsRouter } from "./routes/stats.js";
import { runSendCycle } from "./services/scheduler.js";
import { checkReplies } from "./services/replyChecker.js";
import { logger, formatError } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, fieldSize: 5 * 1024 * 1024 },
});

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:5173" }));
app.use(express.json({ limit: "10mb" }));

app.use("/api/accounts", accountsRouter);
app.use("/api/auth", authRouter);
app.use("/api/campaigns", campaignsRouter);
app.post("/api/leads/upload", upload.single("file"), handleLeadsUpload);
app.use("/api/leads", leadsRouter);
app.use("/api/history", historyRouter);
app.use("/api/stats", statsRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Serve frontend in production
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.join(__dirname, "..", "public");
if (process.env.NODE_ENV === "production" && existsSync(frontendDir)) {
  app.use(express.static(frontendDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(frontendDir, "index.html"));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("Unhandled error", err);
  res.status(500).json({ error: "Internal server error" });
});

let sendCycleRunning = false;
const schedulerInterval = setInterval(async () => {
  if (sendCycleRunning) return;
  sendCycleRunning = true;
  try {
    await runSendCycle();
  } catch (e) {
    logger.error("Scheduler error", formatError(e));
  } finally {
    sendCycleRunning = false;
  }
}, 10 * 1000);
const cronTask = cron.schedule("*/3 * * * *", () =>
  checkReplies().catch((e) => logger.error("Reply check error", formatError(e)))
);

const PORT = Number(process.env.PORT) || 3001;
const server = app.listen(PORT, () => {
  logger.info("Server running on port", PORT);
});

function gracefulShutdown() {
  logger.info("Shutting down gracefully...");
  clearInterval(schedulerInterval);
  cronTask.stop();
  server.close(() => {
    prisma.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 5000);
}
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
