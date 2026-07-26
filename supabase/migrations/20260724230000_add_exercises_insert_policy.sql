-- Add insert policy for students on exercises
CREATE POLICY "Students can insert their own exercises"
  ON exercises
  FOR INSERT
  WITH CHECK (auth.uid() = student_id);

-- Also make sure select policy is there
DROP POLICY IF EXISTS "Students can view their own exercises" ON exercises;
CREATE POLICY "Students can view their own exercises"
  ON exercises
  FOR SELECT
  USING (auth.uid() = student_id);
