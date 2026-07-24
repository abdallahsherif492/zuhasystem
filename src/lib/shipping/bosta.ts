export interface BostaShipment {
    trackingNumber: string;
    state: {
        code?: number;
        value: string;
    };
    zuhaRef?: string;
}

export async function fetchBostaShipments(apiKey: string, refNumbers: string[]): Promise<BostaShipment[]> {
    if (refNumbers.length === 0) return [];
    
    const shipments: BostaShipment[] = [];
    
    // Batch process refNumbers to avoid rate limiting
    const batchSize = 5;
    for (let i = 0; i < refNumbers.length; i += batchSize) {
        const batch = refNumbers.slice(i, i + batchSize);
        const promises = batch.map(async (ref) => {
            try {
                // 1. Try fetching by businessReference first
                const res = await fetch(`https://app.bosta.co/api/v0/deliveries?businessReference=${ref}`, {
                    method: "GET",
                    headers: { 
                        "Content-Type": "application/json",
                        "Authorization": apiKey
                    },
                    cache: "no-store"
                });
                
                const json = await res.json();
                const deliveries = json.deliveries || json.message?.deliveries || json.data || (Array.isArray(json) ? json : []);
                
                if (deliveries && deliveries.length > 0) {
                    const delivery = deliveries[0];
                    return {
                        trackingNumber: delivery.trackingNumber || delivery._id,
                        state: delivery.state || {},
                        zuhaRef: ref
                    };
                }
                
                // 2. Fallback: try fetching by AWB / Tracking ID
                const awbRes = await fetch(`https://app.bosta.co/api/v0/deliveries/${ref}`, {
                    method: "GET",
                    headers: { 
                        "Content-Type": "application/json",
                        "Authorization": apiKey
                    },
                    cache: "no-store"
                });
                
                if (awbRes.ok) {
                    const awbJson = await awbRes.json();
                    if (awbJson.trackingNumber || awbJson._id) {
                        return {
                            trackingNumber: awbJson.trackingNumber || awbJson._id,
                            state: awbJson.state || {},
                            zuhaRef: ref
                        };
                    }
                }
            } catch (error) {
                console.error(`[Bosta Sync] Error fetching for ref ${ref}:`, error);
            }
            return null;
        });

        const results = await Promise.all(promises);
        results.forEach(res => {
            if (res) shipments.push(res);
        });
    }
    
    return shipments;
}

export function mapBostaStatusToZuha(stateValue: string): string | null {
    if (!stateValue) return null;
    
    const lowerState = stateValue.toLowerCase();
    
    if (lowerState.includes("delivered")) return "Delivered";
    if (lowerState.includes("returned to origin") || lowerState.includes("returned") || lowerState.includes("cancelled")) return "Returned";
    if (lowerState.includes("return in progress") || lowerState.includes("returning")) return "Returning";
    if (lowerState.includes("failed") || lowerState.includes("exception") || lowerState.includes("action") || lowerState.includes("hold")) return "Hold To redeliver";
    
    return "Shipped";
}
