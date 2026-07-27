import React from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Info, ExternalLink, Key, Link as LinkIcon, Building2 } from "lucide-react";

export type ProviderType = "bosta" | "jt" | "aramex" | "filtareeq" | "telegraph";

interface IntegrationInstructionsProps {
  provider: ProviderType;
}

export function IntegrationInstructions({ provider }: IntegrationInstructionsProps) {
  const { t } = useLanguage();

  const getInstructions = () => {
    switch (provider) {
      case "bosta":
        return {
          title: t("How to connect Bosta"),
          steps: [
            { icon: <ExternalLink className="w-5 h-5 text-blue-500" />, text: t("Log in to your Bosta Business Dashboard.") },
            { icon: <Key className="w-5 h-5 text-blue-500" />, text: t("Go to Settings > API Integrations.") },
            { icon: <LinkIcon className="w-5 h-5 text-blue-500" />, text: t("Copy the API Key provided and paste it in the field here.") },
          ]
        };
      case "jt":
        return {
          title: t("How to connect J&T Express"),
          steps: [
            { icon: <ExternalLink className="w-5 h-5 text-red-500" />, text: t("Access the J&T Developer Portal (developer.jet.co.id).") },
            { icon: <Building2 className="w-5 h-5 text-red-500" />, text: t("Obtain your EC Company ID from your account manager or dashboard.") },
            { icon: <Key className="w-5 h-5 text-red-500" />, text: t("Get your API Secret Key and Tracking API URL.") },
            { icon: <LinkIcon className="w-5 h-5 text-red-500" />, text: t("Enter all the details below to enable real-time tracking.") },
          ]
        };
      case "aramex":
        return {
          title: t("How to connect Aramex"),
          steps: [
            { icon: <ExternalLink className="w-5 h-5 text-red-700" />, text: t("Log in to your Aramex Dashboard.") },
            { icon: <Building2 className="w-5 h-5 text-red-700" />, text: t("Note down your Account Number, Account PIN, Account Entity (e.g. CAI), and Country Code (e.g. EG).") },
            { icon: <Key className="w-5 h-5 text-red-700" />, text: t("Provide the API Username (Email) and API Password.") },
            { icon: <LinkIcon className="w-5 h-5 text-red-700" />, text: t("Fill the required fields below to establish the connection.") },
          ]
        };
      case "filtareeq":
        return {
          title: t("How to connect Fil-Tareeq"),
          steps: [
            { icon: <ExternalLink className="w-5 h-5 text-purple-600" />, text: t("Open your Fil-Tareeq Dashboard.") },
            { icon: <Key className="w-5 h-5 text-purple-600" />, text: t("Navigate to the Developers/API section.") },
            { icon: <LinkIcon className="w-5 h-5 text-purple-600" />, text: t("Copy the API Key and paste it here.") },
          ]
        };
      case "telegraph":
        return {
          title: t("How to connect Telegraph"),
          steps: [
            { icon: <Key className="w-5 h-5 text-indigo-500" />, text: t("Get your Telegraph Username and Password from the agent.") },
            { icon: <LinkIcon className="w-5 h-5 text-indigo-500" />, text: t("Enter them below to enable sync.") },
          ]
        };
      default:
        return null;
    }
  };

  const instructions = getInstructions();
  if (!instructions) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground hover:text-primary transition-colors">
          <Info className="w-4 h-4" />
          <span className="text-xs font-medium">{t("How to connect?")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md border-0 shadow-2xl p-0 overflow-hidden">
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-6 text-white">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-2 text-white">
              <Info className="w-6 h-6 text-blue-400" />
              {instructions.title}
            </DialogTitle>
            <DialogDescription className="text-slate-300 mt-2">
              {t("Follow these simple steps to link your account and automate tracking.")}
            </DialogDescription>
          </DialogHeader>
        </div>
        
        <div className="p-6 bg-card space-y-6">
          <div className="space-y-4">
            {instructions.steps.map((step, idx) => (
              <div key={idx} className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center border border-slate-200 dark:border-slate-700">
                  {step.icon}
                </div>
                <div className="flex-1 pt-1">
                  <p className="text-sm font-medium leading-relaxed">{step.text}</p>
                </div>
              </div>
            ))}
          </div>
          
          <div className="bg-blue-50/50 dark:bg-blue-900/20 rounded-lg p-4 flex items-start gap-3 border border-blue-100 dark:border-blue-800">
            <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700 dark:text-blue-300">
              {t("Make sure your API keys are kept secret. Do not share them with anyone.")}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
