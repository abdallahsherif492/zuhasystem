import { ShippingProviderConfig, StandardShipment } from "./types";

/**
 * Implementation for Aramex Tracking API.
 */
export async function fetchAramexShipments(config: any, refNumbers: string[]): Promise<StandardShipment[]> {
    if (refNumbers.length === 0 || !config.apiUrl) return [];
    
    const shipments: StandardShipment[] = [];
    
    // Aramex tracking API typically allows batching (e.g., up to 50 or 100 at a time)
    const batchSize = 50;
    for (let i = 0; i < refNumbers.length; i += batchSize) {
        const batch = refNumbers.slice(i, i + batchSize);
        try {
            const payload = {
                ClientInfo: {
                    UserName: config.username || "",
                    Password: config.password || "",
                    Version: "v1.0",
                    AccountNumber: config.accountId || "",
                    AccountPin: config.accountPin || "",
                    AccountEntity: config.accountEntity || "",
                    AccountCountryCode: config.accountCountryCode || ""
                },
                Transaction: {
                    Reference1: "ZuhaTracking"
                },
                Shipments: batch,
                GetLastTrackingUpdateOnly: true
            };

            const res = await fetch(config.apiUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify(payload),
                cache: "no-store"
            });

            if (res.ok) {
                const json = await res.json();
                if (!json.HasErrors && json.TrackingResults) {
                    const results = Array.isArray(json.TrackingResults) ? json.TrackingResults : [json.TrackingResults];
                    
                    results.forEach((trackingResult: any) => {
                        const updates = trackingResult.Value;
                        if (updates && updates.length > 0) {
                            const latestUpdate = updates[0]; // Assuming it returns the latest or we requested GetLastTrackingUpdateOnly
                            shipments.push({
                                trackingNumber: trackingResult.WaybillNumber,
                                state: {
                                    code: latestUpdate.UpdateCode,
                                    value: latestUpdate.UpdateDescription
                                },
                                zuhaRef: trackingResult.WaybillNumber
                            });
                        }
                    });
                } else {
                    console.error("[Aramex Sync] API Returned Errors:", json.Notifications);
                }
            } else {
                console.error("[Aramex Sync] HTTP Error:", res.status, res.statusText);
            }
        } catch (error) {
            console.error(`[Aramex Sync] Error fetching for batch:`, error);
        }
    }
    
    return shipments;
}
export function mapAramexStatusToZuha(stateValue: string): string | null {
    if (!stateValue) return null;
    
    const lowerState = stateValue.toLowerCase();
    
    if (lowerState.includes("delivered")) return "Delivered";
    if (lowerState.includes("returned") || lowerState.includes("return to shipper")) return "Returned";
    if (lowerState.includes("returning")) return "Returning";
    if (lowerState.includes("held") || lowerState.includes("exception") || lowerState.includes("issue")) return "Hold To redeliver";
    
    return "Shipped";
}
