import { MONTH_NAMES } from "@/constants/constants";
import type { DayTotals, MealRow } from "@/constants/constants";

// meals.created_at is UTC; every date here is a YYYY-MM-DD UTC day string,
// matching the existing byDay grouping this page already did.

// Date -> "YYYY-MM-DD" (UTC).
export function toDateStr(d: Date) {
    return d.toISOString().slice(0, 10);
}
// "YYYY-MM-DD" -> Date at UTC midnight.
export function fromDateStr(s: string) {
    return new Date(`${s}T00:00:00.000Z`);
}
// Shift a "YYYY-MM-DD" string by n days (UTC), n may be negative.
export function addDays(s: string, n: number) {
    const d = fromDateStr(s);
    d.setUTCDate(d.getUTCDate() + n);
    return toDateStr(d);
}

// Turns raw meal rows + the selected-date search param into everything the
// dashboard widgets need: today's totals, the containing week, and the
// containing month's calendar-grid cells (leading blanks included).
export function aggregateMeals(rows: MealRow[], dateParam: string | undefined) {
    // Per-day totals, keyed by "YYYY-MM-DD".
    const byDay = new Map<string, DayTotals>();
    for (const meal of rows) {
        if (!meal.created_at) continue;
        const day = meal.created_at.slice(0, 10);
        const totals = byDay.get(day) ?? { calories: 0, protein_g: 0 };
        totals.calories += meal.calories ?? 0;
        totals.protein_g += meal.protein_g ?? 0;
        byDay.set(day, totals);
    }

    // Selected day defaults to today; falls back to zero totals if unlogged.
    const selected = dateParam ?? toDateStr(new Date());
    const selectedDate = fromDateStr(selected);
    const today = byDay.get(selected) ?? { calories: 0, protein_g: 0 };

    // Sunday-start week containing the selected day, for the week strip/bars.
    const weekStart = addDays(selected, -selectedDate.getUTCDay());
    const weekDays = Array.from({ length: 7 }, (_, i) => {
        const date = addDays(weekStart, i);
        const totals = byDay.get(date) ?? { calories: 0, protein_g: 0 };
        return { date, day: Number(date.slice(8, 10)), ...totals };
    });

    // Calendar grid for the selected day's month, with leading blank cells
    // so the first day lines up under the correct weekday column.
    const year = selectedDate.getUTCFullYear();
    const month = selectedDate.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const leadingBlanks = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const monthCells = [
        ...Array.from({ length: leadingBlanks }, () => ({ date: null as string | null, calories: 0, protein_g: 0 })),
        ...Array.from({ length: daysInMonth }, (_, i) => {
            const date = toDateStr(new Date(Date.UTC(year, month, i + 1)));
            const totals = byDay.get(date) ?? { calories: 0, protein_g: 0 };
            return { date, ...totals };
        }),
    ];
    const monthLabel = `${MONTH_NAMES[month]} ${year}`;

    return { selected, today, weekStart, weekDays, monthCells, monthLabel };
}