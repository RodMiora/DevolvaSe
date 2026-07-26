
-- Add or update RLS policies to allow read access on modules and lessons
DROP POLICY IF EXISTS "Modules are viewable by everyone" ON modules;
DROP POLICY IF EXISTS "Lessons are viewable by everyone" ON lessons;

CREATE POLICY "Modules are viewable by everyone" ON modules FOR SELECT USING (true);
CREATE POLICY "Lessons are viewable by everyone" ON lessons FOR SELECT USING (true);
