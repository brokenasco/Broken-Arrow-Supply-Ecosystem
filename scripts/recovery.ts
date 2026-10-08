import { encryptedBackup, restoreForInspection } from "../src/recovery.ts";
const [mode, source, destination] = process.argv.slice(2);
if (!["backup", "restore-inspect"].includes(mode) || !source || !destination) {
  console.error(
    "Usage: npm run recovery -- backup|restore-inspect SOURCE NEW_DESTINATION",
  );
  process.exitCode = 1;
} else {
  try {
    const result =
      mode === "backup"
        ? await encryptedBackup(
            source,
            destination,
            process.env.BACKUP_KEY ?? "",
          )
        : restoreForInspection(
            source,
            destination,
            process.env.BACKUP_KEY ?? "",
          );
    console.log(
      JSON.stringify({
        ...result,
        purpose:
          "Offline administrator recovery; no production readiness asserted",
        ...(mode === "restore-inspect"
          ? {
              warning:
                "Inspection copy only. Do not start workers or connect providers against restored state.",
            }
          : {}),
      }),
    );
  } catch {
    console.error(
      "Recovery failed. Check key, paths, schema and integrity. Existing destinations are never overwritten.",
    );
    process.exitCode = 1;
  }
}
