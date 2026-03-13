#!/usr/bin/env node
/**
 * CLAWeb frontdoor history migration
 *
 * Migrates legacy per-identity JSONL files (e.g. `demo-user-b.jsonl`) into the new
 * keyed naming scheme: `{userId}__{roomId}__{clientId}.jsonl`.
 *
 * It also normalizes records into the minimal raw-history shape expected by
 * `docs/state-model.md`, adding a stable `_idx` tie-break.
 *
 * Usage:
 *   node scripts/migrate-history.js --dir /var/lib/claweb-example/history
 *
 * Safety:
 * - Creates a backup directory: `<dir>.migrated.<YYYYMMDD-HHMMSS>`
 * - Does NOT delete legacy files.
 */

import fs from "node:fs";
import path from "node:path";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function nowTag() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(
    d.getMinutes(),
  )}${pad2(d.getSeconds())}`;
}

function safeSegment(s) {
  return String(s || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 128);
}

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  const out = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object") out.push(obj);
    } catch {
      // ignore
    }
  }
  return out;
}

function countExistingLines(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const raw = fs.readFileSync(filePath, "utf8");
  return raw.split("\n").filter(Boolean).length;
}

function writeAppendJsonl(filePath, records) {
  if (records.length === 0) return;
  fs.appendFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

function parseArgs(argv) {
  const args = { dir: "" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") {
      args.dir = argv[++i] || "";
    }
  }
  return args;
}

function main() {
  const { dir } = parseArgs(process.argv);
  if (!dir) {
    console.error("missing --dir");
    process.exit(2);
  }

  const absDir = path.resolve(dir);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    console.error("not a dir:", absDir);
    process.exit(2);
  }

  const backupDir = `${absDir}.migrated.${nowTag()}`;
  fs.mkdirSync(backupDir, { recursive: true });

  // backup everything for safety
  for (const name of fs.readdirSync(absDir)) {
    const src = path.join(absDir, name);
    const dst = path.join(backupDir, name);
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, dst);
    }
  }

  console.log("backup ->", backupDir);

  const files = fs
    .readdirSync(absDir)
    .filter((f) => f.endsWith(".jsonl"))
    // avoid re-migrating already-keyed files (best-effort)
    .filter((f) => !f.includes("__"));

  let migrated = 0;

  for (const file of files) {
    const srcPath = path.join(absDir, file);
    const legacy = readJsonl(srcPath);

    // group into keyed targets based on fields present
    const byTarget = new Map();
    for (const item of legacy) {
      const userId = safeSegment(item.userId);
      const roomId = safeSegment(item.roomId || "direct");
      const clientId = safeSegment(item.clientId);
      if (!userId || !clientId) continue;
      const outName = `${userId}__${roomId}__${clientId}.jsonl`;
      if (!byTarget.has(outName)) byTarget.set(outName, []);
      byTarget.get(outName).push(item);
    }

    for (const [outName, items] of byTarget.entries()) {
      const outPath = path.join(absDir, outName);
      const startIdx = countExistingLines(outPath);
      let local = 0;

      const normalized = items.map((m) => {
        local += 1;
        return {
          role: String(m.role || "system"),
          text: String(m.text || ""),
          ts: Number(m.ts || Date.now()),
          messageId: m.messageId || null,
          _idx: startIdx + local,
        };
      });

      writeAppendJsonl(outPath, normalized);
      console.log("migrated ->", outName, "from", file, "lines", items.length);
      migrated += items.length;
    }
  }

  console.log("done. migrated lines:", migrated);
}

main();
