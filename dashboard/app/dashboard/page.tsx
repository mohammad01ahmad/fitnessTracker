import { supabase } from "@/db/client";
import { ActivityRing, WeeklyBars, MonthlyHeatmap, DateStrip } from "./widgets";
import { CALORIE_TARGET, PROTEIN_TARGET } from "@/constants/constants";
import { addDays, aggregateMeals } from "@/utility/hooks";

// Server component: fetches all meals, aggregates them for the date in
// ?date=, and lays out the bento grid. No client JS on this page.
export default async function Dashboard({ searchParams }: { searchParams: Promise<{ date?: string }>; }) {
    const { data, error } = await supabase
        .from("meals")
        .select("created_at, calories, protein_g");

    if (error) {
        return <div className="p-8 text-red-600">Failed to load meals: {error.message}</div>;
    }

    const params = await searchParams;
    const { selected, today, weekStart, weekDays, monthCells, monthLabel } = aggregateMeals(data ?? [], params.date);

    return (
        <div className="bg-[#E7E5EE] p-4 md:h-dvh md:overflow-hidden md:p-6">
            <style>{`
                .dashboard-grid { display: grid; gap: 0.75rem; }
                @media (min-width: 768px) {
                    .dashboard-grid {
                        height: 100%;
                        grid-template-columns: repeat(4, minmax(0, 1fr));
                        grid-template-rows: 0.9fr 1.05fr 1.05fr;
                        grid-template-areas:
                            "rc rp dd dd"
                            "wc wc wp wp"
                            "mc mc mp mp";
                    }
                    .dashboard-grid > * { min-height: 0; }
                    .area-rc { grid-area: rc; }
                    .area-rp { grid-area: rp; }
                    .area-dd { grid-area: dd; }
                    .area-wc { grid-area: wc; }
                    .area-wp { grid-area: wp; }
                    .area-mc { grid-area: mc; }
                    .area-mp { grid-area: mp; }
                }
            `}</style>
            <div className="dashboard-grid mx-auto max-w-4xl md:h-full">
                <div className="area-rc">
                    <ActivityRing
                        label="Calories"
                        badge="🔥"
                        value={today.calories}
                        target={CALORIE_TARGET}
                        unit=" kcal"
                        color="#FF5A4E"
                        colorOver="#B33328"
                    />
                </div>
                <div className="area-rp">
                    <ActivityRing
                        label="Protein"
                        badge="🥩"
                        value={today.protein_g}
                        target={PROTEIN_TARGET}
                        unit="g"
                        color="#1FAE8E"
                        colorOver="#12806A"
                    />
                </div>

                <div className="area-dd">
                    <DateStrip
                        monthLabel={monthLabel}
                        selected={selected}
                        weekDays={weekDays}
                        prevHref={`?date=${addDays(weekStart, -7)}`}
                        nextHref={`?date=${addDays(weekStart, 7)}`}
                    />
                </div>

                <div className="area-wc">
                    <WeeklyBars
                        title="This week · Calories"
                        badge="🔥"
                        color="#FF5A4E"
                        target={CALORIE_TARGET}
                        selected={selected}
                        days={weekDays.map((d) => ({ date: d.date, value: d.calories }))}
                    />
                </div>
                <div className="area-wp">
                    <WeeklyBars
                        title="This week · Protein"
                        badge="🥩"
                        color="#1FAE8E"
                        target={PROTEIN_TARGET}
                        selected={selected}
                        days={weekDays.map((d) => ({ date: d.date, value: d.protein_g }))}
                    />
                </div>

                <div className="area-mc">
                    <MonthlyHeatmap
                        title="This month · Calories"
                        badge="🔥"
                        color="#FF5A4E"
                        target={CALORIE_TARGET}
                        selected={selected}
                        monthLabel={monthLabel}
                        cells={monthCells.map((c) => ({ date: c.date, value: c.calories }))}
                    />
                </div>
                <div className="area-mp">
                    <MonthlyHeatmap
                        title="This month · Protein"
                        badge="🥩"
                        color="#1FAE8E"
                        target={PROTEIN_TARGET}
                        selected={selected}
                        monthLabel={monthLabel}
                        cells={monthCells.map((c) => ({ date: c.date, value: c.protein_g }))}
                    />
                </div>
            </div>
        </div>
    );
}
