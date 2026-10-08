// Store-local Monday midnight, converted to UTC without a fixed offset (DST-safe).
export function startOfStoreWeek(at: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = (date: Date) =>
    Object.fromEntries(
      formatter.formatToParts(date).map((p) => [p.type, p.value]),
    );
  const p = parts(at),
    date = new Date(
      Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)),
    );
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const target = date.getTime();
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const v = parts(new Date(guess));
    const local = Date.UTC(
      Number(v.year),
      Number(v.month) - 1,
      Number(v.day),
      Number(v.hour),
      Number(v.minute),
      Number(v.second),
    );
    if (local === target) return new Date(guess).toISOString();
    guess += target - local;
  }
  throw new Error("Unable to resolve store calendar boundary");
}
