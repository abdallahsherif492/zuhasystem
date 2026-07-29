import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { previewShippingSyncAction, previewBostaShippingSyncAction, applyShippingUpdatesAction, previewGenericShippingSyncAction } from '@/app/(dashboard)/orders/sync-actions';
import { processOrderForVrobo } from '@/lib/vrobo/api';
import { logIntegrationActivity } from '@/lib/logs/integration-logger';
import { resolveCronCaller } from './cron-auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

export const maxDuration = 300; // Allow Vercel functions to run up to 5 minutes

// Scheduling note: vercel.json runs this once a day, because the Hobby plan
// rejects any cron more frequent than daily — and rejects the whole deployment
// with it, not just the cron. For a real interval, drive this endpoint from an
// off-platform scheduler with `Authorization: Bearer $CRON_SECRET`, or upgrade
// the plan and shorten the schedule. AutoSyncProvider still triggers it from
// the browser while someone has the dashboard open.

/** Businesses processed per run, kept low so the function cannot time out. */
const MAX_BUSINESSES_PER_RUN = 2;

/**
 * The oldest lastSyncAt across a business's integrations, used to process the
 * most neglected tenant first. Without this the per-run cap always consumed
 * the same arbitrary first businesses and the rest were never synced at all.
 */
function stalenessOf(themeConfig: any): number {
    const integrations = themeConfig?.integrations || {};
    const stamps: number[] = [];

    const collect = (cfg: any) => {
        if (!cfg?.enabled || !cfg?.autoSync) return;
        stamps.push(cfg.lastSyncAt ? new Date(cfg.lastSyncAt).getTime() : 0);
    };

    ["telegraph", "bosta", "jt", "aramex", "filtareeq"].forEach((k) => collect(integrations.shipping?.[k]));
    collect(integrations.tools?.vrobo);

    // No auto-sync enabled: sort last, there is nothing to do.
    return stamps.length === 0 ? Number.MAX_SAFE_INTEGER : Math.min(...stamps);
}

export async function GET(request: Request) {
    try {
        // This endpoint spends tenants' courier credentials, so it is never
        // open. The scheduler may sweep everyone; a signed-in user may only
        // trigger their own businesses.
        const caller = await resolveCronCaller(request);
        if (caller.kind === "denied") {
            return NextResponse.json({ success: false, error: caller.reason }, { status: 401 });
        }

        let query = supabase.from('businesses').select('id, theme_config');
        if (caller.kind === "user") {
            query = query.in('id', caller.businessIds);
        }

        const { data: allBusinesses, error } = await query;

        if (error) throw error;
        if (!allBusinesses) return NextResponse.json({ success: true, message: "No businesses found." });

        // Most-neglected first, so the per-run cap rotates fairly.
        const businesses = [...allBusinesses].sort(
            (a, b) => stalenessOf(a.theme_config) - stalenessOf(b.theme_config)
        );

        let syncedBusinessesCount = 0;
        const now = new Date();

        for (const business of businesses) {
            let configChanged = false;
            const integrations = business.theme_config?.integrations || {};

            // 1. Telegraph Auto-Sync
            const telegraphConfig = integrations.shipping?.telegraph;
            if (telegraphConfig?.enabled && telegraphConfig?.autoSync) {
                const lastSyncStr = telegraphConfig.lastSyncAt;
                const lastSync = lastSyncStr ? new Date(lastSyncStr) : new Date(0);
                const intervalMinutes = telegraphConfig.autoSyncIntervalMinutes || 15;
                
                const minutesSinceLastSync = (now.getTime() - lastSync.getTime()) / (1000 * 60);

                if (minutesSinceLastSync >= intervalMinutes) {
                    console.log(`[Auto-Sync] Running Telegraph sync for business: ${business.id}`);
                    try {
                        const { updates, error: syncError } = await previewShippingSyncAction(business.id);
                        if (!syncError && updates && updates.length > 0) {
                            await applyShippingUpdatesAction(updates, business.id, telegraphConfig.shippingCompanyId);
                            logIntegrationActivity(business.id, "Auto-Sync", "info", `Auto-Synced Telegraph: Found ${updates.length} updates.`, { results: updates });
                        }
                    } catch (e: any) {
                        console.error(`[Auto-Sync] Error in Telegraph sync for ${business.id}:`, e);
                        logIntegrationActivity(business.id, "Auto-Sync", "error", `Telegraph Auto-Sync Error: ${e.message}`);
                    }

                    // Update lastSyncAt
                    if (!integrations.shipping) integrations.shipping = {};
                    if (!integrations.shipping.telegraph) integrations.shipping.telegraph = {};
                    integrations.shipping.telegraph.lastSyncAt = now.toISOString();
                    configChanged = true;
                }
            }

            // 2. Bosta Auto-Sync
            const bostaConfig = integrations.shipping?.bosta;
            if (bostaConfig?.enabled && bostaConfig?.autoSync) {
                const lastSyncStr = bostaConfig.lastSyncAt;
                const lastSync = lastSyncStr ? new Date(lastSyncStr) : new Date(0);
                const intervalMinutes = bostaConfig.autoSyncIntervalMinutes || 15;
                
                const minutesSinceLastSync = (now.getTime() - lastSync.getTime()) / (1000 * 60);

                if (minutesSinceLastSync >= intervalMinutes) {
                    console.log(`[Auto-Sync] Running Bosta sync for business: ${business.id}`);
                    try {
                        const { updates, error: syncError } = await previewBostaShippingSyncAction(business.id);
                        if (!syncError && updates && updates.length > 0) {
                            await applyShippingUpdatesAction(updates, business.id, bostaConfig.shippingCompanyId);
                            logIntegrationActivity(business.id, "Auto-Sync", "info", `Auto-Synced Bosta: Found ${updates.length} updates.`, { results: updates });
                        }
                    } catch (e: any) {
                        console.error(`[Auto-Sync] Error in Bosta sync for ${business.id}:`, e);
                        logIntegrationActivity(business.id, "Auto-Sync", "error", `Bosta Auto-Sync Error: ${e.message}`);
                    }

                    // Update lastSyncAt
                    if (!integrations.shipping) integrations.shipping = {};
                    if (!integrations.shipping.bosta) integrations.shipping.bosta = {};
                    integrations.shipping.bosta.lastSyncAt = now.toISOString();
                    configChanged = true;
                }
            }

            const runGenericSync = async (providerKey: "jt" | "aramex" | "filtareeq", providerName: string) => {
                const config = integrations.shipping?.[providerKey];
                if (config?.enabled && config?.autoSync) {
                    const lastSyncStr = config.lastSyncAt;
                    const lastSync = lastSyncStr ? new Date(lastSyncStr) : new Date(0);
                    const intervalMinutes = config.autoSyncIntervalMinutes || 15;
                    
                    const minutesSinceLastSync = (now.getTime() - lastSync.getTime()) / (1000 * 60);

                    if (minutesSinceLastSync >= intervalMinutes) {
                        console.log(`[Auto-Sync] Running ${providerName} sync for business: ${business.id}`);
                        try {
                            const { updates, error: syncError } = await previewGenericShippingSyncAction(business.id, providerKey);
                            if (!syncError && updates && updates.length > 0) {
                                await applyShippingUpdatesAction(updates, business.id, config.shippingCompanyId);
                                logIntegrationActivity(business.id, "Auto-Sync", "info", `Auto-Synced ${providerName}: Found ${updates.length} updates.`, { results: updates });
                            }
                        } catch (e: any) {
                            console.error(`[Auto-Sync] Error in ${providerName} sync for ${business.id}:`, e);
                            logIntegrationActivity(business.id, "Auto-Sync", "error", `${providerName} Auto-Sync Error: ${e.message}`);
                        }

                        // Update lastSyncAt
                        if (!integrations.shipping) integrations.shipping = {};
                        if (!integrations.shipping[providerKey]) integrations.shipping[providerKey] = {};
                        integrations.shipping[providerKey].lastSyncAt = now.toISOString();
                        configChanged = true;
                    }
                }
            };

            await runGenericSync("jt", "J&T");
            await runGenericSync("aramex", "Aramex");
            await runGenericSync("filtareeq", "Filtareeq");


            // 3. VROBO Auto-Sync (retry logic for problematic orders)
            const vroboConfig = integrations.tools?.vrobo;
            if (vroboConfig?.enabled && vroboConfig?.autoSync) {
                const lastSyncStr = vroboConfig.lastSyncAt;
                const lastSync = lastSyncStr ? new Date(lastSyncStr) : new Date(0);
                const intervalMinutes = vroboConfig.autoSyncIntervalMinutes || 60;
                
                const minutesSinceLastSync = (now.getTime() - lastSync.getTime()) / (1000 * 60);

                if (minutesSinceLastSync >= intervalMinutes) {
                    console.log(`[Auto-Sync] Running VROBO sync for business: ${business.id}`);
                    try {
                        // Find orders that are Returning or Hold To redeliver but not yet synced to VROBO
                        const { data: problematicOrders } = await supabase
                            .from('orders')
                            .select('id')
                            .eq('business_id', business.id)
                            .in('status', ['Returning', 'Hold To redeliver'])
                            .eq('vrobo_synced', false)
                            .limit(50); // process batches

                        if (problematicOrders && problematicOrders.length > 0) {
                            for (const o of problematicOrders) {
                                await processOrderForVrobo(o.id);
                            }
                            logIntegrationActivity(business.id, "Auto-Sync", "info", `Auto-Synced VROBO: Processed ${problematicOrders.length} problematic orders.`);
                        }
                    } catch (e: any) {
                        console.error(`[Auto-Sync] Error in VROBO sync for ${business.id}:`, e);
                        logIntegrationActivity(business.id, "Auto-Sync", "error", `VROBO Auto-Sync Error: ${e.message}`);
                    }

                    // Update lastSyncAt
                    if (!integrations.tools) integrations.tools = {};
                    if (!integrations.tools.vrobo) integrations.tools.vrobo = {};
                    integrations.tools.vrobo.lastSyncAt = now.toISOString();
                    configChanged = true;
                }
            }

            // Save updated config if any syncs ran
            if (configChanged) {
                await supabase
                    .from('businesses')
                    .update({ 
                        theme_config: { 
                            ...business.theme_config, 
                            integrations 
                        } 
                    })
                    .eq('id', business.id);
                syncedBusinessesCount++;

                // Bounded per run so the function cannot time out. Safe to cut
                // short because the list is ordered most-neglected first, so
                // whoever is skipped now leads the next run.
                if (syncedBusinessesCount >= MAX_BUSINESSES_PER_RUN) {
                    console.log(`[Auto-Sync] Hit the ${MAX_BUSINESSES_PER_RUN}-business cap for this run.`);
                    break;
                }
            }
        }

        return NextResponse.json({
            success: true,
            scope: caller.kind === "scheduler" ? "all" : "own",
            message: `Auto-sync completed. Processed ${syncedBusinessesCount} businesses.`
        });

    } catch (err: any) {
        console.error("Auto-sync error:", err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
