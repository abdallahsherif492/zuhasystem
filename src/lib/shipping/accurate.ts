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
    zuhaRef?: string;
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
    
    // Create a lowercase set of our refNumbers for case-insensitive matching
    const refNumbersLower = refNumbers.map(r => r.toLowerCase());

    const isMatch = (s: any) => {
        const sRef = s.refNumber ? s.refNumber.toLowerCase() : null;
        const sCode = s.code ? s.code.toLowerCase() : null;
        return (sRef && refNumbersLower.includes(sRef)) || (sCode && refNumbersLower.includes(sCode));
    };

    // Filter to those that match our refNumbers
    const matchedShipments = allShipments.filter(isMatch);
    
    // Find missing refNumbers that weren't in the 5000 recent shipments
    // Note: a shipment might have matched via 'code', so we remove matched eCommerx refs
    const matchedRefs = matchedShipments.map(s => {
        const sRef = s.refNumber ? s.refNumber.toLowerCase() : null;
        const sCode = s.code ? s.code.toLowerCase() : null;
        return refNumbersLower.includes(sRef!) ? sRef : sCode;
    }).filter(Boolean);

    const missingRefs = refNumbers.filter(ref => !matchedRefs.includes(ref.toLowerCase()));

    if (missingRefs.length > 0) {
        console.log(`[Telegraph Sync] Missing ${missingRefs.length} shipments from recent batch. Fetching via fallback search...`);
        const searchBatchSize = 10;
        for (let i = 0; i < missingRefs.length; i += searchBatchSize) {
            const batchRefs = missingRefs.slice(i, i + searchBatchSize);
            const promises = batchRefs.map(ref => {
                const query = `
                    query {
                        listShipments(first: 10, input: { search: "${ref}" }) {
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
                matchedShipments.push(...shipments.filter(isMatch));
            }
        }
    }

    // Now we need to normalize the matched shipments so that we can easily map them back to the original eCommerx refNumber.
    // Because some matched via `code`, we should explicitly attach the original eCommerx refNumber to it.
    const normalizedShipments = matchedShipments.map(s => {
        const sRef = s.refNumber ? s.refNumber.toLowerCase() : null;
        const sCode = s.code ? s.code.toLowerCase() : null;
        // Find which eCommerx refNumber it matched
        const matchedZuhaRef = refNumbers.find(r => r.toLowerCase() === sRef || r.toLowerCase() === sCode);
        return {
            ...s,
            zuhaRef: matchedZuhaRef // Ensure we know which eCommerx order this shipment belongs to
        };
    });

    return normalizedShipments;
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
