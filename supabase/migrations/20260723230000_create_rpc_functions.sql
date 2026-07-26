-- Create function to insert lesson with security definer (bypasses RLS)
CREATE OR REPLACE FUNCTION insert_lesson(
    p_module_id UUID,
    p_title TEXT,
    p_description TEXT,
    p_video_url TEXT,
    p_order INTEGER
) RETURNS SETOF lessons AS $$
BEGIN
    RETURN QUERY INSERT INTO lessons (module_id, title, description, video_url, "order")
    VALUES (p_module_id, p_title, p_description, p_video_url, p_order)
    RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to insert module with security definer (bypasses RLS)
CREATE OR REPLACE FUNCTION insert_module(
    p_instrument_id UUID,
    p_title TEXT,
    p_description TEXT,
    p_order INTEGER
) RETURNS SETOF modules AS $$
BEGIN
    RETURN QUERY INSERT INTO modules (instrument_id, title, description, "order")
    VALUES (p_instrument_id, p_title, p_description, p_order)
    RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
