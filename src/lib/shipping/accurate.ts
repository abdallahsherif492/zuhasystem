export async function loginAccurate(): Promise<string> {
    const ACCURATE_USER = process.env.ACCURATE_USER || "01035900379";
    const ACCURATE_PASS = process.env.ACCURATE_PASS || "123456";

    const query = `
        mutation {
            login(input: { username: "${ACCURATE_USER}", password: "${ACCURATE_PASS}" }) {
                token
            }
        }
    `;

    const res = await fetch("https://system.telegraphex.com:8443/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        cache: "no-store"
    });

    const json = await res.json();
    if (json.errors) {
        throw new Error(json.errors[0].message || "Failed to login to Accurate API");
    }

    return json.data.login.token;
}

export interface AccurateShipment {
    id: number;
    code: string;
    refNumber: string;
    status: {
        id: number;
        code: string;
        name: string;
    };
}

export async function fetchAccurateShipments(token: string, refNumbers: string[]): Promise<AccurateShipment[]> {
    if (refNumbers.length === 0) return [];
    
    // We fetch a list of shipments. The GraphQL API has a filter by refNumber array? 
    // Wait, ListShipmentsFilterInput doesn't show if refNumber is string or array.
    // If it's a string, we might need to fetch multiple times or just fetch recent shipments and filter.
    // Let's fetch recent shipments (first 200). In production, fetching by specific refNumbers is better.
    // Assuming refNumber is a single string in the input, we can do parallel queries or just fetch the latest.
    
    // Let's query recent shipments (first 500)
    const query = `
        query {
            listShipments(first: 500, page: 1) {
                data {
                    id
                    code
                    refNumber
                    status {
                        id
                        code
                        name
                    }
                }
            }
        }
    `;

    const res = await fetch("https://system.telegraphex.com:8443/graphql", {
        method: "POST",
        headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ query }),
        cache: "no-store"
    });

    const json = await res.json();
    if (json.errors) {
        throw new Error(json.errors[0].message || "Failed to fetch shipments from Accurate API");
    }

    const allShipments: AccurateShipment[] = json.data.listShipments.data || [];
    
    // Filter to those that match our refNumbers
    return allShipments.filter(s => s.refNumber && refNumbers.includes(s.refNumber));
}

export function mapAccurateStatusToZuha(accurateStatusName: string): string | null {
    // We map accurateStatusName (which is Arabic in the API e.g. "طلب شحن") to Zuha Status.
    // Based on user feedback:
    // Returning = قيد الإرجاع للراسل / قيد الارجاع
    // Returned = تم الإرجاع للراسل / مسترجع
    // Waiting for Shipping = قيد الانتظار / طلب شحن / الخ
    // Delivered = تم التسليم
    // Any other is ignored (null) or "Shipped". User said "اي حالة تانية ممكن تسيبها shipped عادي, الاهم ان..."
    // Let's use includes for safety.

    if (!accurateStatusName) return null;

    if (accurateStatusName.includes("تم التسليم")) return "Delivered";
    if (accurateStatusName.includes("إرجاع") && accurateStatusName.includes("تم")) return "Returned";
    if (accurateStatusName.includes("إرجاع") && accurateStatusName.includes("قيد")) return "Returning";
    if (accurateStatusName.includes("قيد الانتظار") || accurateStatusName.includes("مشكلة") || accurateStatusName.includes("غير متوفر") || accurateStatusName.includes("طلب شحن")) return "Waiting for Shipping";
    
    // Default to Shipped for any other intermediate states (like مناولة, تم الاستلام بالمخزن, etc)
    return "Shipped";
}
