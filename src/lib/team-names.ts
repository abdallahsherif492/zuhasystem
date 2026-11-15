/**
 * Team members' names as the team says them, in Arabic: kept in the
 * business's theme_config.team_names ({ email: "عبدالرحمن" }) and set from
 * Team → edit member. Anywhere a person is named by their email, this gives
 * the name instead, or the part before the @ when none was set.
 *
 * The active business's names are put here by BusinessProvider as it
 * renders, so plain functions can use them without a hook.
 */

let names: Record<string, string> = {};

export function setTeamNames(map: Record<string, string> | null | undefined) {
    const next: Record<string, string> = {};
    for (const [email, name] of Object.entries(map || {})) {
        if (email && typeof name === "string" && name.trim()) next[email.toLowerCase()] = name.trim();
    }
    names = next;
}

/** "عبدالرحمن" for abdo@..., else "abdo"; `empty` when there is no email. */
export function teamName(email: string | null | undefined, empty = ""): string {
    if (!email) return empty;
    return names[email.toLowerCase()] || email.split("@")[0];
}

/** The name set for this email, or "" when none was. */
export const savedTeamName = (email: string | null | undefined) => (email ? names[email.toLowerCase()] || "" : "");

/** theme_config with one person's name set (or removed when blank). */
export function withTeamName(themeConfig: Record<string, unknown> | null | undefined, email: string, name: string) {
    const current = { ...((themeConfig?.team_names as Record<string, string>) || {}) };
    const key = email.toLowerCase();
    if (name.trim()) current[key] = name.trim(); else delete current[key];
    return { ...(themeConfig || {}), team_names: current };
}
