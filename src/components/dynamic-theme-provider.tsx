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
    return `hsl(${(h * 360).toFixed(0)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%)`;
}

function getForegroundForHex(hex: string) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) {
        hex = hex.split('').map(c => c + c).join('');
    }
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Calculate luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    
    // If the background is light, text should be dark, else light
    return luminance > 0.5 ? 'hsl(222.2, 47.4%, 11.2%)' : 'hsl(210, 40%, 98%)';
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
                root.style.setProperty('--primary', config.primaryColor);
                root.style.setProperty('--primary-foreground', getForegroundForHex(config.primaryColor));
            } else {
                root.style.removeProperty('--primary');
                root.style.removeProperty('--primary-foreground');
            }

            // Secondary Color (Used for text color and secondary elements)
            if (config.secondaryColor) {
                root.style.setProperty('--secondary', config.secondaryColor);
                root.style.setProperty('--secondary-foreground', getForegroundForHex(config.secondaryColor));
                
                // Also apply secondary as the global text foreground color
                root.style.setProperty('--foreground', config.secondaryColor);
            } else {
                root.style.removeProperty('--secondary');
                root.style.removeProperty('--secondary-foreground');
                root.style.removeProperty('--foreground');
            }
            
            // Dark Mode
            const desiredTheme = config.darkMode === true || config.darkMode === 'dark' ? 'dark' : (config.darkMode === false || config.darkMode === 'light' ? 'light' : 'system');
            if (theme !== desiredTheme) {
                 setTheme(desiredTheme);
            }
        } else {
            // Revert to defaults
            root.style.removeProperty('--primary');
            root.style.removeProperty('--primary-foreground');
            root.style.removeProperty('--secondary');
            root.style.removeProperty('--secondary-foreground');
            if (theme !== 'system') {
                setTheme('system');
            }
        }
    }, [activeBusiness, theme, setTheme]);

    return <>{children}</>;
}
