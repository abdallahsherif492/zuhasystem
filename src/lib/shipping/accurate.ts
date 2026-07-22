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
    const maxPages = 50; // Fetch up to 5000 recent shipments
    const batchSize = 10;

    for (let batchStart = 1; batchStart <= maxPages; batchStart += batchSize) {
        const promises = [];
        for (let page = batchStart; page < batchStart + batchSize && page <= maxPages; page++) {
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

            promises.push(
                fetch("https://system.telegraphex.com:8443/graphql", {
                    method: "POST",
                    headers: { 
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`
                    },
                    body: JSON.stringify({ query }),
                    cache: "no-store"
                })
                .then(res => res.json())
                .then(json => {
                    if (json.errors) throw new Error(json.errors[0].message);
                    return json.data.listShipments.data || [];
                })
            );
        }

        const results = await Promise.all(promises);
        for (const shipments of results) {
            allShipments.push(...shipments);
        }

        // If any of the pages in this batch returned less than 100, we've reached the end
        if (results.some(shipments => shipments.length < 100)) {
            break;
        }
    }
    // Filter to those that match our refNumbers
    const matchedShipments = allShipments.filter(s => s.refNumber && refNumbers.includes(s.refNumber));
    
    // Find missing refNumbers that weren't in the 5000 recent shipments
    const matchedRefs = matchedShipments.map(s => s.refNumber);
    const missingRefs = refNumbers.filter(ref => !matchedRefs.includes(ref));

    if (missingRefs.length > 0) {
        console.log(`[Telegraph Sync] Missing ${missingRefs.length} shipments from recent batch. Fetching via fallback search...`);
        const searchBatchSize = 10;
        for (let i = 0; i < missingRefs.length; i += searchBatchSize) {
            const batchRefs = missingRefs.slice(i, i + searchBatchSize);
            const promises = batchRefs.map(ref => {
                const query = `
                    query {
                        listShipments(first: 10, search: "${ref}") {
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
                return fetch("https://system.telegraphex.com:8443/graphql", {
                    method: "POST",
                    headers: { 
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`
                    },
                    body: JSON.stringify({ query }),
                    cache: "no-store"
                })
                .then(res => res.json())
                .then(json => {
                    if (json.errors) return [];
                    return json.data?.listShipments?.data || [];
                }).catch(() => []);
            });

            const results = await Promise.all(promises);
            for (const shipments of results) {
                matchedShipments.push(...shipments.filter((s: any) => s.refNumber && batchRefs.includes(s.refNumber)));
            }
        }
    }

    return matchedShipments;
}

export function mapAccurateStatusToZuha(accurateStatusCode: string, accurateStatusName: string): string | null {
    // Ignore PKR (طلب الشحن)
    if (accurateStatusCode === "PKR") return null;
    
    // DEX, RTS, OTR are Returning
    if (["DEX", "RTS", "OTR"].includes(accurateStatusCode)) return "Returning";
    
    // HTR is Hold To redeliver
    if (accurateStatusCode === "HTR") return "Hold To redeliver";

    // If there's no code or we don't know it, fallback to name matching for final states
    if (accurateStatusName) {
        if (accurateStatusName.includes("تم التسليم")) return "Delivered";
        if (accurateStatusName.includes("إرجاع") && accurateStatusName.includes("تم")) return "Returned";
    }
    
    // Default to Shipped for any other states
    return "Shipped";
}
