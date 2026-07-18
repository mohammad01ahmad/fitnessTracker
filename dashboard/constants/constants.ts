// Sum of one day's logged meals.
export type DayTotals = { calories: number; protein_g: number };
// Shape of a row fetched from `meals` for dashboard aggregation.
export type MealRow = { created_at: string | null; calories: number | null; protein_g: number | null };

// Fixed daily targets the rings/bars/heatmap are measured against.
export const CALORIE_TARGET = 3000;
export const PROTEIN_TARGET = 120;

// Indexed by Date#getUTCMonth() for the date widget's month header.
export const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

// Sunday-first day-of-week initials, shared by the week strip and bars.
export const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];