#!/usr/bin/env node
// Orchestrator for claude-usage-report skill.
// Usage:
//   node run.js --since 2026-04-01 --until 2026-05-01 --out ~/Desktop/report.xlsx
//
// Pipeline: extract → summarize → build-xlsx.

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const args = parseArgs(process.argv.slice(2));
const SINCE = args.since;
const UNTIL = args.until;
const OUT = args.out ? expandHome(args.out) : path.join(os.homedir(), `Desktop/claude-usage-${SINCE}_to_${UNTIL}.xlsx`);
const CONCURRENCY = parseInt(args.concurrency || "6", 10);

if (!SINCE || !UNTIL) {
  console.error("Usage: run.js --since YYYY-MM-DD --until YYYY-MM-DD [--out PATH] [--concurrency N]");
  process.exit(2);
}

const SKILL_ROOT = path.dirname(path.dirname(path.resolve(__filename)));
const CACHE_DIR = path.join(SKILL_ROOT, "cache");
const PROMPT = "下面是一次 Claude Code 会话里用户依次说过的所有话。请用 30 字以内的一句中文，准确概括这个会话实际做了什么（侧重最终任务，不是寒暄/插曲）。只输出总结本身，不要加引号、前缀、解释、emoji。";
fs.mkdirSync(CACHE_DIR, { recursive: true });
const TMP_SESSIONS = path.join(os.tmpdir(), `claude-usage-sessions-${SINCE}_${UNTIL}.json`);

console.log(`[1/3] Extracting sessions from ~/.claude/projects/ between ${SINCE} and ${UNTIL} ...`);
const sessions = extractSessions(SINCE, UNTIL);
console.log(`  Found ${sessions.length} sessions, ${sumTokens(sessions)/1e6 | 0}M tokens.`);
fs.writeFileSync(TMP_SESSIONS, JSON.stringify(sessions, null, 2));

console.log(`[2/4] Summarizing each session via Haiku (concurrency ${CONCURRENCY}) ...`);
(async () => {
  await summarizeAll(sessions, CONCURRENCY);

  console.log(`[3/4] Fetching ccusage ground-truth for the same period ...`);
  const cc = await fetchCcusage(SINCE, UNTIL);
  const scriptTokens = sumTokens(sessions);
  const totalCostUSD = cc ? cc.cost : estimateCost(sessions);

  // Persist enriched sessions for python step
  fs.writeFileSync(TMP_SESSIONS, JSON.stringify({
    since: SINCE, until: UNTIL, total_cost: totalCostUSD,
    total_tokens: scriptTokens, sessions
  }, null, 2));

  console.log(`[4/4] Building XLSX → ${OUT}`);
  const py = path.join(SKILL_ROOT, "scripts/build-xlsx.py");
  const result = spawnSync("python3", [py, "--in", TMP_SESSIONS, "--out", OUT], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error("XLSX build failed. Ensure openpyxl is installed: pip3 install --user openpyxl");
    process.exit(1);
  }

  // ===== Validation against ccusage =====
  const days = new Set(sessions.map(s => s.date || s.firstTs.slice(0,10)));
  const uniqueSessions = new Set(sessions.map(s => s.sessionFile));
  console.log("\n======== 校验 / Validation ========");
  console.log(`脚本统计 (this report): ${sessions.length} 行（${uniqueSessions.size} 个 session 跨 ${days.size} 天，多日 session 已按天拆分）· ${(scriptTokens/1e6).toFixed(1)}M tokens`);

  if (cc) {
    const tokDelta = scriptTokens - cc.tokens;
    const tokDeltaPct = cc.tokens > 0 ? (tokDelta / cc.tokens * 100) : 0;
    console.log(`ccusage daily       : ${(cc.tokens/1e6).toFixed(1)}M tokens · $${cc.cost.toFixed(2)}`);
    const sign = tokDelta >= 0 ? "+" : "";
    console.log(`Token 差异          : ${sign}${(tokDelta/1e6).toFixed(1)}M (${sign}${tokDeltaPct.toFixed(1)}%)`);
    console.log(`成本                : $${cc.cost.toFixed(2)}  (本报表里的 cost 列已按 ccusage 总额、按 token 占比反推分摊)`);
    if (Math.abs(tokDeltaPct) > 10) {
      console.log("\n⚠️  token 差异超过 10%。可能原因：");
      console.log("    - JSONL 里有 ccusage 没识别的事件类型");
      console.log("    - 去重逻辑过滤了 ccusage 计入的消息");
      console.log("    - 跨月会话边界处理不一致");
    } else {
      console.log(`\n✓ 差异在 10% 以内，可视为对得上 ccusage。`);
    }
  } else {
    console.log(`ccusage daily       : 未能获取（npx ccusage 不可用？）`);
    console.log(`成本                : $${totalCostUSD.toFixed(2)}  (使用 fallback 校准率 ~$0.7/M token，非权威)`);
    console.log("\n⚠️  没有 ccusage 作对照，cost 列仅为粗略估算。建议安装 ccusage 后重跑：npm i -g ccusage");
  }

  // ===== Final output location (printed LAST so user sees it most prominently) =====
  console.log("\n========================================");
  console.log(`📊 报表已生成: ${OUT}`);
  console.log("========================================");
})().catch(e => { console.error(e); process.exit(1); });

// =============== helpers ===============
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      const v = argv[i+1] && !argv[i+1].startsWith("--") ? argv[++i] : "true";
      o[k] = v;
    }
  }
  return o;
}

function expandHome(p) {
  return p.replace(/^~(?=$|\/|\\)/, os.homedir());
}

function sumTokens(arr) { return arr.reduce((a,s)=>a+s.tokens,0); }

function isRealUserMsg(ev) {
  if (ev.type !== "user" || ev.isMeta) return false;
  if (!ev.message || !ev.message.content) return false;
  const c = ev.message.content;
  if (typeof c === "string") return c.trim() && !c.startsWith("<");
  if (Array.isArray(c)) return c.some(p => p && p.type === "text" && p.text && p.text.trim() && !p.text.startsWith("<") && !p.text.startsWith("Caveat"));
  return false;
}
function userText(ev) {
  const c = ev.message.content;
  if (typeof c === "string") return c;
  return c.filter(p=>p && p.type==="text").map(p=>p.text).join(" ");
}

function extractSessions(since, until) {
  // Emits one entry per (session-file, date) pair.
  // A multi-day session shows as multiple rows, each row scoped to its own date.
  // This avoids the bug where a session started on 4/3 and ended on 4/5 would
  // attribute all its tokens to 4/3 and leave 4/4, 4/5 looking empty.
  const ROOT = path.join(os.homedir(), ".claude/projects");
  if (!fs.existsSync(ROOT)) {
    console.error(`Not found: ${ROOT}`);
    process.exit(1);
  }
  const out = [];
  for (const slug of fs.readdirSync(ROOT)) {
    const dir = path.join(ROOT, slug);
    let stat; try { stat = fs.statSync(dir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const lines = fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(x=>x.trim());
      let cwd = null, branch = null;
      const buckets = new Map(); // YYYY-MM-DD -> { tokens, userMsgs, userMsgTimes, eventTimes }
      const seen = new Set();    // session-wide message.id dedup
      for (const ln of lines) {
        let ev; try { ev = JSON.parse(ln); } catch { continue; }
        if (ev.cwd && !cwd) cwd = ev.cwd;
        if (ev.gitBranch && !branch) branch = ev.gitBranch;
        const ts = ev.timestamp;
        if (!ts || ts < since || ts >= until) continue;
        const date = ts.slice(0, 10);
        let b = buckets.get(date);
        if (!b) {
          b = { tokens: 0, userMsgs: [], userMsgTimes: [], eventTimes: [] };
          buckets.set(date, b);
        }
        b.eventTimes.push(ts);
        if (isRealUserMsg(ev)) {
          b.userMsgs.push(userText(ev).trim().replace(/\s+/g, " "));
          b.userMsgTimes.push(ts);
        }
        if (ev.type === "assistant" && ev.message && ev.message.usage && ev.message.id) {
          if (seen.has(ev.message.id)) continue;
          seen.add(ev.message.id);
          const u = ev.message.usage;
          b.tokens += (u.input_tokens||0) + (u.output_tokens||0) + (u.cache_creation_input_tokens||0) + (u.cache_read_input_tokens||0);
        }
      }
      const sessionFile = f.replace(".jsonl", "");
      const datesWithUserMsg = new Set(
        [...buckets.entries()].filter(([, b]) => b.userMsgs.length > 0).map(([d]) => d)
      );
      for (const [date, b] of buckets) {
        // Lower threshold for per-day buckets (one session split into N days, each day is smaller).
        if (b.tokens < 50e3) continue;
        b.eventTimes.sort();
        const firstTs = b.eventTimes[0];
        const lastTs = b.eventTimes[b.eventTimes.length - 1];
        out.push({
          date,
          firstTs,
          lastTs,
          cwd, branch,
          tokens: b.tokens,
          userMsgs: b.userMsgs,
          sessionFile,
          // True if this date has zero new user messages but is part of a session that
          // had user messages on an earlier date — i.e., agent/tool continuation.
          isContinuation: b.userMsgs.length === 0 && datesWithUserMsg.size > 0,
        });
      }
    }
  }
  return out;
}

function sessionKey(s) {
  // Include date so the same session split across N days has N independent cache entries.
  return crypto.createHash("md5")
    .update((s.date||"") + "|" + s.firstTs + "|" + (s.cwd||"") + "|" + s.userMsgs.slice(0,3).join("|"))
    .digest("hex").slice(0,16);
}

function buildPrompt(userMsgs) {
  const msgs = userMsgs.slice(0, 40).map((m,i)=>`${i+1}. ${m.slice(0,300)}`).join("\n");
  return msgs.length > 10000 ? msgs.slice(0, 10000) + "..." : msgs;
}

function summarizeOnce(s, timeoutMs) {
  return new Promise(resolve => {
    const proc = spawn("claude", ["-p", "--model", "claude-haiku-4-5", PROMPT], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let out = "", err = "";
    proc.stdout.on("data", d => out += d);
    proc.stderr.on("data", d => err += d);
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.on("close", code => {
      clearTimeout(timer);
      const text = out.trim().split("\n")[0].slice(0, 80);
      if (code !== 0 || !text) {
        resolve({ ok: false, err: (err.slice(0,80) || "timeout/empty") });
      } else {
        resolve({ ok: true, text });
      }
    });
    proc.stdin.write(buildPrompt(s.userMsgs));
    proc.stdin.end();
  });
}

// Try up to 3 attempts with growing timeouts. Returns { ok, text|err }.
async function summarizeOne(s) {
  const attempts = [60000, 120000, 180000];
  let last;
  for (const t of attempts) {
    last = await summarizeOnce(s, t);
    if (last.ok) return last;
  }
  return last;
}

async function summarizeAll(sessions, concurrency) {
  const total = sessions.length;
  let done = 0, fromCache = 0, skipped = 0;
  let idx = 0;
  const next = async () => {
    while (idx < sessions.length) {
      const i = idx++;
      const s = sessions[i];
      // For continuation days (no new user messages, just agent background work),
      // skip the Haiku call entirely and use a placeholder.
      if (s.isContinuation) {
        s.summary = "(同会话延续：当日由 agent/tool 后台产生，无新用户消息)";
        skipped++;
        done++;
        continue;
      }
      const key = sessionKey(s);
      const cachePath = path.join(CACHE_DIR, key + ".txt");
      if (fs.existsSync(cachePath)) {
        const cached = fs.readFileSync(cachePath, "utf8").trim();
        // Skip cache entries that recorded a failure — they should be retried.
        if (cached && !cached.startsWith("(summary failed")) {
          s.summary = cached;
          fromCache++;
          done++;
          if (done % 5 === 0 || done === total) {
            process.stderr.write(`\r  progress: ${done}/${total} (${fromCache} from cache, ${skipped} continuation)`);
          }
          continue;
        }
      }
      const res = await summarizeOne(s);
      if (res.ok) {
        s.summary = res.text;
        fs.writeFileSync(cachePath, s.summary);
      } else {
        // Don't cache failures — leave the entry blank so a future run retries.
        s.summary = "(summary failed: " + res.err + ")";
      }
      done++;
      if (done % 5 === 0 || done === total) {
        process.stderr.write(`\r  progress: ${done}/${total} (${fromCache} from cache, ${skipped} continuation)`);
      }
    }
  };
  await Promise.all(Array(concurrency).fill(0).map(next));
  process.stderr.write("\n");
}

async function fetchCcusage(since, until) {
  const sinceCompact = since.replace(/-/g, "");
  const untilCompact = compactPrev(until);
  return new Promise(resolve => {
    const p = spawn("npx", ["-y", "ccusage@latest", "daily", "--since", sinceCompact, "--until", untilCompact, "--json"], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "";
    p.stdout.on("data", d => out += d);
    p.on("error", () => resolve(null));
    p.on("close", () => {
      try {
        const j = JSON.parse(out);
        const cost = j?.totals?.totalCost;
        const tokens = j?.totals?.totalTokens;
        if (typeof cost === "number" && cost > 0) {
          resolve({ cost, tokens: tokens || 0 });
        } else resolve(null);
      } catch { resolve(null); }
    });
  });
}

function compactPrev(d) {
  // until-1day compact (YYYY-MM-DD -> YYYYMMDD inclusive)
  const dt = new Date(d);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0,10).replace(/-/g,"");
}

// Fallback cost estimate used only when ccusage isn't installed.
// $/M-tokens, blended across a typical Opus/Sonnet/Haiku mix with cache discounts.
// Override at runtime with CLAUDE_REPORT_USD_PER_M=0.7 if your usage profile differs.
const FALLBACK_USD_PER_M = parseFloat(process.env.CLAUDE_REPORT_USD_PER_M || "0.7");
function estimateCost(sessions) {
  return sumTokens(sessions) / 1e6 * FALLBACK_USD_PER_M;
}
