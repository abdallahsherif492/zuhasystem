-- Migration: Create Real-Time Support Chat Tables
-- Date: 2026-07-26

-- 1. Create support_conversations table
CREATE TABLE IF NOT EXISTS support_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    last_message TEXT DEFAULT '',
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    unread_tenant_count INT DEFAULT 0,
    unread_admin_count INT DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_business_conversation UNIQUE (business_id)
);

-- 2. Create support_chat_messages table
CREATE TABLE IF NOT EXISTS support_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('tenant', 'admin')),
    sender_email TEXT,
    sender_name TEXT,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create Indexes for High Performance
CREATE INDEX IF NOT EXISTS idx_support_conversations_business_id ON support_conversations(business_id);
CREATE INDEX IF NOT EXISTS idx_support_conversations_last_message_at ON support_conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_chat_messages_conversation_id ON support_chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_support_chat_messages_created_at ON support_chat_messages(created_at ASC);

-- 4. Enable RLS (Row Level Security)
ALTER TABLE support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_chat_messages ENABLE ROW LEVEL SECURITY;

-- 5. Add RLS Policies
DROP POLICY IF EXISTS "Allow authenticated read/write support_conversations" ON support_conversations;
CREATE POLICY "Allow authenticated read/write support_conversations" ON support_conversations
    FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow authenticated read/write support_chat_messages" ON support_chat_messages;
CREATE POLICY "Allow authenticated read/write support_chat_messages" ON support_chat_messages
    FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- 6. Enable Realtime Publications
ALTER PUBLICATION supabase_realtime ADD TABLE support_chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE support_conversations;
