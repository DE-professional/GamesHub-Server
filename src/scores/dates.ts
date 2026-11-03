// Puzzle dates travel as "YYYY-MM-DD" (UTC). Prisma represents a DATE column as a Date at
// midnight UTC; these convert between the two.
export function toUtcDateString(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function fromUtcDateString(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
}