"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users } from "lucide-react";

type PlatformUser = {
    id: string;
    user_email: string;
    role: string;
    created_at: string;
    businesses: {
        name: string;
    };
};

export default function PlatformUsersDirectory() {
    const [users, setUsers] = useState<PlatformUser[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchUsers = async () => {
            setLoading(true);
            const { data, error } = await supabase
                .from("business_users")
                .select(`
                    id,
                    user_email,
                    role,
                    created_at,
                    businesses ( name )
                `)
                .order("created_at", { ascending: false });

            if (!error && data) {
                setUsers(data as unknown as PlatformUser[]);
            }
            setLoading(false);
        };

        fetchUsers();
    }, []);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Platform Users</h1>
                <p className="text-muted-foreground">Directory of all users across all tenant stores.</p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-primary" />
                        User Directory
                    </CardTitle>
                    <CardDescription>
                        A comprehensive list of every team member and store owner registered on the platform.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center p-8">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : (
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Email</TableHead>
                                        <TableHead>Store</TableHead>
                                        <TableHead>Role</TableHead>
                                        <TableHead>Joined</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {users.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="text-center p-8 text-muted-foreground">
                                                No users found.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        users.map((user) => (
                                            <TableRow key={user.id}>
                                                <TableCell className="font-medium">{user.user_email}</TableCell>
                                                <TableCell>{user.businesses?.name || "Unknown"}</TableCell>
                                                <TableCell>
                                                    <Badge variant={user.role === "owner" || user.role === "Super Admin" ? "default" : "secondary"}>
                                                        {user.role}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>{new Date(user.created_at).toLocaleDateString()}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
