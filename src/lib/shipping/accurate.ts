export async function loginAccurate(username?: string, password?: string): Promise<string> {
    const ACCURATE_USER = username || process.env.ACCURATE_USER || "01035900379";
    const ACCURATE_PASS = password || process.env.ACCURATE_PASS || "123456";

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
    
    const allShipments: AccurateShipment[] = [];
    let page = 1;
    const maxPages = 10; // Fetch up to 1000 recent shipments to ensure we catch active ones

    while (page <= maxPages) {
        const query = `
            query {
                listShipments(first: 100, page: ${page}) {
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

        const shipments = json.data.listShipments.data || [];
        allShipments.push(...shipments);
        
        if (shipments.length < 100) {
            break; // No more pages
        }
        page++;
    }
    
    // Filter to those that match our refNumbers
    return allShipments.filter(s => s.refNumber && refNumbers.includes(s.refNumber));
}

export function mapAccurateStatusToZuha(accurateStatusCode: string, accurateStatusName: string, oldStatus?: string): string | null {
    // Ignore PKR (طلب الشحن)
    if (accurateStatusCode === "PKR") return null;
    
    // DEX, RTS, OTR are Returning
    if (["DEX", "RTS", "OTR"].includes(accurateStatusCode)) return "Returning";
    
    // HTR is Hold To redeliver
    if (accurateStatusCode === "HTR") return "Hold To redeliver";

    // If there's no code or we don't know it, fallback to name matching for final states
    if (accurateStatusName) {
        if (accurateStatusName.includes("تم التسليم") || accurateStatusName.includes("تسليم الطرد") || accurateStatusName.includes("تم التوصيل")) return "Delivered";
        if (accurateStatusName.includes("مرتجع") || accurateStatusName.includes("رجيع") || accurateStatusName.includes("إرجاع") || accurateStatusName.includes("إلغاء") || accurateStatusName.includes("تم الغاء")) return "Returned";
    }
    
    // Don't downgrade existing tracking states to Shipped if we encounter an unknown intermediate status
    if (oldStatus === "Returning" || oldStatus === "Hold To redeliver") return oldStatus;

    // Default to Shipped for any other states
    return "Shipped";
}
