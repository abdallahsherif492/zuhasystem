import { ShippingProviderConfig, StandardShipment } from "./types";

/**
 * Stub implementation for J&T Egypt.
 * To be implemented fully when API documentation is provided.
 */
export async function fetchJTShipments(config: ShippingProviderConfig, refNumbers: string[]): Promise<StandardShipment[]> {
    if (refNumbers.length === 0) return [];
    
    // TODO: Implement actual API calls to J&T API using config.apiKey
    console.log("[J&T Sync] Fetching shipments for refs:", refNumbers);
    
    // Returning empty array for now (stub)
    return [];
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
