"use client";

import React, { useEffect } from "react";
import { useBusiness } from "@/contexts/BusinessContext";
import { useTheme } from "next-themes";

function hexToHsl(hex: string) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) {
        hex = hex.split('').map(c => c + c).join('');
    }
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }

    return `${(h * 360).toFixed(0)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%`;
}

export function DynamicThemeProvider({ children }: { children: React.ReactNode }) {
    const { activeBusiness } = useBusiness();
    const { setTheme, theme } = useTheme();

    useEffect(() => {
        const root = document.documentElement;
        
        if (activeBusiness?.theme_config) {
            const config = activeBusiness.theme_config;
            
            // Primary Color
            if (config.primaryColor) {
                root.style.setProperty('--primary', hexToHsl(config.primaryColor));
            } else {
                root.style.removeProperty('--primary');
            }

            // Secondary Color
            if (config.secondaryColor) {
                root.style.setProperty('--secondary', hexToHsl(config.secondaryColor));
            } else {
                root.style.removeProperty('--secondary');
            }
            
            // Dark Mode
            const desiredTheme = config.darkMode === true || config.darkMode === 'dark' ? 'dark' : (config.darkMode === false || config.darkMode === 'light' ? 'light' : 'system');
            if (theme !== desiredTheme) {
                 setTheme(desiredTheme);
            }
        } else {
            // Revert to defaults
            root.style.removeProperty('--primary');
            root.style.removeProperty('--secondary');
            if (theme !== 'system') {
                setTheme('system');
            }
        }
    }, [activeBusiness, theme, setTheme]);

    return <>{children}</>;
}
