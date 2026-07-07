import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const text = fs.readFileSync(filePath, "utf8");
  text.split(/\r?\n/u).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) return;

    const [, key, rawValue] = match;
    if (process.env[key]) return;

    process.env[key] = rawValue.trim().replace(/^['"]|['"]$/gu, "");
  });
}

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function fetchAllRows(supabase, table, columns) {
  const rows = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);

    if (error) throw error;

    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function fetchAllUsers(admin) {
  const users = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }

  return users;
}

function ensureUser(summaryByUserId, userId) {
  if (!summaryByUserId.has(userId)) {
    summaryByUserId.set(userId, {
      userId,
      email: "",
      profileStoredTotalCardsPulled: 0,
      profileStoredPacksOpened: 0,
      collectionQuantitySum: 0,
      uniqueCollectionCards: 0,
      packOpenEventCount: 0,
      totalCardsPulledMatchesCollection: true,
      packsOpenedMatchesEvents: true,
    });
  }

  return summaryByUserId.get(userId);
}

async function main() {
  readEnvFile(path.join(process.cwd(), ".env"));
  readEnvFile(path.join(process.cwd(), "mobile-app", ".env"));

  const supabaseUrl = getArg("--supabase-url") || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey =
    getArg("--service-role-key") ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.PACKDEX_SERVICE_ROLE_KEY ||
    process.env.SERVICE_ROLE_KEY;
  const outputPath = getArg("--output", path.join("reports", "profile-stats-audit.json"));

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase URL or service role key. Provide --supabase-url and --service-role-key, or set Supabase service role env vars.");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const [users, profileStatsRows, collectionRows, packOpenRows] = await Promise.all([
    fetchAllUsers(admin),
    fetchAllRows(admin, "user_profile_stats", "user_id,packs_opened,total_cards_pulled"),
    fetchAllRows(admin, "user_collection", "user_id,set_id,card_id,quantity"),
    fetchAllRows(admin, "user_pack_open_events", "user_id,id"),
  ]);

  const summaryByUserId = new Map();

  users.forEach((user) => {
    const summary = ensureUser(summaryByUserId, user.id);
    summary.email = user.email || "";
  });

  profileStatsRows.forEach((row) => {
    const summary = ensureUser(summaryByUserId, row.user_id);
    summary.profileStoredPacksOpened = Number(row.packs_opened || 0);
    summary.profileStoredTotalCardsPulled = Number(row.total_cards_pulled || 0);
  });

  collectionRows.forEach((row) => {
    const summary = ensureUser(summaryByUserId, row.user_id);
    const quantity = Number(row.quantity || 0);
    if (Number.isFinite(quantity) && quantity > 0) summary.collectionQuantitySum += quantity;
    if (row.set_id && row.card_id) summary.uniqueCollectionCards += 1;
  });

  packOpenRows.forEach((row) => {
    const summary = ensureUser(summaryByUserId, row.user_id);
    summary.packOpenEventCount += 1;
  });

  const usersReport = [...summaryByUserId.values()].map((summary) => ({
    ...summary,
    totalCardsPulledMatchesCollection: summary.profileStoredTotalCardsPulled === summary.collectionQuantitySum,
    packsOpenedMatchesEvents: summary.profileStoredPacksOpened === summary.packOpenEventCount,
  }));

  const mismatchedUsers = usersReport.filter((user) => !user.totalCardsPulledMatchesCollection || !user.packsOpenedMatchesEvents);
  const result = {
    generatedAt: new Date().toISOString(),
    totals: {
      usersAudited: usersReport.length,
      profileRows: profileStatsRows.length,
      collectionRows: collectionRows.length,
      packOpenEventRows: packOpenRows.length,
      usersWithAnyMismatch: mismatchedUsers.length,
      usersWithTotalCardsPulledMismatch: usersReport.filter((user) => !user.totalCardsPulledMatchesCollection).length,
      usersWithPacksOpenedMismatch: usersReport.filter((user) => !user.packsOpenedMatchesEvents).length,
    },
    users: usersReport,
    mismatchedUsers,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);

  console.log(`Wrote ${outputPath}`);
  console.log(JSON.stringify(result.totals, null, 2));

  for (const user of mismatchedUsers.slice(0, 20)) {
    console.log(
      [
        user.email || user.userId,
        `profileTotal=${user.profileStoredTotalCardsPulled}`,
        `collectionTotal=${user.collectionQuantitySum}`,
        `profilePacks=${user.profileStoredPacksOpened}`,
        `eventPacks=${user.packOpenEventCount}`,
        `unique=${user.uniqueCollectionCards}`,
      ].join(" | ")
    );
  }

  if (mismatchedUsers.length > 20) {
    console.log(`...and ${mismatchedUsers.length - 20} more mismatched users.`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
