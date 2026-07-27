import { ShippingProviderConfig, StandardShipment } from "./types";

/**
 * Stub implementation for Aramex.
 * To be implemented fully when API documentation is provided.
 */
export async function fetchAramexShipments(config: ShippingProviderConfig, refNumbers: string[]): Promise<StandardShipment[]> {
    if (refNumbers.length === 0) return [];
    
    // TODO: Implement actual API calls to Aramex API using config.apiKey (and potentially apiSecret/accountId)
    console.log("[Aramex Sync] Fetching shipments for refs:", refNumbers);
    
    // Returning empty array for now (stub)
    return [];
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
