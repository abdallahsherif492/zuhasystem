"use client";

import { useParams } from "next/navigation";
import { ProductEditor } from "@/components/products/product-editor";

export default function EditProductPage() {
    const params = useParams();
    return <ProductEditor key={String(params?.id)} productId={String(params?.id)} />;
}
