-- Correct a transcription typo in the 20261212_admin_bulk_and_comments_page
-- execution: restore the exact Vietnamese character map from the source file.
begin;

create or replace function public.admin_fold(p_text text)
returns text language sql immutable parallel safe as $$
  select translate(
    lower(coalesce(p_text, '')),
    'aáàảãạăắằẳẵặâấầẩẫậeéèẻẽẹêếềểễệiíìỉĩịoóòỏõọôốồổỗộơớờởỡợuúùủũụưứừửữựyýỳỷỹỵđ',
    'aaaaaaaaaaaaaaaaaaeeeeeeeeeeeeiiiiiioooooooooooooooooouuuuuuuuuuuuyyyyyyd'
  )
$$;

notify pgrst, 'reload schema';
commit;
