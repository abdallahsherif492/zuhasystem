import { ShippingProviderConfig, StandardShipment } from "./types";

/**
 * Stub implementation for Filtareeq.
 * To be implemented fully when API documentation is provided.
 */
export async function fetchFiltareeqShipments(config: ShippingProviderConfig, refNumbers: string[]): Promise<StandardShipment[]> {
    if (refNumbers.length === 0) return [];
    
    // TODO: Implement actual API calls to Filtareeq API using config.apiKey
    console.log("[Filtareeq Sync] Fetching shipments for refs:", refNumbers);
    
    // Returning empty array for now (stub)
    return [];
}

export function mapFiltareeqStatusToZuha(stateValue: string): string | null {
    if (!stateValue) return null;
    
    const lowerState = stateValue.toLowerCase();
    
    if (lowerState.includes("delivered")) return "Delivered";
    if (lowerState.includes("returned")) return "Returned";
    if (lowerState.includes("returning")) return "Returning";
    if (lowerState.includes("hold") || lowerState.includes("failed") || lowerState.includes("exception")) return "Hold To redeliver";
    
    return "Shipped";
}
