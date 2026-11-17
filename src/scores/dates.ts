// Puzzle dates travel as "YYYY-MM-DD" (UTC). Prisma represents a DATE column as a Date at
// midnight UTC; these convert between the two.
export function toUtcDateString(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function fromUtcDateString(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// So that puzzles completed shortly after the rollover aren't rejected
const GRACE_PERIOD_MS = 60 * 60 * 1000;

// UTC puzzle dates that are open right now: today, plus yesterday during the grace period.
// Scores can be submitted, and server-picked puzzles fetched, only for these dates.
export function openPuzzleDates(now: Date): Set<string> {
    return new Set([toUtcDateString(now), toUtcDateString(new Date(now.getTime() - GRACE_PERIOD_MS))]);
}

// The puzzle date after a "YYYY-MM-DD" date.
export function nextUtcDateString(value: string): string {
    return toUtcDateString(new Date(fromUtcDateString(value).getTime() + DAY_MS));
}
