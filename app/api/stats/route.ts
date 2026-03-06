import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, artistsDiscovered, tracksDiscovered, playlistsCreated, genres } = body;

    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    // Check yesterday's row to calculate streak
    const { data: yesterdayRow } = await supabase
      .from("discovery_stats")
      .select("streak")
      .eq("email", email)
      .eq("dig_date", yesterday)
      .maybeSingle();

    const streak = yesterdayRow ? yesterdayRow.streak + 1 : 1;

    // Upsert today's row
    const { data, error } = await supabase
      .from("discovery_stats")
      .upsert(
        {
          email,
          dig_date: today,
          artists_discovered: artistsDiscovered ?? 0,
          tracks_discovered: tracksDiscovered ?? 0,
          playlists_created: playlistsCreated ?? 0,
          genres_found: genres ?? [],
          streak,
        },
        { onConflict: "email,dig_date" }
      )
      .select()
      .single();

    if (error) {
      console.error("Failed to upsert discovery_stats:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, stats: data });
  } catch (err: unknown) {
    console.error("POST /api/stats error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const email = req.nextUrl.searchParams.get("email");

    if (!email) {
      return NextResponse.json({ error: "email query param is required" }, { status: 400 });
    }

    const { data: rows, error } = await supabase
      .from("discovery_stats")
      .select("*")
      .eq("email", email)
      .order("dig_date", { ascending: true });

    if (error) {
      console.error("Failed to fetch discovery_stats:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        totalArtists: 0,
        totalTracks: 0,
        totalDigs: 0,
        currentStreak: 0,
        longestStreak: 0,
        topGenres: [],
        memberSince: null,
      });
    }

    // Aggregate totals
    let totalArtists = 0;
    let totalTracks = 0;
    let longestStreak = 0;
    const genreCounts: Record<string, number> = {};

    for (const row of rows) {
      totalArtists += row.artists_discovered;
      totalTracks += row.tracks_discovered;
      if (row.streak > longestStreak) longestStreak = row.streak;
      for (const genre of row.genres_found ?? []) {
        genreCounts[genre] = (genreCounts[genre] || 0) + 1;
      }
    }

    // Current streak: check today first, then yesterday
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    const todayRow = rows.find((r) => r.dig_date === today);
    const yesterdayRow = rows.find((r) => r.dig_date === yesterday);
    const currentStreak = todayRow
      ? todayRow.streak
      : yesterdayRow
        ? yesterdayRow.streak
        : 0;

    // Top 5 genres by frequency
    const topGenres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([genre]) => genre);

    const memberSince = rows[0].created_at;

    // Taste evolution: first dig vs latest dig genres
    const firstGenres = rows[0].genres_found ?? [];
    const latestGenres = rows[rows.length - 1].genres_found ?? [];

    return NextResponse.json({
      totalArtists,
      totalTracks,
      totalDigs: rows.length,
      currentStreak,
      longestStreak,
      topGenres,
      memberSince,
      firstGenres,
      latestGenres,
    });
  } catch (err: unknown) {
    console.error("GET /api/stats error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
