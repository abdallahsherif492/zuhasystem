import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { previewShippingSyncAction, applyShippingUpdatesAction } from '@/app/(dashboard)/orders/sync-actions';
import { processOrderForVrobo } from '@/lib/vrobo/api';
import { logIntegrationActivity } from '@/lib/logs/integration-logger';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

export const maxDuration = 300; // Allow Vercel functions to run up to 5 minutes

export async function GET(request: Request) {
    try {
        // Fetch all businesses that have theme_config
        const { data: businesses, error } = await supabase
            .from('businesses')
            .select('id, theme_config');

        if (error) throw error;
        if (!businesses) return NextResponse.json({ success: true, message: "No businesses found." });

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

            // 2. VROBO Auto-Sync (retry logic for problematic orders)
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
            }
        }

        return NextResponse.json({ 
            success: true, 
            message: `Auto-sync completed. Processed ${syncedBusinessesCount} businesses.` 
        });

    } catch (err: any) {
        console.error("Auto-sync error:", err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
