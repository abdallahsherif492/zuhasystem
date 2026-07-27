export interface ShippingProviderConfig {
    enabled: boolean;
    apiKey: string;
    autoSync: boolean;
    autoSyncIntervalMinutes: number;
    shippingCompanyId: string;
    apiSecret?: string; // Some providers might need an extra secret or account pin
    accountId?: string;
}

export interface StandardShipment {
    trackingNumber: string;
    state: {
        code?: string | number;
        value: string;
    };
    zuhaRef?: string;
}

export interface ShippingIntegrationProvider {
    providerName: string;
    fetchShipments: (config: ShippingProviderConfig, refNumbers: string[]) => Promise<StandardShipment[]>;
    mapStatusToZuha: (stateValue: string) => string | null;
}
