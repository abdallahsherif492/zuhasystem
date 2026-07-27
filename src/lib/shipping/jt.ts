import { ShippingProviderConfig, StandardShipment } from "./types";

import crypto from 'crypto';

/**
 * Implementation for J&T Express.
 */
export async function fetchJTShipments(config: any, refNumbers: string[]): Promise<StandardShipment[]> {
    if (refNumbers.length === 0 || !config.apiUrl) return [];
    
    const shipments: StandardShipment[] = [];
    
    const batchSize = 5;
    for (let i = 0; i < refNumbers.length; i += batchSize) {
        const batch = refNumbers.slice(i, i + batchSize);
        const promises = batch.map(async (ref) => {
            try {
                // Prepare J&T request format
                const eccompanyid = config.eccompanyid || "";
                const key = config.apiKey || "";
                
                const data = JSON.stringify({
                    awb: ref,
                    eccompanyid: eccompanyid
                });
                
                // J&T Signature = Base64(MD5(data + key))
                const md5 = crypto.createHash('md5').update(data + key).digest('hex');
                const sign = Buffer.from(md5).toString('base64');
                
                const formData = new URLSearchParams();
                formData.append("logistics_interface", data);
                formData.append("data_digest", sign);
                formData.append("msg_type", "TRACK");
                formData.append("eccompanyid", eccompanyid);
                
                const res = await fetch(config.apiUrl, {
                    method: "POST",
                    headers: { 
                        "Content-Type": "application/x-www-form-urlencoded"
                    },
                    body: formData.toString(),
                    cache: "no-store"
                });
                
                if (res.ok) {
                    const json = await res.json();
                    if (json.responseitems && json.responseitems[0]) {
                        const details = json.responseitems[0].details || [];
                        const latest = details.length > 0 ? details[details.length - 1] : null;
                        
                        if (latest && latest.scantype) {
                            return {
                                trackingNumber: ref,
                                state: {
                                    code: latest.scantype,
                                    value: latest.desc || latest.scantype
                                },
                                zuhaRef: ref
                            };
                        }
                    }
                }
            } catch (error) {
                console.error(`[J&T Sync] Error fetching for ref ${ref}:`, error);
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
export function mapJTStatusToZuha(stateValue: string): string | null {
    if (!stateValue) return null;
    
    const lowerState = stateValue.toLowerCase();
    
    if (lowerState.includes("delivered") || lowerState.includes("signed")) return "Delivered";
    if (lowerState.includes("returned") || lowerState.includes("return to sender")) return "Returned";
    if (lowerState.includes("returning")) return "Returning";
    if (lowerState.includes("failed") || lowerState.includes("exception") || lowerState.includes("problem")) return "Hold To redeliver";
    
    return "Shipped";
}
