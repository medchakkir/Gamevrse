// =============================================================
// adminRoutes.js — Admin API routes
// =============================================================

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ADMIN_TOKEN } from "./config.js";
import { loadExternalQuestions, addQuestionToPool } from "./questionService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const QUESTIONS_FILE = path.join(DATA_DIR, "questions.json");

const MAX_QUESTION_LENGTH = 300;

// Constant-time comparison; lengths are checked first because timingSafeEqual throws on a mismatch.
function tokenMatches(provided) {
  if (!ADMIN_TOKEN || typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function setupAdminRoutes(app) {
  app.post("/admin/add-question", (req, res) => {
    if (!tokenMatches(req.headers["x-admin-token"])) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    const { text, difficulty } = req.body || {};

    if (typeof text !== "string" || !text.trim() || !difficulty) {
      return res.status(400).json({ ok: false, error: "invalid_payload" });
    }

    if (text.trim().length > MAX_QUESTION_LENGTH) {
      return res.status(400).json({ ok: false, error: "text_too_long" });
    }

    if (!["easy", "medium", "hard"].includes(difficulty)) {
      return res.status(400).json({ ok: false, error: "invalid_difficulty" });
    }

    const q = { text: text.trim(), difficulty };

    try {
      if (!fs.existsSync(DATA_DIR))
        fs.mkdirSync(DATA_DIR, { recursive: true });

      const existing = loadExternalQuestions();

      if (existing.some(x => x.text === q.text)) {
        return res.status(409).json({ ok:false, error:"question_exists" });
      }

      existing.push(q);

      fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(existing, null, 2));
      addQuestionToPool(q);

      res.json({ ok: true, added: q });
    } catch {
      res.status(500).json({ ok: false, error: "write_failed" });
    }
  });
}
