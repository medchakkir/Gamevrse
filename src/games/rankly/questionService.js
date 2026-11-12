// =============================================================
// questionService.js — Question loading and validation
// =============================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { BUILT_IN_QUESTIONS } from "./config.js";
import { shuffle } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const QUESTIONS_FILE = path.join(DATA_DIR, "questions.json");

// Main question pool (external + built-in)
let RANDOM_QUESTIONS = [...BUILT_IN_QUESTIONS];

export function loadExternalQuestions() {
  try {
    if (!fs.existsSync(QUESTIONS_FILE)) return [];

    const raw = JSON.parse(fs.readFileSync(QUESTIONS_FILE, "utf8"));

    if (!Array.isArray(raw)) return [];

    return raw.filter(q =>
      q &&
      typeof q.text === "string" &&
      ["easy", "medium", "hard"].includes(q.difficulty)
    );
  } catch {
    return [];
  }
}

export function reloadQuestionsFromFile() {
  const ext = loadExternalQuestions();
  for (const q of ext) {
    if (!RANDOM_QUESTIONS.some(x => x.text === q.text)) {
      RANDOM_QUESTIONS.push(q);
    }
  }
}

export function getRandomQuestions() {
  return RANDOM_QUESTIONS;
}

export function addQuestionToPool(question) {
  if (!RANDOM_QUESTIONS.some(x => x.text === question.text)) {
    RANDOM_QUESTIONS.push(question);
  }
}

export function prepareRoomQuestions(room, numRounds) {
  const rounds = Math.max(5, Math.min(20, Number(numRounds || 5)));

  // Question non-repetition only applies to Standard Mode
  let availableQuestions;
  if (room.mode === "normal") {
    availableQuestions = RANDOM_QUESTIONS.filter(q => 
      !room.usedQuestionTexts.has(q.text)
    );

    if (availableQuestions.length < rounds) {
      room.usedQuestionTexts.clear();
      availableQuestions = RANDOM_QUESTIONS.slice();
    }
  } else {
    // Custom Mode: Use all questions without non-repetition
    availableQuestions = RANDOM_QUESTIONS.slice();
  }

  shuffle(availableQuestions);

  const easy = availableQuestions.filter(q => q.difficulty === "easy");
  const medium = availableQuestions.filter(q => q.difficulty === "medium");
  const hard = availableQuestions.filter(q => q.difficulty === "hard");

  const result = [];

  for (let i = 0; i < rounds; i++) {
    let pool;

    if (i < Math.ceil(rounds * 0.4)) {
      pool = easy;
    } else if (i < Math.ceil(rounds * 0.75)) {
      pool = medium.length ? medium : easy;
    } else {
      pool = hard.length ? hard : medium.length ? medium : easy;
    }

    if (pool.length === 0) {
      pool = availableQuestions;
    }

    const q = pool.pop();
    if (q) {
      result.push(q);
      // Only track used questions in Standard Mode
      if (room.mode === "normal") {
        room.usedQuestionTexts.add(q.text);
      }
    }
  }

  return result;
}

export function validateCustomQuestions(customQuestions, numRounds) {
  // Step 1: Validate array structure and basic safety
  if (!Array.isArray(customQuestions)) {
    console.log(`[start_game] Invalid customQuestions: not an array`);
    return { valid: false, error: "invalid_custom_questions" };
  }
  
  // Step 2: Validate exact count (CASE 1, 6, 7, 8)
  if (customQuestions.length !== numRounds) {
    console.log(`[start_game] Question count mismatch: ${customQuestions.length} !== ${numRounds}`);
    return { valid: false, error: "invalid_custom_questions" };
  }
  
  // PART 4: Additional safety checks
  if (numRounds <= 0 || numRounds > 20) {
    console.log(`[start_game] Invalid numRounds: ${numRounds}`);
    return { valid: false, error: "invalid_custom_questions" };
  }
  
  // Step 3: Validate each question with hardened rules
  const validatedQuestions = [];
  const seenQuestions = new Set();
  
  for (let i = 0; i < customQuestions.length; i++) {
    const q = customQuestions[i];
    
    // Type check - CRITICAL security
    if (typeof q !== 'string') {
      console.log(`[start_game] Question ${i} is not a string: ${typeof q}`);
      return { valid: false, error: "invalid_custom_questions" };
    }
    
    // Clean and normalize (handle Windows line endings, multiple spaces)
    let clean = q.trim().replace(/\s+/g, ' ');
    
    // Length validation (5-120 characters)
    if (clean.length < 5) {
      console.log(`[start_game] Question ${i} too short: ${clean.length} chars`);
      return { valid: false, error: "invalid_custom_questions" };
    }
    
    if (clean.length > 120) {
      console.log(`[start_game] Question ${i} too long: ${clean.length} chars`);
      return { valid: false, error: "invalid_custom_questions" };
    }
    
    // Content validation - reject if only punctuation
    if (/^[^\w\s]*$/.test(clean)) {
      console.log(`[start_game] Question ${i} is only punctuation: "${clean}"`);
      return { valid: false, error: "invalid_custom_questions" };
    }
    
    // Duplicate check (case-insensitive)
    const normalized = clean.toLowerCase();
    if (seenQuestions.has(normalized)) {
      console.log(`[start_game] Duplicate question detected: "${clean}"`);
      return { valid: false, error: "invalid_custom_questions" };
    }
    
    seenQuestions.add(normalized);
    
    // CASE 9: HTML/Script injection protection - CRITICAL security
    const escaped = clean
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/&/g, '&amp;'); // Additional ampersand escaping
    
    validatedQuestions.push({
      text: escaped,
      difficulty: "custom"
    });
  }
  
  // Final safety check - PART 5: SERVER STATE SAFETY
  if (validatedQuestions.length !== numRounds) {
    console.log(`[start_game] Final validation failed: ${validatedQuestions.length} !== ${numRounds}`);
    return { valid: false, error: "invalid_custom_questions" };
  }
  
  return { valid: true, questions: validatedQuestions };
}

// Initialize on load
reloadQuestionsFromFile();
