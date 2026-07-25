"use client"

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { ActionFeedback } from '@/components/ui/action-feedback';

export type FeedbackState = 'idle' | 'loading' | 'success' | 'error';

interface ActionFeedbackContextProps {
    startAction: (message?: string) => void;
    completeAction: (message?: string) => void;
    failAction: (message?: string) => void;
}

const ActionFeedbackContext = createContext<ActionFeedbackContextProps | undefined>(undefined);

export const ActionFeedbackProvider = ({ children }: { children: ReactNode }) => {
    const [state, setState] = useState<FeedbackState>('idle');
    const [message, setMessage] = useState<string>('');

    const startAction = (msg = 'Processing...') => {
        setMessage(msg);
        setState('loading');
    };

    const completeAction = (msg = 'Operation successful') => {
        setMessage(msg);
        setState('success');
        setTimeout(() => {
            setState('idle');
        }, 1500); // 1.5s delay before hiding
    };

    const failAction = (msg = 'Operation failed') => {
        setMessage(msg);
        setState('error');
        setTimeout(() => {
            setState('idle');
        }, 2000); // 2s delay before hiding
    };

    return (
        <ActionFeedbackContext.Provider value={{ startAction, completeAction, failAction }}>
            {children}
            {state !== 'idle' && (
                <ActionFeedback state={state} message={message} />
            )}
        </ActionFeedbackContext.Provider>
    );
};

export const useActionFeedback = () => {
    const context = useContext(ActionFeedbackContext);
    if (!context) {
        throw new Error('useActionFeedback must be used within an ActionFeedbackProvider');
    }
    return context;
};
