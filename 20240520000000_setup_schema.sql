-- Initial schema for ReentryApp

-- 1. Participants Table
CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "cohortName" TEXT,
    tier INTEGER,
    status TEXT,
    "programGoal" TEXT,
    interests TEXT[],
    "goodTimeCredits" INTEGER DEFAULT 0,
    "caseManagerName" TEXT,
    "compatibilityNote" TEXT,
    "createdAt" TIMESTAMPTZ DEFAULT NOW(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL -- Link to Supabase Auth users
);

-- 2. Roll Call Log Table
CREATE TABLE IF NOT EXISTS roll_call_log (
    id TEXT PRIMARY KEY,
    "participantId" TEXT REFERENCES participants(id) ON DELETE CASCADE,
    "wellnessStatus" TEXT NOT NULL,
    "supportNeed" TEXT,
    "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Messages (Kites) Table
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    "senderId" TEXT REFERENCES participants(id) ON DELETE SET NULL,
    "recipientId" TEXT REFERENCES participants(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    moderation JSONB,
    "deliveryStatus" TEXT,
    "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Moderation Queue Table
CREATE TABLE IF NOT EXISTS moderation_queue (
    id TEXT PRIMARY KEY,
    "sourceType" TEXT,
    "submittedBy" TEXT REFERENCES participants(id) ON DELETE SET NULL,
    "riskScore" INTEGER,
    status TEXT DEFAULT 'pending',
    "displayArea" TEXT,
    reason TEXT,
    "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Resources Table
CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT,
    "displayArea" TEXT,
    format TEXT,
    "savedCount" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE roll_call_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;

-- Development Policies: Allow all operations for now
-- NOTE: Update these with proper Auth-based policies before production for security

-- Policies for participants table
DROP POLICY IF EXISTS "Allow all for development" ON participants;
CREATE POLICY "Users can view their own participant record"
ON participants FOR SELECT
USING (auth.uid() = user_id);
-- Add INSERT/UPDATE/DELETE policies for participants if users manage their own profiles

CREATE POLICY "Allow all for development" ON roll_call_log FOR ALL USING (true) WITH CHECK (true);

-- Policies for messages table
DROP POLICY IF EXISTS "Allow all for development" ON messages;
CREATE POLICY "Users can view their own messages"
ON messages FOR SELECT
USING (
    EXISTS (SELECT 1 FROM participants WHERE id = messages."senderId" AND user_id = auth.uid())
    OR
    EXISTS (SELECT 1 FROM participants WHERE id = messages."recipientId" AND user_id = auth.uid())
);
CREATE POLICY "Allow all for development" ON moderation_queue FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for development" ON resources FOR ALL USING (true) WITH CHECK (true);

-- Seed Initial Data
INSERT INTO participants (id, "displayName", "cohortName", tier, status, "programGoal", interests, "goodTimeCredits", "caseManagerName", "compatibilityNote")
VALUES
('res-101', 'Marcus J.', 'North Unit', 4, 'online', 'Stable housing and peer mentorship', ARRAY['housing', 'peer support', 'job readiness'], 184, 'PO Ellis', 'Shared focus on housing stability and steady check-ins.'),
('res-204', 'Tanya R.', 'East Unit', 3, 'in_roll_call', 'Family reunification and employment', ARRAY['family', 'work detail', 'transportation'], 142, 'PO Rivera', 'Similar reentry goals and strong Roll Call consistency.'),
('res-319', 'Devon K.', 'South Unit', 5, 'available', 'Education plan and wellness routine', ARRAY['law library', 'rec yard', 'education'], 221, 'PO Shah', 'Aligned learning goals and positive group participation.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO resources (id, title, category, "displayArea", format, "savedCount")
VALUES
('resource-01', 'Housing appointment checklist', 'Commissary', 'Commissary', 'PDF', 38),
('resource-02', 'Resume clinic sign-up', 'Employment', 'Work Detail', 'Form', 27),
('resource-03', 'Record relief intake guide', 'Legal', 'Law Library', 'Article', 19),
('resource-04', 'Grounding practice audio', 'Wellness', 'Rec Yard', 'Audio', 44)
ON CONFLICT (id) DO NOTHING;

INSERT INTO moderation_queue (id, "sourceType", "submittedBy", "riskScore", status, "displayArea", reason)
VALUES
('review-701', 'message', 'res-101', 42, 'pending', 'Mail Room', 'Needs staff review before delivery.')
ON CONFLICT (id) DO NOTHING;
